import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// Read-only report over two installed modules' own tables. No relation is
// declared and nothing is written. Every read is filtered by an explicit
// tenant/organization pair that the caller had to derive from a trusted source.
import { InboxProposal, InboxProposalAction } from '@open-mercato/core/modules/inbox_ops/data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { DRAFT_OFFER_ACTION_TYPE, DRAFT_OFFER_CREATED_ENTITY_TYPE } from '../inbox-actions'
import { buildProposalHref, buildQuoteHref, readQuoteOrigin } from './quoteOrigin'

export type OfferOriginRow = {
  /** The proposal action id. Named `id` because DataTable keys rows on it. */
  id: string
  actionStatus: string
  executedAt: string | null
  proposalId: string
  proposalHref: string
  proposalSummary: string | null
  quoteId: string | null
  quoteHref: string | null
  quoteNumber: string | null
  /**
   * True when the quote's own `metadata` points back at this proposal, i.e.
   * the backward leg of the trail is intact. False means the forward leg from
   * the action row survived but the quote carries no origin, which is what a
   * quote created before `buildSourceMetadata` was wired would look like.
   */
  quoteLinksBack: boolean
}

export type OfferOriginScope = { tenantId: string; organizationId: string }

export type OfferOriginPage = {
  items: OfferOriginRow[]
  page: number
  pageSize: number
  hasNextPage: boolean
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * One page of `draft_offer` actions with the request and the quote they link.
 *
 * Shared by the backend page's API route and the `origins` CLI command so both
 * report the same thing; the CLI is how this is verified without a browser.
 */
export async function listOfferOrigins(
  em: EntityManager,
  scope: OfferOriginScope,
  page: number,
  pageSize: number,
): Promise<OfferOriginPage> {
  const { tenantId, organizationId } = scope

  const actions = await findWithDecryption(
    em,
    InboxProposalAction,
    { actionType: DRAFT_OFFER_ACTION_TYPE, tenantId, organizationId, deletedAt: null } as never,
    { orderBy: { createdAt: 'DESC' }, limit: pageSize + 1, offset: (page - 1) * pageSize } as never,
    scope,
  )

  // One extra row answers "is there a next page" without a COUNT over an
  // encrypted table.
  const hasNextPage = actions.length > pageSize
  const pageRows = hasNextPage ? actions.slice(0, pageSize) : actions

  const proposalIds = [
    ...new Set(pageRows.map((a) => (a as { proposalId?: string }).proposalId).filter(Boolean)),
  ] as string[]
  const quoteIds = [
    ...new Set(
      pageRows
        .filter((a) => (a as { createdEntityType?: string | null }).createdEntityType === DRAFT_OFFER_CREATED_ENTITY_TYPE)
        .map((a) => (a as { createdEntityId?: string | null }).createdEntityId)
        .filter(Boolean),
    ),
  ] as string[]

  const [proposals, quotes] = await Promise.all([
    proposalIds.length
      ? findWithDecryption(
          em,
          InboxProposal,
          { id: { $in: proposalIds }, tenantId, organizationId, deletedAt: null } as never,
          {} as never,
          scope,
        )
      : Promise.resolve([] as unknown[]),
    quoteIds.length
      ? findWithDecryption(
          em,
          SalesQuote,
          { id: { $in: quoteIds }, tenantId, organizationId, deletedAt: null } as never,
          {} as never,
          scope,
        )
      : Promise.resolve([] as unknown[]),
  ])

  const summaryById = new Map(
    (proposals as Array<{ id: string; summary?: string | null }>).map((p) => [p.id, p.summary ?? null]),
  )
  const quoteById = new Map(
    (quotes as Array<{ id: string; quoteNumber?: string | null; metadata?: unknown }>).map((q) => [q.id, q]),
  )

  const items: OfferOriginRow[] = pageRows.map((raw) => {
    const action = raw as {
      id: string
      proposalId: string
      status?: string | null
      executedAt?: unknown
      createdEntityId?: string | null
      createdEntityType?: string | null
    }
    // A quote id that no longer resolves to a visible quote is reported as
    // absent rather than rendered as a link into a 404.
    const quote =
      action.createdEntityType === DRAFT_OFFER_CREATED_ENTITY_TYPE && action.createdEntityId
        ? quoteById.get(action.createdEntityId) ?? null
        : null
    const quoteId = quote ? action.createdEntityId! : null
    const origin = quote ? readQuoteOrigin(quote.metadata) : null

    return {
      id: action.id,
      actionStatus: action.status ?? 'unknown',
      executedAt: toIso(action.executedAt),
      proposalId: action.proposalId,
      proposalHref: buildProposalHref(action.proposalId),
      proposalSummary: summaryById.get(action.proposalId) ?? null,
      quoteId,
      quoteHref: quoteId ? buildQuoteHref(quoteId) : null,
      quoteNumber: quote?.quoteNumber ?? null,
      quoteLinksBack: origin?.proposalId === action.proposalId,
    }
  })

  return { items, page, pageSize, hasNextPage }
}
