import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
// Reuse the installed payload contract instead of inventing a parallel one.
// See the comment on the same import in `../inbox-actions.ts`.
import { orderPayloadSchema } from '@open-mercato/core/modules/inbox_ops/data/validators'
import type { OrderPayload } from '@open-mercato/core/modules/inbox_ops/data/validators'
import {
  executeCommand,
  ExecutionError,
  normalizeAddressSnapshot,
  parseDateToken,
  parseNumberToken,
  resolveCustomerEntityIdByEmail,
  resolveEntityClass,
  type ExecutionHelperContext,
} from '@open-mercato/core/modules/inbox_ops/lib/executionHelpers'
import { CatalogPricingError, priceLinesFromCatalog } from './catalogPricing'

/**
 * The one place this app turns a validated draft-offer payload into a real
 * sales quote, priced from the catalogue.
 *
 * Lifted verbatim out of the `draft_offer` inbox action handler so a second
 * caller — the `offer_automation.offers.draft` command, which an
 * `EXECUTE_FUNCTION` workflow node reaches — runs the identical logic. The
 * inbox action now calls `createDraftOfferQuote` and is otherwise unchanged.
 *
 * Every rule the inbox action enforced still lives here:
 *
 * - Every unit price comes from `catalog_product_variant_prices` through
 *   `priceLinesFromCatalog`. A `unitPrice` in the payload is IGNORED, because
 *   the payload is the part a model writes and a model must never set a price.
 * - A line the catalogue cannot price fails the WHOLE draft. Nothing partial is
 *   written: `sales.quotes.create` is never called. See
 *   `describePricingFailure` for why refusing beats writing a zero.
 * - No discounts. This build prices at list and never sets `discountAmount`,
 *   `discountPercent` or a promotion code.
 */

/** The payload contract is core's. Re-exported so every caller shares one shape. */
export const draftOfferPayloadSchema = orderPayloadSchema

export type DraftOfferPayload = OrderPayload

/**
 * Grep marker printed on a successful draft. Kept as a single opaque token so an
 * operator can prove the quote came from app-owned code:
 *
 *   yarn dev 2>&1 | grep OFFER_AUTOMATION_DRAFT_OFFER_EXECUTED
 */
export const DRAFT_OFFER_EXECUTED_MARKER = 'OFFER_AUTOMATION_DRAFT_OFFER_EXECUTED'

/**
 * Entity type written back onto an accepted inbox action. The proposal card
 * renders it verbatim as "Created sales_quote" (ActionCard.tsx:256-261).
 */
export const DRAFT_OFFER_CREATED_ENTITY_TYPE = 'sales_quote'

/** ACL feature both the inbox action and the command require. */
export const DRAFT_OFFER_REQUIRED_FEATURE = 'offer_automation.offers.draft'

/**
 * Id of the command that wraps this helper (`../commands/draftOffer.ts`).
 *
 * Declared here, in a file with no `registerCommand` side effect, so the
 * workflow function and `../workflows.ts` can name the command without
 * importing the module that registers it. Same string as the ACL feature by
 * coincidence of naming, not by contract: they are two separate constants.
 */
export const DRAFT_OFFER_COMMAND_ID = 'offer_automation.offers.draft'

const logger = createLogger('offer_automation').child({ component: 'draft-offer' })

/**
 * Everything the quote build needs from its caller.
 *
 * Structurally identical to inbox_ops' `ExecutionHelperContext` on purpose: the
 * inbox action hands its own `hCtx` straight through, so the cross-module entity
 * map it carries and the command-log entry `executeCommand` stamps onto it both
 * survive the refactor untouched. Any other caller builds one with
 * `buildDraftOfferContext`.
 */
export type DraftOfferExecutionContext = {
  em: EntityManager
  userId: string
  tenantId: string
  organizationId: string
  container: AwilixContainer
  auth?: AuthContext
  entities?: ExecutionHelperContext['entities']
}

export type DraftOfferScope = {
  tenantId: string
  organizationId: string
  userId: string
}

export type DraftOfferOptions = {
  /** Stamped onto the quote's `metadata`. The inbox action passes its provenance. */
  metadata?: Record<string, unknown>
  /** Extra fields for the success log line (action id, proposal id, workflow instance id). */
  logContext?: Record<string, unknown>
}

export type DraftOfferResult = {
  quoteId: string
  /** One short operator-readable line. Safe to put in a workflow context. */
  summary: string
  currencyCode: string
  channelId: string
  lineCount: number
  customerEntityId: string | null
  statusEntryId: string | null
}

/**
 * Fail closed on scope.
 *
 * Both callers derive tenant and organization from a trusted context — the
 * inbox action from the execution engine, the command from its runtime context —
 * and neither ever reads them off the payload. A blank here means the caller
 * could not resolve a scope, and drafting a quote into "no organization" is the
 * one outcome that leaks across tenants, so it refuses instead.
 */
export function assertDraftOfferScope(scope: Partial<DraftOfferScope>): DraftOfferScope {
  const tenantId = typeof scope.tenantId === 'string' ? scope.tenantId.trim() : ''
  const organizationId = typeof scope.organizationId === 'string' ? scope.organizationId.trim() : ''
  const userId = typeof scope.userId === 'string' ? scope.userId.trim() : ''
  const missing = [
    ...(tenantId ? [] : ['tenantId']),
    ...(organizationId ? [] : ['organizationId']),
    ...(userId ? [] : ['userId']),
  ]
  if (missing.length > 0) {
    throw new ExecutionError(
      `Refusing to draft an offer without a resolved scope (missing: ${missing.join(', ')}). ` +
        'Tenant, organization and the acting user come from the execution context, never from the payload.',
      400,
    )
  }
  return { tenantId, organizationId, userId }
}

/**
 * Build a draft-offer context from a DI container and an already-resolved scope.
 *
 * `entities` is deliberately left unset: `resolveEntityClass` falls back to
 * `container.resolve(key)`, and sales / customers register their entity classes
 * under exactly those keys (`sales/di.ts:168`).
 */
export function buildDraftOfferContext(
  container: AwilixContainer,
  scope: Partial<DraftOfferScope>,
): DraftOfferExecutionContext {
  const resolved = assertDraftOfferScope(scope)
  const em = container.resolve('em') as EntityManager
  return {
    em,
    container,
    userId: resolved.userId,
    tenantId: resolved.tenantId,
    organizationId: resolved.organizationId,
  }
}

/**
 * Resolves the `draft` entry of the `sales.order_status` dictionary, which is
 * the dictionary the quote list and quote detail read their status badge from.
 *
 * Core's own `create_quote` leaves `statusEntryId` unset, so its quotes show a
 * blank status. We set the initial status explicitly because "draft" is the
 * finish line of this flow and the salesperson has to see it. This is the
 * document's starting state, not a transition.
 *
 * Imported lazily so an app without the `sales` module still loads this module;
 * the failure then lands on execution, where it belongs.
 */
async function resolveDraftStatusEntryId(ctx: DraftOfferExecutionContext): Promise<string | null> {
  try {
    const { resolveStatusEntryIdByValue } = await import(
      '@open-mercato/core/modules/sales/lib/statusHelpers'
    )
    return await resolveStatusEntryIdByValue(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
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
async function resolveActiveChannelId(ctx: DraftOfferExecutionContext): Promise<string | null> {
  const SalesChannelClass = resolveEntityClass(ctx as ExecutionHelperContext, 'SalesChannel')
  if (!SalesChannelClass) return null

  const channel = (await findOneWithDecryption(
    ctx.em,
    SalesChannelClass,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      isActive: true,
      deletedAt: null,
    } as never,
    { orderBy: { name: 'ASC' } } as never,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )) as { id: string } | null

  return channel?.id ?? null
}

/**
 * Turns a pricing failure into the message the reviewer reads.
 *
 * WHY THE WHOLE DRAFT FAILS instead of writing the line at zero with a marker:
 * a draft quote is a document a person sends. A zero line with a marker relies
 * on that person noticing the marker, and the one outcome nobody can recover
 * from is a quote that left the building priced at nothing. Refusing costs a
 * retry, and the message names every line that could not be priced and why, so
 * the fix is one catalogue edit away.
 *
 * 422 rather than 400: the payload is well-formed, the catalogue cannot satisfy it.
 */
export function describePricingFailure(error: CatalogPricingError): ExecutionError {
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
 * Turns a validated draft-offer payload into a sales quote in draft, priced from
 * the catalogue.
 *
 * Mirrors `executeCreateDocumentAction` from
 * `node_modules/@open-mercato/core/src/modules/sales/inbox-actions.ts:40-143`
 * (quote branch) so the quote this app writes is indistinguishable from one
 * core's own `create_quote` would have written — except for the pricing, which
 * diverges on purpose: core passes the model's amount straight through
 * (`sales/inbox-actions.ts:46-47, :61`) and we never do.
 */
export async function createDraftOfferQuote(
  payload: DraftOfferPayload,
  ctx: DraftOfferExecutionContext,
  options: DraftOfferOptions = {},
): Promise<DraftOfferResult> {
  // Re-parsing keeps this function from trusting an untyped payload and applies
  // the schema's defaults (`lineItems[].kind`). Cheap, and it means a caller
  // that skipped validation cannot reach the catalogue lookups.
  const parsed = draftOfferPayloadSchema.parse(payload)
  assertDraftOfferScope(ctx)

  let channelId = parsed.channelId
  if (!channelId) {
    channelId = (await resolveActiveChannelId(ctx)) ?? undefined
    if (!channelId) {
      throw new ExecutionError(
        'No active sales channel in this organization. Activate one under Sales > Channels, or set channelId in the action payload.',
        400,
      )
    }
  }

  const currencyCode = parsed.currencyCode.trim().toUpperCase()

  // `productId` is carried through because core builds the extraction prompt
  // from PRODUCT rows (inbox_ops/lib/catalogLookup.ts:91-96), so a product id is
  // a thing a model can honestly return. `resolveVariantForLine` turns it into
  // the variant that owns the price.
  const requestedLines = parsed.lineItems.map((line, index) => ({
    variantId: line.variantId ?? null,
    sku: line.sku ?? null,
    productId: line.productId ?? null,
    quantity: parseNumberToken(line.quantity, `lineItems[${index}].quantity`),
    label: line.productName,
  }))

  let pricedLines
  try {
    pricedLines = await priceLinesFromCatalog(
      ctx.em,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      { currencyCode, channelId, lines: requestedLines },
    )
  } catch (err) {
    if (err instanceof CatalogPricingError) throw describePricingFailure(err)
    throw err
  }

  // `priceLinesFromCatalog` returns one entry per requested line, in order, or
  // throws. Checked rather than assumed: a misalignment here would put one
  // line's price on another line's name, which is the worst way to be wrong.
  if (pricedLines.length !== parsed.lineItems.length) {
    throw new ExecutionError(
      `Pricing returned ${pricedLines.length} line(s) for ${parsed.lineItems.length} requested; refusing to guess which price belongs to which line.`,
      500,
    )
  }

  const lines = parsed.lineItems.map((source, index) => {
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
      // Provenance the salesperson can check: which catalogue row this money
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

  let customerEntityId = parsed.customerEntityId
  if (!customerEntityId && parsed.customerEmail) {
    customerEntityId =
      (await resolveCustomerEntityIdByEmail(ctx as ExecutionHelperContext, parsed.customerEmail)) ??
      undefined
  }

  const createInput: Record<string, unknown> = {
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    customerEntityId,
    customerReference: parsed.customerReference,
    channelId,
    currencyCode,
    taxRateId: parsed.taxRateId,
    comments: parsed.notes,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    lines,
  }

  // No customer record yet: keep the sender on the quote as a snapshot so the
  // salesperson still knows who asked, exactly as core does.
  if (!customerEntityId) {
    createInput.customerSnapshot = {
      displayName: parsed.customerName,
      ...(parsed.customerEmail && { primaryEmail: parsed.customerEmail }),
    }
  }

  const billingSnapshot = parsed.billingAddress
    ? normalizeAddressSnapshot(parsed.billingAddress)
    : undefined
  const shippingSnapshot = parsed.shippingAddress
    ? normalizeAddressSnapshot(parsed.shippingAddress)
    : undefined

  if (shippingSnapshot || billingSnapshot) {
    createInput.shippingAddressSnapshot = shippingSnapshot ?? billingSnapshot
    createInput.billingAddressSnapshot = billingSnapshot ?? shippingSnapshot
  } else if (parsed.billingAddressId || parsed.shippingAddressId) {
    createInput.billingAddressId = parsed.billingAddressId ?? parsed.shippingAddressId
    createInput.shippingAddressId = parsed.shippingAddressId ?? parsed.billingAddressId
  }

  const requestedDeliveryAt = parseDateToken(parsed.requestedDeliveryDate ?? undefined)
  if (requestedDeliveryAt) createInput.expectedDeliveryAt = requestedDeliveryAt

  const draftStatusEntryId = await resolveDraftStatusEntryId(ctx)
  if (draftStatusEntryId) createInput.statusEntryId = draftStatusEntryId

  const result = await executeCommand<Record<string, unknown>, { quoteId?: string }>(
    ctx as ExecutionHelperContext,
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
    quoteId: result.quoteId,
    channelId,
    statusEntryId: draftStatusEntryId,
    currencyCode,
    lineCount: lines.length,
    customerEntityId: customerEntityId ?? null,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    executedByUserId: ctx.userId,
    ...(options.logContext ?? {}),
  })

  return {
    quoteId: result.quoteId,
    summary: `Drafted quote ${result.quoteId} for ${parsed.customerName} with ${lines.length} catalogue-priced line(s) in ${currencyCode}.`,
    currencyCode,
    channelId,
    lineCount: lines.length,
    customerEntityId: customerEntityId ?? null,
    statusEntryId: draftStatusEntryId,
  }
}
