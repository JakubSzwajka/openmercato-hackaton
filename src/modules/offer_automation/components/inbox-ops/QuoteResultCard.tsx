"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, FileText } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import {
  buildQuoteResultView,
  resolveQuoteStatusVariant,
  type QuoteLineSummary,
  type QuoteRecord,
} from '../../lib/proposalPresentation'

export type QuoteResultCardProps = {
  quoteId: string
  lines: QuoteLineSummary[]
}

/**
 * What the proposal produced, on the page that produced it.
 *
 * The figures come from the sales quote read route
 * (`GET /api/sales/quotes?id=…`, which is how core's own quote detail page
 * fetches a single document — `sales/backend/sales/documents/[id]/page.tsx:975`
 * — there is no separate detail endpoint). The line list comes from the action
 * payload instead, because that is already on the page and is the exact list
 * the reviewer accepted.
 *
 * Every failure degrades to the bare link: no `sales` module, a 403, a deleted
 * row, a thrown request. The card never disappears and never throws, because
 * the link to the record is the one thing on it that must survive.
 */
export function QuoteResultCard({ quoteId, lines }: QuoteResultCardProps) {
  const t = useT()
  const locale = useLocale()
  const [record, setRecord] = React.useState<QuoteRecord | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setRecord(null)
    ;(async () => {
      try {
        const params = new URLSearchParams({ id: quoteId, page: '1', pageSize: '1' })
        const call = await apiCall<{ items?: QuoteRecord[] }>(
          `/api/sales/quotes?${params.toString()}`,
          undefined,
          { fallback: null },
        )
        if (cancelled) return
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setRecord(call.ok && items.length > 0 ? items[0]! : null)
      } catch {
        if (!cancelled) setRecord(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quoteId])

  const view = React.useMemo(
    () => buildQuoteResultView({ quoteId, record, lines }),
    [quoteId, record, lines],
  )

  const formattedTotal = React.useMemo(() => {
    if (view.netTotal === null) return null
    try {
      return view.currencyCode
        ? new Intl.NumberFormat(locale, { style: 'currency', currency: view.currencyCode }).format(view.netTotal)
        : new Intl.NumberFormat(locale).format(view.netTotal)
    } catch {
      // An unknown currency code makes Intl throw; the raw number still reads.
      return String(view.netTotal)
    }
  }, [locale, view.currencyCode, view.netTotal])

  return (
    <section className="border rounded-lg p-3 md:p-4" aria-labelledby="offer-automation-result-title">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden />
        <h3 id="offer-automation-result-title" className="font-semibold text-sm">
          {t('offer_automation.proposal.result.title', 'Result')}
        </h3>
      </div>

      {isLoading ? (
        <LoadingMessage label={t('offer_automation.proposal.result.loading', 'Loading the quote…')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {view.isFallbackTitle
                ? t('offer_automation.proposal.result.unnumbered', 'Quote (number unavailable)')
                : view.title}
            </span>
            {view.status ? (
              <StatusBadge variant={resolveQuoteStatusVariant(view.status)} dot>
                {t(`offer_automation.proposal.result.status.${view.status}`, view.status)}
              </StatusBadge>
            ) : null}
          </div>

          {view.degraded ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                'offer_automation.proposal.result.degraded',
                'The quote details could not be loaded. The link below still opens it.',
              )}
            </p>
          ) : null}

          {view.lines.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {view.lines.map((line, index) => (
                <li key={`${line.label}-${index}`}>
                  {line.quantity ? `${line.quantity} × ${line.label}` : line.label}
                </li>
              ))}
            </ul>
          ) : null}

          {formattedTotal ? (
            <p className="mt-2 text-sm font-medium">
              {t('offer_automation.proposal.result.netTotal', '{total} net').replace('{total}', formattedTotal)}
            </p>
          ) : null}

          <Link href={view.href} className="mt-3 inline-block">
            <Button type="button" variant="outline" size="sm" className="h-11 md:h-9">
              {t('offer_automation.proposal.result.open', 'Open quote')}
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" aria-hidden />
            </Button>
          </Link>
        </>
      )}
    </section>
  )
}

export default QuoteResultCard
