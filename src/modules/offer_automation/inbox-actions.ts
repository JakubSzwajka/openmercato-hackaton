import type {
  InboxActionDefinition,
  InboxActionExecutionContext,
  InboxActionExecutionResult,
} from '@open-mercato/shared/modules/inbox-actions'
import {
  asHelperContext,
  buildSourceMetadata,
} from '@open-mercato/core/modules/inbox_ops/lib/executionHelpers'
import {
  createDraftOfferQuote,
  draftOfferPayloadSchema,
  DRAFT_OFFER_CREATED_ENTITY_TYPE,
  DRAFT_OFFER_EXECUTED_MARKER,
  DRAFT_OFFER_REQUIRED_FEATURE,
  type DraftOfferPayload,
} from './lib/draftOffer'

// The quote-building body now lives in `./lib/draftOffer.ts` so the
// `offer_automation.offers.draft` command — which an `EXECUTE_FUNCTION`
// workflow node reaches — runs the identical logic. Every constant and the
// payload schema are re-exported from here unchanged, because the CLI seeds and
// the tests import them from this module.
export {
  DRAFT_OFFER_EXECUTED_MARKER,
  DRAFT_OFFER_REQUIRED_FEATURE,
  DRAFT_OFFER_CREATED_ENTITY_TYPE,
  draftOfferPayloadSchema,
}
export type { DraftOfferPayload }

export const DRAFT_OFFER_ACTION_TYPE = 'draft_offer'

/**
 * Turns an accepted `draft_offer` into a real sales quote in draft, priced from
 * the catalogue.
 *
 * Everything that decides the quote is in `createDraftOfferQuote`. This handler
 * is the inbox-ops adapter around it: it hands the engine's execution context
 * through verbatim (so the cross-module entity map and the command-log entry
 * `executeCommand` stamps on it both survive), stamps inbox provenance onto the
 * quote's metadata, and reports the created entity back to the proposal card.
 */
async function executeDraftOffer(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
): Promise<InboxActionExecutionResult> {
  const hCtx = asHelperContext(ctx)
  // The engine already validated the payload against `payloadSchema` before
  // calling us; `createDraftOfferQuote` re-parses it anyway.
  const payload = draftOfferPayloadSchema.parse(action.payload)

  const result = await createDraftOfferQuote(payload, hCtx, {
    metadata: buildSourceMetadata(action.id, action.proposalId),
    logContext: { source: 'inbox_action', actionId: action.id, proposalId: action.proposalId },
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
