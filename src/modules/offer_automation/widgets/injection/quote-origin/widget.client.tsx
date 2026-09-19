"use client"

import * as React from 'react'
import Link from 'next/link'
import { Mail, ArrowUpRight } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readQuoteOrigin, type QuoteOrigin } from '../../../lib/quoteOrigin'

type DocumentDetailContext = {
  kind?: 'order' | 'quote'
  record?: { id?: string; metadata?: unknown } | null
}

type ProposalDetailResponse = {
  proposal?: { id?: string; summary?: string | null; category?: string | null } | null
  email?: { subject?: string | null; forwardedByName?: string | null; forwardedByAddress?: string | null } | null
}

type ProposalLabel = {
  /** What the operator recognises: the email subject, or the proposal summary. */
  title: string | null
  sender: string | null
}

function readOrigin(context: unknown, data: unknown): QuoteOrigin | null {
  const ctx = context && typeof context === 'object' ? (context as DocumentDetailContext) : null
  const fromContext = readQuoteOrigin(ctx?.record?.metadata)
  if (fromContext) return fromContext
  // The host also passes the record as `data`; fall back to it so the widget
  // keeps working if the context shape ever narrows.
  const payload = data && typeof data === 'object' ? (data as { metadata?: unknown }) : null
  return readQuoteOrigin(payload?.metadata)
}

/**
 * Shows where an inbox-originated sales quote came from, and links back to it.
 *
 * Renders nothing at all for a quote that was not created from an inbox
 * request — the overwhelming majority — so a hand-made quote's detail page
 * looks exactly as it did before this module was installed.
 */
export default function QuoteOriginWidget({ context, data }: InjectionWidgetComponentProps) {
  const t = useT()
  const origin = React.useMemo(() => readOrigin(context, data), [context, data])
  const [label, setLabel] = React.useState<ProposalLabel | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const proposalId = origin?.proposalId ?? null

  React.useEffect(() => {
    if (!proposalId) {
      setLabel(null)
      setFailed(false)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    ;(async () => {
      try {
        const payload = await readApiResultOrThrow<ProposalDetailResponse>(
          `/api/inbox_ops/proposals/${encodeURIComponent(proposalId)}`,
          undefined,
          { allowNullResult: true },
        )
        if (cancelled) return
        const subject = payload?.email?.subject?.trim() || null
        const summary = payload?.proposal?.summary?.trim() || null
        setLabel({
          title: subject || summary,
          sender: payload?.email?.forwardedByName?.trim() || payload?.email?.forwardedByAddress?.trim() || null,
        })
      } catch {
        // The link itself still works; only the human-readable title is lost.
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [proposalId])

  if (!origin) return null

  return (
    <section
      className="rounded-md border border-border bg-muted/30 p-3"
      aria-labelledby="offer-automation-quote-origin-title"
    >
      <div className="flex items-start gap-2">
        <Mail className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p id="offer-automation-quote-origin-title" className="text-sm font-medium text-foreground">
            {t('offer_automation.quoteOrigin.title', 'Created from an inbox request')}
          </p>

          {loading ? (
            <LoadingMessage
              label={t('offer_automation.quoteOrigin.loading', 'Loading the originating request…')}
              className="mt-1"
            />
          ) : null}

          {!loading && failed ? (
            <ErrorMessage
              label={t(
                'offer_automation.quoteOrigin.error',
                'Could not load the request details. The link below still works.',
              )}
              className="mt-1"
            />
          ) : null}

          {!loading && !failed && label ? (
            <p className="truncate text-sm text-muted-foreground">
              {label.title ?? t('offer_automation.quoteOrigin.untitled', 'Untitled request')}
              {label.sender ? ` · ${label.sender}` : ''}
            </p>
          ) : null}

          <Link
            href={origin.proposalHref}
            className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('offer_automation.quoteOrigin.open', 'Open the request')}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  )
}
