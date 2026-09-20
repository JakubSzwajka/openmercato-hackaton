"use client"

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Link2 } from 'lucide-react'
import type { OfferOriginRow } from '../../../api/origins/route'

const PAGE_SIZE = 20

type OriginsResponse = {
  items?: OfferOriginRow[]
  hasNextPage?: boolean
}

const STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  executed: 'success',
  pending: 'warning',
  rejected: 'neutral',
  failed: 'error',
}

function RecordLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {label}
    </Link>
  )
}

/**
 * Both ends of the trail in one list, owned by this app.
 *
 * This page exists because the forward leg cannot be added to core's own
 * proposal page: `inbox_ops` publishes no UI injection host, and its accepted
 * action card renders a fixed set of fields, so a response enricher has nothing
 * to render into. Replacing the whole core page to add one link is a far worse
 * trade than a small list of our own.
 */
export default function OfferOriginsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<OfferOriginRow[]>([])
  const [page, setPage] = React.useState(1)
  const [hasNextPage, setHasNextPage] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    const call = await apiCall<OriginsResponse>(`/api/offer_automation/origins?${params.toString()}`, undefined, {
      fallback: null,
    })
    if (!call.result) {
      setRows([])
      setHasNextPage(false)
      setError(t('offer_automation.origins.error', 'Failed to load offer origins.'))
      setLoading(false)
      return
    }
    setRows(Array.isArray(call.result.items) ? call.result.items : [])
    setHasNextPage(call.result.hasNextPage === true)
    setLoading(false)
  }, [page, t])

  React.useEffect(() => {
    void load()
  }, [load, scopeVersion])

  const columns = React.useMemo<ColumnDef<OfferOriginRow>[]>(
    () => [
      {
        accessorKey: 'proposalSummary',
        header: t('offer_automation.origins.column.request', 'Request'),
        enableSorting: false,
        meta: { priority: 1 },
        cell: ({ row }) => (
          <RecordLink
            href={row.original.proposalHref}
            label={
              row.original.proposalSummary?.trim() ||
              t('offer_automation.origins.untitledRequest', 'Untitled request')
            }
          />
        ),
      },
      {
        accessorKey: 'quoteNumber',
        header: t('offer_automation.origins.column.quote', 'Quote'),
        enableSorting: false,
        meta: { priority: 2 },
        cell: ({ row }) =>
          row.original.quoteHref && row.original.quoteNumber ? (
            <RecordLink href={row.original.quoteHref} label={row.original.quoteNumber} />
          ) : (
            <span className="text-muted-foreground">
              {t('offer_automation.origins.noQuoteYet', 'Not created yet')}
            </span>
          ),
      },
      {
        accessorKey: 'actionStatus',
        header: t('offer_automation.origins.column.status', 'Status'),
        enableSorting: false,
        meta: { priority: 3 },
        cell: ({ row }) => (
          <StatusBadge variant={STATUS_VARIANTS[row.original.actionStatus] ?? 'neutral'} dot>
            {t(`offer_automation.origins.status.${row.original.actionStatus}`, row.original.actionStatus)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'executedAt',
        header: t('offer_automation.origins.column.acceptedAt', 'Accepted'),
        enableSorting: false,
        meta: { priority: 4 },
        cell: ({ row }) =>
          row.original.executedAt ? (
            // `suppressHydrationWarning`: the server and the browser can sit in
            // different time zones, and this string is locale-formatted.
            <span suppressHydrationWarning>{new Date(row.original.executedAt).toLocaleString()}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        {error ? (
          <ErrorMessage
            label={error}
            className="mb-4"
            action={
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t('offer_automation.origins.retry', 'Try again')}
              </Button>
            }
          />
        ) : null}
        <DataTable
          title={t('offer_automation.origins.page.title', 'Offer origins')}
          titleHeadingLevel={1}
          columns={columns}
          data={rows}
          isLoading={loading}
          entityId="inbox_ops:inbox_proposal_action"
          extensionTableId="offer_automation.origins"
          emptyState={
            <EmptyState
              icon={<Link2 aria-hidden />}
              title={t('offer_automation.origins.empty.title', 'No drafted offers yet')}
              description={t(
                'offer_automation.origins.empty.description',
                'Accept a Draft Offer action on an inbox request and the pair shows up here.',
              )}
            />
          }
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            // The API counts by fetching one extra row instead of running a
            // COUNT over encrypted columns, so the total is a floor.
            total: (page - 1) * PAGE_SIZE + rows.length,
            totalIsCapped: hasNextPage,
            totalPages: hasNextPage ? page + 1 : page,
            onPageChange: setPage,
          }}
        />
      </PageBody>
    </Page>
  )
}
