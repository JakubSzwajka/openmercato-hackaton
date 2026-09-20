"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, CheckCircle } from 'lucide-react'
import {
  ActionCard,
  useActionDescriptionResolver,
} from '@open-mercato/core/modules/inbox_ops/components/proposals/ActionCard'
import type {
  ActionDetail,
  DiscrepancyDetail,
} from '@open-mercato/core/modules/inbox_ops/components/proposals/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  resolveActionTypeLabel,
  resolveAppActionDescription,
  resolveCreatedRecordHref,
} from '../../lib/proposalPresentation'

export type ProposalActionCardProps = {
  action: ActionDetail
  discrepancies: DiscrepancyDetail[]
  actionTypeLabels: Record<string, string>
  canOpenCreatedQuote: boolean
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onRetry: (id: string) => void
  onEdit: (action: ActionDetail) => void
  translatedDescription?: string
  resolveDiscrepancyDescription?: (description: string, foundValue?: string | null) => string
}

/**
 * Core's action card, with the executed state replaced.
 *
 * Only the executed branch is rewritten. Core's
 * `components/proposals/ActionCard.tsx:259` prints `Created {type} · {date}` as
 * plain text even though `action.createdEntityId` is right there in scope, so a
 * reviewer who just accepted an action has no way to reach what it produced.
 * Pending, failed, rejected and processing all keep core's own rendering,
 * including its accept/edit/reject/retry buttons and their `h-11 md:h-9` touch
 * targets, because nothing about those states needs changing and forking them
 * would mean maintaining a second copy of the blocking-discrepancy rules.
 */
export function ProposalActionCard({
  action,
  discrepancies,
  actionTypeLabels,
  canOpenCreatedQuote,
  onAccept,
  onReject,
  onRetry,
  onEdit,
  translatedDescription,
  resolveDiscrepancyDescription,
}: ProposalActionCardProps) {
  const t = useT()
  const resolveCoreDescription = useActionDescriptionResolver()

  const appDescription = resolveAppActionDescription(action.description, t)
  const displayDescription =
    translatedDescription || appDescription || resolveCoreDescription(action.description, action.payload)

  if (action.status !== 'executed') {
    return (
      <ActionCard
        action={action}
        discrepancies={discrepancies}
        actionTypeLabels={actionTypeLabels}
        onAccept={onAccept}
        onReject={onReject}
        onRetry={onRetry}
        onEdit={onEdit}
        translatedDescription={translatedDescription || appDescription || undefined}
        resolveDiscrepancyDescription={resolveDiscrepancyDescription}
      />
    )
  }

  const label = resolveActionTypeLabel(action.actionType, actionTypeLabels)
  const createdHref = resolveCreatedRecordHref(action, { canOpenTarget: canOpenCreatedQuote })
  const executedAt = action.executedAt ? new Date(action.executedAt) : null

  return (
    <div className="border rounded-lg p-3 md:p-4 bg-status-success-bg border-status-success-border">
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle className="h-5 w-5 text-status-success-icon flex-shrink-0" aria-hidden />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-sm text-muted-foreground">{displayDescription}</p>
      {action.createdEntityId ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-status-success-text">
          {createdHref ? (
            <Link
              href={createdHref}
              className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('offer_automation.proposal.openCreatedQuote', 'Open the quote it created')}
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          ) : (
            <span>
              {t('inbox_ops.action.created_entity', 'Created {type}').replace('{type}', action.createdEntityType || '')}
            </span>
          )}
          {executedAt ? (
            // The server and the browser can sit in different time zones and
            // this string is locale-formatted, so the first render differs.
            <span suppressHydrationWarning>· {executedAt.toLocaleString()}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default ProposalActionCard
