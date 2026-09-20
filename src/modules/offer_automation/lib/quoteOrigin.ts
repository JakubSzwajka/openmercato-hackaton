/**
 * One place that knows how an inbox-originated sales document is labelled.
 *
 * Core's `buildSourceMetadata` (node_modules/@open-mercato/core/src/modules/
 * inbox_ops/lib/executionHelpers.ts:175-181) writes exactly these three keys
 * onto the document it creates, and `draft_offer` passes its return value
 * straight through as the quote's `metadata`. Reading them back is therefore
 * reading core's own convention, not a second one this app invented.
 */

export const INBOX_OPS_SOURCE = 'inbox_ops'

export type QuoteOrigin = {
  proposalId: string
  actionId: string | null
  /** Backend destination of the request this quote came from. */
  proposalHref: string
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Returns the origin of a sales document, or `null` when it was not created
 * from an inbox request.
 *
 * Deliberately tolerant: a quote whose metadata carries the proposal id but
 * lost `source` still links, because the id is the thing the operator needs.
 * A quote with no proposal id links nowhere, whatever `source` claims.
 */
export function readQuoteOrigin(metadata: unknown): QuoteOrigin | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const record = metadata as Record<string, unknown>

  const proposalId = readString(record, 'inboxOpsProposalId')
  if (!proposalId) return null

  return {
    proposalId,
    actionId: readString(record, 'inboxOpsActionId'),
    proposalHref: buildProposalHref(proposalId),
  }
}

export function buildProposalHref(proposalId: string): string {
  return `/backend/inbox-ops/proposals/${encodeURIComponent(proposalId)}`
}

export function buildQuoteHref(quoteId: string): string {
  return `/backend/sales/quotes/${encodeURIComponent(quoteId)}`
}
