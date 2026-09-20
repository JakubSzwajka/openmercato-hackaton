"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  CheckCheck,
  Loader2,
  ExternalLink,
  RefreshCw,
  Users,
  Languages,
  Pencil,
} from 'lucide-react'
import type { ProposalTranslationEntry } from '@open-mercato/core/modules/inbox_ops/data/entities'
import type {
  ProposalDetail,
  ActionDetail,
  DiscrepancyDetail,
  EmailDetail,
} from '@open-mercato/core/modules/inbox_ops/components/proposals/types'
import {
  ConfidenceBadge,
  useActionTypeLabels,
  useDiscrepancyDescriptions,
} from '@open-mercato/core/modules/inbox_ops/components/proposals/ActionCard'
import {
  CategoryBadge,
  CATEGORY_CONFIG,
  ALL_CATEGORIES,
  useCategoryLabels,
} from '@open-mercato/core/modules/inbox_ops/components/proposals/CategoryBadge'
import { hasContactNameIssue } from '@open-mercato/core/modules/inbox_ops/lib/contactValidation'
import { EditActionDialog } from '@open-mercato/core/modules/inbox_ops/components/proposals/EditActionDialog'
import {
  readQuoteIdFromAction,
  summarizeQuoteLines,
  DRAFT_OFFER_ACTION_TYPE,
  SALES_QUOTE_VIEW_FEATURE,
} from '../../lib/proposalPresentation'
import { ProposalActionCard } from './ProposalActionCard'
import { QuoteResultCard } from './QuoteResultCard'

function EmailThreadViewer({ email }: { email: EmailDetail | null }) {
  const t = useT()
  if (!email) return null

  const messages = email.threadMessages || []

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm">{t('inbox_ops.email_thread', 'Email Thread')}</h3>
      {messages.length > 0 ? (
        messages.map((msg, index) => (
          <div key={index} className="border rounded-lg p-3 md:p-4 bg-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {msg.from?.name || msg.from?.email || t('inbox_ops.sender_unknown', 'Unknown')}
                </div>
                <div className="text-xs text-muted-foreground truncate">{msg.from?.email}</div>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap" suppressHydrationWarning>
                {msg.date ? new Date(msg.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
            <div className="text-sm whitespace-pre-wrap text-foreground/80">{msg.body}</div>
          </div>
        ))
      ) : email.cleanedText ? (
        <div className="border rounded-lg p-3 md:p-4 bg-card">
          <div className="text-sm whitespace-pre-wrap text-foreground/80">{email.cleanedText}</div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('inbox_ops.no_email_content', 'No email content available')}</p>
      )}
    </div>
  )
}

function CategoryEditDropdown({
  currentCategory,
  onSelect,
  disabled,
}: {
  currentCategory: string | null | undefined
  onSelect: (category: string) => void
  disabled: boolean
}) {
  const t = useT()
  const labels = useCategoryLabels()
  const [isOpen, setIsOpen] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <div className="flex items-center gap-1">
        <CategoryBadge category={currentCategory} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          title={t('inbox_ops.recategorize', 'Change Category')}
          aria-label={t('inbox_ops.recategorize', 'Change Category')}
          aria-expanded={isOpen}
        >
          <Pencil className="h-3 w-3" aria-hidden />
        </Button>
      </div>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-dropdown w-48 rounded-md border bg-popover shadow-md">
          <div className="p-1">
            {ALL_CATEGORIES.map((cat) => {
              const config = CATEGORY_CONFIG[cat]
              const { Icon } = config
              return (
                <Button
                  key={cat}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`flex items-center gap-2 w-full justify-start rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground ${currentCategory === cat ? 'bg-accent' : ''}`}
                  onClick={() => { onSelect(cat); setIsOpen(false) }}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {labels[cat] || cat}
                </Button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * App-owned replacement for `/backend/inbox-ops/proposals/[id]`.
 *
 * Registered through `overrides.routes.pages` in `src/modules.ts`, which swaps
 * the loader on core's own route manifest entry and leaves its metadata, URL,
 * ACL features and breadcrumb exactly as they were. Forked from
 * `node_modules/@open-mercato/core/src/modules/inbox_ops/backend/inbox-ops/
 * proposals/[id]/page.tsx`.
 *
 * Three differences from the installed page, and nothing else:
 *
 * 1. An executed action links to the record it created (`ProposalActionCard`).
 * 2. A proposal that produced a quote gets a Result card (`QuoteResultCard`).
 * 3. The category badge and the confidence move up beside the title, and the
 *    thread column fills the viewport and scrolls inside itself instead of
 *    leaving the lower half of the page blank.
 *
 * A fork rather than an extension because `inbox_ops` publishes no UI injection
 * spot and no component handle on this page — see
 * `.ai/guides/modules/inbox_ops/umes-hosts.md`, which lists entities, events
 * and query lifecycle only.
 */
export default function ProposalDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const proposalId = params?.id

  const [proposal, setProposal] = React.useState<ProposalDetail | null>(null)
  const [actions, setActions] = React.useState<ActionDetail[]>([])
  const [discrepancies, setDiscrepancies] = React.useState<DiscrepancyDetail[]>([])
  const [email, setEmail] = React.useState<EmailDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'inbox-ops-proposal-detail',
  })
  const coreActionTypeLabels = useActionTypeLabels()
  // Core's map covers its own nine action types, so an app-owned type would
  // reach the screen as the raw `draft_offer`. Merged rather than replaced: an
  // action type this app does not know still falls back to core's label, and
  // then to the raw string.
  const actionTypeLabels = React.useMemo(
    () => ({
      ...coreActionTypeLabels,
      [DRAFT_OFFER_ACTION_TYPE]: t('offer_automation.actionType.draft_offer', 'Draft freight offer'),
    }),
    [coreActionTypeLabels, t],
  )
  const resolveDiscrepancyDescription = useDiscrepancyDescriptions()
  const [editingAction, setEditingAction] = React.useState<ActionDetail | null>(null)
  const [sendingReplyId, setSendingReplyId] = React.useState<string | null>(null)

  // A link into a sales quote is only shown to someone who can open it. Read
  // through `hasFeature` so a wildcard grant counts, exactly as the backend
  // route check does.
  const { payload: chromePayload } = useBackendChrome()
  const canOpenCreatedQuote = hasFeature(chromePayload?.grantedFeatures, SALES_QUOTE_VIEW_FEATURE)

  const [translation, setTranslation] = React.useState<ProposalTranslationEntry | null>(null)
  const [isTranslating, setIsTranslating] = React.useState(false)
  const [showTranslation, setShowTranslation] = React.useState(false)

  const handleEditAction = React.useCallback((action: ActionDetail) => {
    if (action.actionType === 'create_order' || action.actionType === 'create_quote') {
      const kind = action.actionType === 'create_order' ? 'order' : 'quote'
      try {
        sessionStorage.setItem(
          'inbox_ops.orderDraft',
          JSON.stringify({
            actionId: action.id,
            proposalId: action.proposalId,
            payload: action.payload,
          }),
        )
      } catch { /* sessionStorage unavailable */ }
      router.push(`/backend/sales/documents/create?kind=${kind}&fromInboxAction=${encodeURIComponent(action.id)}`)
      return
    }
    if (action.actionType === 'create_product') {
      try {
        sessionStorage.setItem(
          'inbox_ops.productDraft',
          JSON.stringify({
            actionId: action.id,
            proposalId: action.proposalId,
            payload: action.payload,
          }),
        )
      } catch { /* sessionStorage unavailable */ }
      router.push(`/backend/catalog/products/create?fromInboxAction=${encodeURIComponent(action.id)}`)
      return
    }
    setEditingAction(action)
  }, [router])

  const handleTranslate = React.useCallback(async () => {
    if (!proposalId) return
    setIsTranslating(true)
    const result = await runMutation({
      operation: () => apiCall<{ translation: ProposalTranslationEntry; cached: boolean }>(
        `/api/inbox_ops/proposals/${proposalId}/translate`,
        { method: 'POST', body: JSON.stringify({ targetLocale: locale }) },
      ),
      context: {},
    })
    if (result?.ok && result.result?.translation) {
      setTranslation(result.result.translation)
      setShowTranslation(true)
    } else {
      const detail = (result?.result as Record<string, unknown> | null)?.error
      flash(detail ? `${t('inbox_ops.translate.failed', 'Translation failed')}: ${detail}` : t('inbox_ops.translate.failed', 'Translation failed'), 'error')
    }
    setIsTranslating(false)
  }, [proposalId, locale, t, runMutation])

  const handleCategorize = React.useCallback(async (category: string) => {
    if (!proposalId) return
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; category: string; previousCategory: string | null }>(
        `/api/inbox_ops/proposals/${proposalId}/categorize`,
        { method: 'POST', body: JSON.stringify({ category }) },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      setProposal((prev) => prev ? { ...prev, category: result.result!.category } : prev)
    } else {
      flash(t('inbox_ops.flash.save_failed', 'Failed to save'), 'error')
    }
  }, [proposalId, t, runMutation])

  const loadData = React.useCallback(async () => {
    if (!proposalId) return
    setIsLoading(true)
    setError(null)
    setIsNotFound(false)
    try {
      const result = await apiCall<{
        proposal: ProposalDetail
        actions: ActionDetail[]
        discrepancies: DiscrepancyDetail[]
        email: EmailDetail
      }>(`/api/inbox_ops/proposals/${proposalId}`)
      if (result?.ok && result.result) {
        setProposal(result.result.proposal)
        setActions(result.result.actions || [])
        setDiscrepancies(result.result.discrepancies || [])
        setEmail(result.result.email)
      } else if (result?.status === 404) {
        setIsNotFound(true)
      } else {
        setError(t('inbox_ops.flash.load_failed', 'Failed to load proposal'))
      }
    } catch {
      setError(t('inbox_ops.flash.load_failed', 'Failed to load proposal'))
    }
    setIsLoading(false)
  }, [proposalId, t])

  React.useEffect(() => { loadData() }, [loadData])

  const handleAcceptAction = React.useCallback(async (actionId: string) => {
    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; error?: string }>(
        `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}/accept`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.action_executed', 'Action executed'), 'success')
      await loadData()
    } else {
      flash(result?.result?.error || t('inbox_ops.flash.action_execute_failed', 'Failed to execute action'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, loadData, t, runMutation])

  const handleRejectAction = React.useCallback(async (actionId: string) => {
    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean }>(
        `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}/reject`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.action_rejected', 'Action rejected'), 'success')
      await loadData()
    } else {
      flash(t('inbox_ops.flash.action_reject_failed', 'Failed to reject action'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, loadData, t, runMutation])

  const handleAcceptAll = React.useCallback(async () => {
    const pendingActions = actions.filter((a) => a.status === 'pending')
    const pendingCount = pendingActions.length
    const nameIssueCount = pendingActions.filter((a) => hasContactNameIssue(a)).length

    const confirmText = nameIssueCount > 0
      ? t('inbox_ops.action.accept_all_confirm_with_skip', 'Execute {count} pending actions? {skipCount} contact actions will be skipped due to missing names.')
        .replace('{count}', String(pendingCount))
        .replace('{skipCount}', String(nameIssueCount))
      : t('inbox_ops.action.accept_all_confirm', 'Execute {count} pending actions?').replace('{count}', String(pendingCount))

    const confirmed = await confirm({
      title: t('inbox_ops.action.accept_all', 'Accept All'),
      text: confirmText,
    })
    if (!confirmed) return

    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; succeeded: number; failed: number }>(
        `/api/inbox_ops/proposals/${proposalId}/accept-all`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      const msg = result.result.failed > 0
        ? t('inbox_ops.flash.accept_all_partial', '{succeeded} actions executed, {failed} failed')
          .replace('{succeeded}', String(result.result.succeeded))
          .replace('{failed}', String(result.result.failed))
        : t('inbox_ops.flash.accept_all_success', '{succeeded} actions executed')
          .replace('{succeeded}', String(result.result.succeeded))
      flash(msg, 'success')
      await loadData()
    } else {
      flash(t('inbox_ops.flash.accept_all_failed', 'Failed to accept all actions'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, actions, confirm, t, loadData, runMutation])

  const handleRejectAll = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('inbox_ops.action.reject_all', 'Reject Proposal'),
      text: t('inbox_ops.action.reject_all_confirm', 'Reject all pending actions in this proposal?'),
    })
    if (!confirmed) return

    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean }>(
        `/api/inbox_ops/proposals/${proposalId}/reject`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.action.proposal_rejected', 'Proposal rejected'), 'success')
      await loadData()
    }
    setIsProcessing(false)
  }, [proposalId, confirm, t, loadData, runMutation])

  const handleRetryExtraction = React.useCallback(async () => {
    if (!email) return
    setIsProcessing(true)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean }>(
        `/api/inbox_ops/emails/${email.id}/reprocess`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.reprocessing_started', 'Reprocessing started'), 'success')
      await loadData()
    }
    setIsProcessing(false)
  }, [email, loadData, t, runMutation])

  const handleSendReply = React.useCallback(async (actionId: string) => {
    setSendingReplyId(actionId)
    const result = await runMutation({
      operation: () => apiCall<{ ok: boolean; error?: string }>(
        `/api/inbox_ops/proposals/${proposalId}/replies/${actionId}/send`,
        { method: 'POST' },
      ),
      context: {},
    })
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.reply.sent_success', 'Reply sent successfully'), 'success')
      await loadData()
    } else {
      flash(result?.result?.error || t('inbox_ops.flash.send_reply_failed', 'Failed to send reply'), 'error')
    }
    setSendingReplyId(null)
  }, [proposalId, t, loadData, runMutation])

  // The executed action that produced a quote, if any. First one wins: a
  // proposal drafts one offer, and showing two Result cards for a re-run would
  // be worse than showing the one that is current.
  const quoteResult = React.useMemo(() => {
    for (const action of actions) {
      if (action.status !== 'executed') continue
      const quoteId = readQuoteIdFromAction(action)
      if (!quoteId) continue
      return { quoteId, lines: summarizeQuoteLines(action.payload) }
    }
    return null
  }, [actions])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('inbox_ops.loading_proposal', 'Loading proposal...')} />
        </PageBody>
      </Page>
    )
  }
  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('inbox_ops.proposal.notFound', 'Proposal not found.')}
            backHref="/backend/inbox-ops"
            backLabel={t('inbox_ops.proposal.backToList', 'Back to inbox')}
          />
        </PageBody>
      </Page>
    )
  }
  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  const pendingActions = actions.filter((a) => a.status === 'pending')
  const emailIsProcessing = email?.status === 'processing'
  const emailFailed = email?.status === 'failed'

  return (
    <Page>
      {ConfirmDialogElement}
      {editingAction && (
        <EditActionDialog
          action={editingAction}
          actionTypeLabels={actionTypeLabels}
          onClose={() => setEditingAction(null)}
          onSaved={loadData}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-6 md:py-4 border-b bg-background">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <Link href="/backend/inbox-ops">
            <Button type="button" variant="ghost" size="sm" aria-label={t('inbox_ops.proposal.backToList', 'Back to inbox')}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-base md:text-lg font-semibold truncate">{email?.subject || t('inbox_ops.proposal', 'Proposal')}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-xs text-muted-foreground truncate" suppressHydrationWarning>
                {email?.forwardedByName || email?.forwardedByAddress} · {email?.receivedAt && new Date(email.receivedAt).toLocaleString()}
              </p>
              {/* Category and confidence sit beside the title rather than
                  halfway down the Summary card: they are how a reviewer decides
                  whether to read the thread at all. */}
              {proposal && (
                <div className="flex items-center gap-2">
                  <span className="sr-only">{t('inbox_ops.category', 'Category')}</span>
                  <CategoryEditDropdown
                    currentCategory={proposal.category}
                    onSelect={handleCategorize}
                    disabled={isProcessing}
                  />
                  <span className="sr-only">{t('inbox_ops.confidence', 'Confidence')}</span>
                  <ConfidenceBadge value={proposal.confidence} />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pendingActions.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={handleRejectAll}
              disabled={isProcessing}
            >
              <XCircle className="h-4 w-4 mr-1" aria-hidden />
              <span className="hidden md:inline">{t('inbox_ops.action.reject_all', 'Reject Proposal')}</span>
            </Button>
          )}
          {pendingActions.length > 1 && (
            <Button type="button" size="sm" className="h-11 md:h-9" onClick={handleAcceptAll} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden /> : <CheckCheck className="h-4 w-4 mr-1" aria-hidden />}
              <span className="hidden md:inline">{t('inbox_ops.action.accept_all', 'Accept All')}</span>
            </Button>
          )}
        </div>
      </div>

      <PageBody>
        {/* One column below `md`, thread first. Above it the thread takes the
            wider share, pins to the viewport and scrolls inside itself, so the
            page no longer ends halfway down with an empty left half. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-start md:gap-6">
          <div className="md:col-span-3 md:sticky md:top-0 md:h-svh md:overflow-y-auto md:pr-2">
            <EmailThreadViewer email={email} />
          </div>

          <div className="space-y-4 md:col-span-2">
            {emailIsProcessing ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" aria-hidden />
                <p className="text-sm text-muted-foreground">{t('inbox_ops.extraction_loading', 'AI is analyzing this thread...')}</p>
              </div>
            ) : emailFailed ? (
              <div className="border rounded-lg p-4 bg-status-error-bg border-status-error-border">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-status-error-icon" aria-hidden />
                  <span className="text-sm font-medium text-status-error-text">{t('inbox_ops.extraction_failed', 'Extraction failed')}</span>
                </div>
                {email?.processingError && (
                  <p className="text-xs text-status-error-text mb-3">{email.processingError}</p>
                )}
                <Button type="button" size="sm" variant="outline" className="h-11 md:h-9" onClick={handleRetryExtraction} disabled={isProcessing}>
                  <RefreshCw className="h-4 w-4 mr-1" aria-hidden />
                  {t('inbox_ops.action.retry', 'Retry')}
                </Button>
              </div>
            ) : proposal ? (
              <>
                {/* Summary */}
                <div className="border rounded-lg p-3 md:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm">{t('inbox_ops.summary', 'Summary')}</h3>
                    {(proposal.workingLanguage || 'en') !== locale && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={showTranslation ? () => setShowTranslation(false) : handleTranslate}
                        disabled={isTranslating}
                      >
                        {isTranslating ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />
                        ) : (
                          <Languages className="h-3 w-3 mr-1" aria-hidden />
                        )}
                        {showTranslation
                          ? t('inbox_ops.translate.show_original', 'Show original')
                          : t('inbox_ops.translate.translate', 'Translate')}
                      </Button>
                    )}
                  </div>
                  <p className="text-sm text-foreground/80 mb-3">
                    {showTranslation && translation ? translation.summary : proposal.summary}
                  </p>

                  {proposal.possiblyIncomplete && (
                    <div className="flex items-center gap-2 text-xs text-status-warning-text bg-status-warning-bg rounded px-2 py-1 mb-3">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {t('inbox_ops.possibly_incomplete', 'This thread appears to be a partial forward')}
                    </div>
                  )}

                  {/* Participants */}
                  {proposal.participants.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">{t('inbox_ops.participants', 'Participants')}</h4>
                      <div className="space-y-1">
                        {proposal.participants.map((p, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <Users className="h-3 w-3 text-muted-foreground" aria-hidden />
                            <span>{p.name}</span>
                            <span className="text-xs text-muted-foreground">({p.role})</span>
                            {p.matchedContactId && <CheckCircle className="h-3 w-3 text-status-success-icon" aria-hidden />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Result: what this proposal produced, between Summary and Actions. */}
                {quoteResult && (
                  <QuoteResultCard quoteId={quoteResult.quoteId} lines={quoteResult.lines} />
                )}

                {/* Discrepancies not tied to a specific action */}
                {(() => {
                  const actionIds = new Set(actions.map((a) => a.id))
                  const general = discrepancies.filter((d) => !d.resolved && (!d.actionId || !actionIds.has(d.actionId)))
                  if (general.length === 0) return null
                  return (
                    <div className="border rounded-lg p-3 md:p-4 bg-status-warning-bg border-status-warning-border">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-status-warning-icon" aria-hidden />
                        <h3 className="font-semibold text-sm text-status-warning-text">{t('inbox_ops.discrepancies', 'Issues Detected')}</h3>
                      </div>
                      <div className="space-y-1.5">
                        {general.map((d) => (
                          <div key={d.id} className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
                            d.severity === 'error' ? 'bg-status-error-bg text-status-error-text' : 'bg-status-warning-bg text-status-warning-text'
                          }`}>
                            <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" aria-hidden />
                            <div>
                              <span>{resolveDiscrepancyDescription(d.description, d.foundValue)}</span>
                              {(d.expectedValue || d.foundValue) && (
                                <div className="mt-0.5 text-overline opacity-80">
                                  {d.expectedValue && <span>{t('inbox_ops.discrepancy.expected', 'Expected')}: {d.expectedValue}</span>}
                                  {d.expectedValue && d.foundValue && <span> · </span>}
                                  {d.foundValue && <span>{t('inbox_ops.discrepancy.found', 'Found')}: {d.foundValue}</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* Actions */}
                <div>
                  <h3 className="font-semibold text-sm mb-2">{t('inbox_ops.actions', 'Proposed Actions')}</h3>
                  {actions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('inbox_ops.no_actions', 'No actionable items detected in this thread')}</p>
                  ) : (
                    <div className="space-y-3">
                      {actions.map((action) => (
                        <div key={action.id}>
                          <ProposalActionCard
                            action={action}
                            discrepancies={discrepancies}
                            actionTypeLabels={actionTypeLabels}
                            canOpenCreatedQuote={canOpenCreatedQuote}
                            onAccept={handleAcceptAction}
                            onReject={handleRejectAction}
                            onRetry={handleAcceptAction}
                            onEdit={handleEditAction}
                            translatedDescription={showTranslation ? translation?.actions[action.id] : undefined}
                            resolveDiscrepancyDescription={resolveDiscrepancyDescription}
                          />
                          {action.actionType === 'draft_reply' && (action.status === 'executed' || action.status === 'accepted') && (
                            <div className="mt-2 pl-7">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-11 md:h-9"
                                disabled={sendingReplyId === action.id}
                                onClick={() => handleSendReply(action.id)}
                              >
                                {sendingReplyId === action.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                                ) : (
                                  <ExternalLink className="h-4 w-4 mr-1" aria-hidden />
                                )}
                                {sendingReplyId === action.id
                                  ? t('inbox_ops.reply.sending', 'Sending...')
                                  : t('inbox_ops.reply.send', 'Send Reply')}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
