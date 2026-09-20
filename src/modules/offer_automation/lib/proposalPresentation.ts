/**
 * Presentation rules for the app-owned replacement of the inbox proposal
 * detail page. Pure functions only, so each rule can be pinned by a unit test
 * without a DOM.
 *
 * The page component lives in
 * `src/modules/offer_automation/components/inbox-ops/`; it reads every decision
 * from here rather than inlining it in JSX.
 */

import { buildQuoteHref } from './quoteOrigin'

/**
 * The `createdEntityType` the app's `draft_offer` action writes back.
 *
 * Spelled out here instead of imported from `../inbox-actions`, which pulls
 * MikroORM, the encryption helpers and core's execution engine into whatever
 * imports it. This file is read by a client component, so that import chain
 * would land in the browser bundle. `proposalPresentation.test.ts` asserts the
 * two constants still agree, so the duplication cannot drift silently.
 */
export const DRAFT_OFFER_CREATED_ENTITY_TYPE = 'sales_quote'

/** The app's own inbox action type, for the same reason. */
export const DRAFT_OFFER_ACTION_TYPE = 'draft_offer'

/** Feature the viewer needs before a link into a sales quote is worth showing. */
export const SALES_QUOTE_VIEW_FEATURE = 'sales.quotes.view'

/** Prefix an app-owned action description uses when it stores a translation key. */
export const APP_ACTION_DESCRIPTION_PREFIX = 'offer_automation.action.desc.'

export type CreatedRecordRef = {
  createdEntityId?: string | null
  createdEntityType?: string | null
}

/**
 * Where an executed action's created record can be opened, or `null` when it
 * cannot be.
 *
 * Three ways to get `null`, and they are deliberately different situations:
 * no id at all (nothing was created), a type this app has no route for (a
 * guessed URL is worse than plain text), and a viewer without the feature that
 * guards the destination. In every one of them the caller keeps rendering
 * today's plain "Created {type}" line.
 *
 * `canOpenTarget` is passed in rather than read here so the rule stays pure and
 * the caller owns the wildcard-aware ACL check.
 */
export function resolveCreatedRecordHref(
  action: CreatedRecordRef,
  options: { canOpenTarget: boolean },
): string | null {
  const id = typeof action.createdEntityId === 'string' ? action.createdEntityId.trim() : ''
  if (!id) return null
  if (action.createdEntityType !== DRAFT_OFFER_CREATED_ENTITY_TYPE) return null
  if (!options.canOpenTarget) return null
  return buildQuoteHref(id)
}

/** True when the action produced a sales quote this page can summarise. */
export function readQuoteIdFromAction(action: CreatedRecordRef): string | null {
  const id = typeof action.createdEntityId === 'string' ? action.createdEntityId.trim() : ''
  if (!id) return null
  return action.createdEntityType === DRAFT_OFFER_CREATED_ENTITY_TYPE ? id : null
}

/**
 * Human label for an action type.
 *
 * Core's `useActionTypeLabels()` is a fixed map of its own nine types, so an
 * app-owned type falls through it and the raw `draft_offer` reaches the screen.
 * App labels are merged on top; an unknown type still falls back to the raw
 * string, which is what core does and the only honest thing left to show.
 */
export function resolveActionTypeLabel(
  actionType: string,
  labels: Record<string, string>,
): string {
  const label = labels[actionType]
  return typeof label === 'string' && label.trim().length > 0 ? label.trim() : actionType
}

/**
 * Resolves an app-owned description that was stored as a translation key.
 *
 * Core resolves its own `inbox_ops.action.desc.*` keys and returns anything
 * else untouched, which leaves an `offer_automation.action.desc.*` key printed
 * raw. Anything that is not one of our keys is handed straight back so core's
 * resolver and plain LLM text both keep working.
 */
export function resolveAppActionDescription(
  description: string,
  translate: (key: string, fallback: string) => string,
): string | null {
  if (!description.startsWith(APP_ACTION_DESCRIPTION_PREFIX)) return null
  return translate(description, description)
}

export type QuoteLineSummary = { quantity: string; label: string }

/**
 * One line per drafted service, read from the action payload rather than from
 * the quote.
 *
 * The payload is already on the page, so the summary survives a failed quote
 * fetch, and it is the exact list the reviewer accepted. `sku` is the label
 * because it is what the salesperson matches against the rate card; the
 * product name is the fallback when a payload predates the sku rule.
 */
export function summarizeQuoteLines(payload: unknown): QuoteLineSummary[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const lineItems = (payload as { lineItems?: unknown }).lineItems
  if (!Array.isArray(lineItems)) return []
  const summary: QuoteLineSummary[] = []
  for (const item of lineItems) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const label = readTrimmed(row.sku) ?? readTrimmed(row.productName)
    if (!label) continue
    summary.push({ quantity: readTrimmed(row.quantity) ?? '', label })
  }
  return summary
}

function readTrimmed(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export type QuoteRecord = {
  id?: string
  quoteNumber?: string | null
  status?: string | null
  currencyCode?: string | null
  grandTotalNetAmount?: number | null
  subtotalNetAmount?: number | null
}

export type QuoteResultView = {
  /** Always present: the link is the part that must never be lost. */
  href: string
  /** The quote number, or the id when the read failed or returned nothing. */
  title: string
  /** True when `title` is an id rather than a number, so the UI can say so. */
  isFallbackTitle: boolean
  status: string | null
  netTotal: number | null
  currencyCode: string | null
  lines: QuoteLineSummary[]
  degraded: boolean
}

/**
 * Builds the Result card's view model, including the degraded one.
 *
 * `record` is `null` whenever the quote could not be read: `sales` is not
 * installed, the route answered 403, the row is gone, the request threw. Every
 * one of those collapses to the same safe output, a working link labelled with
 * the id, because a half-rendered figure is worse than none and a thrown error
 * would blank a page whose other half is fine.
 */
export function buildQuoteResultView(input: {
  quoteId: string
  record: QuoteRecord | null
  lines: QuoteLineSummary[]
}): QuoteResultView {
  const href = buildQuoteHref(input.quoteId)
  const number = readTrimmed(input.record?.quoteNumber)
  const netTotal = readFiniteNumber(input.record?.grandTotalNetAmount) ?? readFiniteNumber(input.record?.subtotalNetAmount)
  return {
    href,
    title: number ?? input.quoteId,
    isFallbackTitle: number === null,
    status: readTrimmed(input.record?.status),
    netTotal,
    currencyCode: readTrimmed(input.record?.currencyCode),
    lines: input.lines,
    degraded: input.record === null,
  }
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const QUOTE_STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  expired: 'warning',
  cancelled: 'neutral',
}

export function resolveQuoteStatusVariant(status: string | null): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  if (!status) return 'neutral'
  return QUOTE_STATUS_VARIANTS[status.toLowerCase()] ?? 'neutral'
}
