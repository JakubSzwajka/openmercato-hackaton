import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  InboxActionDefinition,
  InboxActionExecutionContext,
  InboxActionExecutionResult,
} from '@open-mercato/shared/modules/inbox-actions'
// Reuse the installed payload contract instead of inventing a parallel one.
// Core's own sales module imports the same schema the same way
// (node_modules/@open-mercato/core/src/modules/sales/inbox-actions.ts:2), so an
// app-owned action that ends in a sales document is an established pattern, not
// a new coupling. Sharing the schema also means the inbox-ops payload editor and
// the discrepancy resolver already understand our action's payload.
import { orderPayloadSchema } from '@open-mercato/core/modules/inbox_ops/data/validators'
import type { OrderPayload } from '@open-mercato/core/modules/inbox_ops/data/validators'
import {
  asHelperContext,
  buildSourceMetadata,
  executeCommand,
  ExecutionError,
  normalizeAddressSnapshot,
  parseDateToken,
  parseNumberToken,
  resolveCustomerEntityIdByEmail,
  resolveEntityClass,
} from '@open-mercato/core/modules/inbox_ops/lib/executionHelpers'
import { CatalogPricingError, priceLinesFromCatalog } from './lib/catalogPricing'

/**
 * Grep marker printed by `execute`. Kept as a single opaque token so an
 * operator can prove the core execution engine reached app-owned code:
 *
 *   yarn dev 2>&1 | grep OFFER_AUTOMATION_DRAFT_OFFER_EXECUTED
 */
export const DRAFT_OFFER_EXECUTED_MARKER = 'OFFER_AUTOMATION_DRAFT_OFFER_EXECUTED'

export const DRAFT_OFFER_ACTION_TYPE = 'draft_offer'

export const DRAFT_OFFER_REQUIRED_FEATURE = 'offer_automation.offers.draft'

/**
 * Entity type written back onto the accepted action. The proposal card renders
 * it verbatim as "Created sales_quote" (ActionCard.tsx:256-261); it prints the
 * type, it does not link to the record.
 */
export const DRAFT_OFFER_CREATED_ENTITY_TYPE = 'sales_quote'

/** The payload contract is core's. Re-exported so the CLI seeds the same shape. */
export const draftOfferPayloadSchema = orderPayloadSchema

export type DraftOfferPayload = OrderPayload

const logger = createLogger('offer_automation').child({ component: 'inbox-actions' })

/**
 * Resolves the `draft` entry of the `sales.order_status` dictionary, which is
 * the dictionary the quote list and quote detail read their status badge from.
 *
 * Core's own `create_quote` leaves `statusEntryId` unset, so its quotes show a
 * blank status. We set the initial status explicitly because "draft" is the
 * finish line of this flow and the salesperson has to see it. This is the
 * document's starting state, not a transition: nothing here ever moves a quote
 * forward.
 *
 * Imported lazily so an app without the `sales` module still loads the
 * inbox-action registry; the failure then lands on execution, where it belongs.
 */
async function resolveDraftStatusEntryId(
  hCtx: ReturnType<typeof asHelperContext>,
): Promise<string | null> {
  try {
    const { resolveStatusEntryIdByValue } = await import(
      '@open-mercato/core/modules/sales/lib/statusHelpers'
    )
    return await resolveStatusEntryIdByValue(hCtx.em, {
      tenantId: hCtx.tenantId,
      organizationId: hCtx.organizationId,
      value: 'draft',
    })
  } catch {
    return null
  }
}

/**
 * Smallest equivalent of core's `resolveFirstChannelId`.
 *
 * Core's public helper picks the first non-deleted channel by name and ignores
 * `isActive`, which would let an accepted offer land on a channel the business
 * has switched off. We keep the same ordering and the same scope filter and add
 * `isActive: true`, so the flow fails closed with a readable message instead.
 */
async function resolveActiveChannelId(
  hCtx: ReturnType<typeof asHelperContext>,
): Promise<string | null> {
  const SalesChannelClass = resolveEntityClass(hCtx, 'SalesChannel')
  if (!SalesChannelClass) return null

  const channel = (await findOneWithDecryption(
    hCtx.em,
    SalesChannelClass,
    {
      tenantId: hCtx.tenantId,
      organizationId: hCtx.organizationId,
      isActive: true,
      deletedAt: null,
    } as never,
    { orderBy: { name: 'ASC' } } as never,
    { tenantId: hCtx.tenantId, organizationId: hCtx.organizationId },
  )) as { id: string } | null

  return channel?.id ?? null
}

/**
 * Turns a pricing failure into the message the reviewer reads on the card.
 *
 * WHY THE WHOLE ACTION FAILS instead of writing the line at zero with a marker:
 * a draft quote is a document a person sends. A zero line with a marker relies
 * on that person noticing the marker, and the one outcome nobody can recover
 * from is a quote that left the building priced at nothing. Refusing costs a
 * retry; the action stays `failed` and retryable from the proposal card, and
 * the message names every line that could not be priced and why, so the fix is
 * one catalog edit away. Nothing partial is written: `sales.quotes.create` is
 * never called.
 *
 * 422 rather than 400: the payload is well-formed, the catalog cannot satisfy
 * it.
 */
function describePricingFailure(error: CatalogPricingError): ExecutionError {
  const unresolved = error.failures.filter((f) => f.reason === 'variant_not_resolved').length
  const unpriced = error.failures.length - unresolved
  const hint =
    unresolved > 0
      ? 'Set the line\'s sku to one this organization sells, or seed the service with: yarn mercato offer_automation seed-catalog.'
      : 'Add a list price in the quote currency under Catalog > Products > Prices.'
  return new ExecutionError(
    `${error.message}\n${hint}\nNo quote was created (${unresolved} unmatched, ${unpriced} unpriced).`,
    422,
  )
}

/**
 * Turns an accepted `draft_offer` into a real sales quote in draft, priced from
 * the catalog.
 *
 * Mirrors `executeCreateDocumentAction` from
 * `node_modules/@open-mercato/core/src/modules/sales/inbox-actions.ts:40-143`
 * (quote branch) so the quote this app writes is indistinguishable from one
 * core's own `create_quote` would have written.
 *
 * Every unit price comes from `catalog_product_variant_prices` through
 * `priceLinesFromCatalog`. A `unitPrice` in the payload is IGNORED, because the
 * payload is the part an extraction model gets to write and a model must never
 * be able to set a price. See the comment on that function.
 *
 * THE MODEL DOES SEE PRICES. Core's `catalogLookup.ts:91-96` puts a `price` on
 * every catalogue product in the extraction prompt, and our seeded prices are
 * among them because `catalog.prices.create` stamps the variant's parent
 * product onto the row (`catalog/commands/prices.ts:303-310, :376`). So the
 * claim is NOT that a model is kept ignorant of prices. The claim is narrower
 * and stronger: whatever price it saw, and whatever price it echoes back,
 * cannot reach the quote, because this handler never reads `unitPrice` and
 * `priceLinesFromCatalog` has no parameter to accept one.
 *
 * THIS DIVERGES FROM CORE ON PURPOSE. Core's own `create_order` / `create_quote`
 * passes the model's amount straight through to the document
 * (`sales/inbox-actions.ts:46-47, :61`). That is the reference implementation
 * and we do the opposite, deliberately: a freight quote a salesperson signs
 * must be priced by the rate card, not by whatever number a model read in an
 * email or repeated from a prompt.
 *
 * No discounts. This build prices at list and never sets `discountAmount`,
 * `discountPercent` or a promotion code, so core's
 * `resolveUpsertDiscountFields` (sales/commands/documents.ts:136) stores none.
 *
 * A line that cannot be priced fails the whole action. See
 * `describePricingFailure` for why that beats writing a zero.
 */
async function executeDraftOffer(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
): Promise<InboxActionExecutionResult> {
  const hCtx = asHelperContext(ctx)
  // The engine already validated the payload against `payloadSchema` before
  // calling us. Re-parsing keeps this handler from trusting an untyped
  // `unknown` and applies the schema's defaults (`lineItems[].kind`).
  const payload = orderPayloadSchema.parse(action.payload)

  let channelId = payload.channelId
  if (!channelId) {
    channelId = (await resolveActiveChannelId(hCtx)) ?? undefined
    if (!channelId) {
      throw new ExecutionError(
        'No active sales channel in this organization. Activate one under Sales > Channels, or set channelId in the action payload.',
        400,
      )
    }
  }

  const currencyCode = payload.currencyCode.trim().toUpperCase()

  // `productId` is carried through because core builds the extraction prompt
  // from PRODUCT rows (inbox_ops/lib/catalogLookup.ts:91-96), so a product id is
  // a thing the model can honestly return. `resolveVariantForLine` turns it into
  // the variant that owns the price.
  const requestedLines = payload.lineItems.map((line, index) => ({
    variantId: line.variantId ?? null,
    sku: line.sku ?? null,
    productId: line.productId ?? null,
    quantity: parseNumberToken(line.quantity, `lineItems[${index}].quantity`),
    label: line.productName,
  }))

  let pricedLines
  try {
    pricedLines = await priceLinesFromCatalog(
      hCtx.em,
      { tenantId: hCtx.tenantId, organizationId: hCtx.organizationId },
      { currencyCode, channelId, lines: requestedLines },
    )
  } catch (err) {
    if (err instanceof CatalogPricingError) throw describePricingFailure(err)
    throw err
  }

  // `priceLinesFromCatalog` returns one entry per requested line, in order, or
  // throws. Checked rather than assumed: a misalignment here would put one
  // line's price on another line's name, which is the worst way to be wrong.
  if (pricedLines.length !== payload.lineItems.length) {
    throw new ExecutionError(
      `Pricing returned ${pricedLines.length} line(s) for ${payload.lineItems.length} requested; refusing to guess which price belongs to which line.`,
      500,
    )
  }

  const lines = payload.lineItems.map((source, index) => {
    const priced = pricedLines[index]!
    const mappedLine: Record<string, unknown> = {
      lineNumber: index + 1,
      kind: source.kind ?? 'service',
      name: source.productName,
      description: source.description,
      quantity: priced.quantity,
      currencyCode,
      productId: priced.productId,
      productVariantId: priced.variantId,
      unitPriceNet: priced.unitPriceNet,
      priceMode: 'net' as const,
      // Provenance the salesperson can check: which catalog row this money
      // came from, and what it was when the quote was drafted.
      catalogSnapshot: {
        sku: priced.sku,
        priceId: priced.priceId,
        unitPriceNet: priced.unitPriceNet,
        currencyCode: priced.currencyCode,
        pricedAt: new Date().toISOString(),
      },
    }
    return mappedLine
  })

  let customerEntityId = payload.customerEntityId
  if (!customerEntityId && payload.customerEmail) {
    customerEntityId = (await resolveCustomerEntityIdByEmail(hCtx, payload.customerEmail)) ?? undefined
  }

  const createInput: Record<string, unknown> = {
    organizationId: hCtx.organizationId,
    tenantId: hCtx.tenantId,
    customerEntityId,
    customerReference: payload.customerReference,
    channelId,
    currencyCode,
    taxRateId: payload.taxRateId,
    comments: payload.notes,
    metadata: buildSourceMetadata(action.id, action.proposalId),
    lines,
  }

  // No customer record yet: keep the sender on the quote as a snapshot so the
  // salesperson still knows who asked, exactly as core does.
  if (!customerEntityId) {
    createInput.customerSnapshot = {
      displayName: payload.customerName,
      ...(payload.customerEmail && { primaryEmail: payload.customerEmail }),
    }
  }

  const billingSnapshot = payload.billingAddress
    ? normalizeAddressSnapshot(payload.billingAddress)
    : undefined
  const shippingSnapshot = payload.shippingAddress
    ? normalizeAddressSnapshot(payload.shippingAddress)
    : undefined

  if (shippingSnapshot || billingSnapshot) {
    createInput.shippingAddressSnapshot = shippingSnapshot ?? billingSnapshot
    createInput.billingAddressSnapshot = billingSnapshot ?? shippingSnapshot
  } else if (payload.billingAddressId || payload.shippingAddressId) {
    createInput.billingAddressId = payload.billingAddressId ?? payload.shippingAddressId
    createInput.shippingAddressId = payload.shippingAddressId ?? payload.billingAddressId
  }

  const requestedDeliveryAt = parseDateToken(payload.requestedDeliveryDate ?? undefined)
  if (requestedDeliveryAt) createInput.expectedDeliveryAt = requestedDeliveryAt

  const draftStatusEntryId = await resolveDraftStatusEntryId(hCtx)
  if (draftStatusEntryId) createInput.statusEntryId = draftStatusEntryId

  const result = await executeCommand<Record<string, unknown>, { quoteId?: string }>(
    hCtx,
    'sales.quotes.create',
    createInput,
  )
  if (!result.quoteId) {
    throw new ExecutionError('Quote creation did not return a quote ID', 500)
  }

  logger.info(DRAFT_OFFER_EXECUTED_MARKER, {
    pricedFrom: 'catalog',
    // How each line found its catalogue row. A run of `variant_id_was_product_id`
    // means the model is confusing product ids for variant ids and the prompt,
    // not the data, needs the fix.
    resolvedBy: pricedLines.map((line) => line.resolvedBy),
    lineTotalsNet: pricedLines.map((line) => line.lineTotalNet),
    actionId: action.id,
    proposalId: action.proposalId,
    quoteId: result.quoteId,
    channelId,
    statusEntryId: draftStatusEntryId,
    currencyCode,
    lineCount: lines.length,
    customerEntityId: customerEntityId ?? null,
    tenantId: hCtx.tenantId,
    organizationId: hCtx.organizationId,
    executedByUserId: hCtx.userId,
  })

  return {
    createdEntityId: result.quoteId,
    createdEntityType: DRAFT_OFFER_CREATED_ENTITY_TYPE,
  }
}

export const inboxActions: InboxActionDefinition[] = [
  {
    type: DRAFT_OFFER_ACTION_TYPE,
    requiredFeature: DRAFT_OFFER_REQUIRED_FEATURE,
    payloadSchema: draftOfferPayloadSchema,
    label: 'Draft Offer',
    // This string ships in EVERY extraction prompt for this tenant, so it stays
    // short. It names the freight services by what they are for, because a
    // model that has to pick between four near-identical transport SKUs gets it
    // right from the unit ("per pallet", "per stop") far more reliably than
    // from the title alone.
    promptSchema: `draft_offer payload (same shape as create_order / create_quote):
{ customerName: string, customerEmail?: string, currencyCode: string (3-letter ISO, use EUR unless the email states otherwise), lineItems: [{ productName: string (REQUIRED, copy the catalogue name), sku: string (REQUIRED, copy it EXACTLY from the catalogue list at the end of this prompt), quantity: string (a number, e.g. "8"), kind: "service", description?: string (route, weights, constraints, in the sender's own words) }], requestedDeliveryDate?: ISO date, notes?: string, customerReference?: string, shippingAddress?: { line1?: string, city?: string, postalCode?: string, country?: string, company?: string, contactName?: string }, billingAddress?: { ...same } }
This seller sells road freight. One line per service asked for: per-pallet groupage, per-shipment full truckload, per-kilometre line haul, and accessorials such as a tail-lift delivery. A tail-lift, a no-dock delivery or a ground-level handover is its OWN line with quantity = number of stops.`,
    promptRules: [
      'Propose draft_offer when the sender asks for a transport price, an offer, a rate or indicative pricing. Accepting it creates a sales quote in draft, priced from the catalogue, for a salesperson to review and send.',
      'For draft_offer: every lineItem MUST carry a sku copied verbatim from the "Catalog products" list at the end of this prompt. Never invent a sku, never translate it, never reformat it. If nothing in that list fits what the sender asked for, leave that request out of the lineItems and raise a product_not_found discrepancy instead.',
      'For draft_offer: NEVER supply unitPrice, price or any amount, not even one shown in the catalogue list. Any amount you write is discarded. Every price is read from the catalogue after a human accepts the action, and a line whose sku matches nothing makes the whole action fail with no quote created.',
      'For draft_offer: quantity is what the sender asked for in that service\'s own unit — pallets for per-pallet groupage, stops for a tail-lift, kilometres for per-kilometre haul, 1 for a single full truckload. Never put a weight or a price in quantity.',
    ],
    execute: executeDraftOffer,
  },
]

export default inboxActions
