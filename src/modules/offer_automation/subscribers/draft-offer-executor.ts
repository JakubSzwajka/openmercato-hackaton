import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
// Knowing exception, documented in `lib/freightExtraction.ts` and `cli.ts`: the
// installed inbox_ops and sales rows are READ so this handler knows what the
// extraction proposed and what the quote ended up as. Every WRITE goes through
// core's execution engine and, below it, core's command bus.
import {
  InboxProposal,
  InboxProposalAction,
} from '@open-mercato/core/modules/inbox_ops/data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { executeAction } from '@open-mercato/core/modules/inbox_ops/lib/executionEngine'
import { resolveOptionalEventBus } from '@open-mercato/core/modules/inbox_ops/lib/eventBus'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { DRAFT_OFFER_ACTION_TYPE } from '../inbox-actions'
import { EXTRACTED_BY_MARKER } from '../lib/freightExtraction'
import { resolveAutomationUserId, AUTOMATION_USER_EMAIL } from '../lib/automationUser'
import { ensureInboxActionRegistryResolvable } from '../lib/inboxActionRegistry'
import {
  notificationTypes,
  QUOTE_DRAFTED_NOTIFICATION_TYPE,
  QUOTE_DRAFT_FAILED_NOTIFICATION_TYPE,
} from '../notifications'

/**
 * Executes the extracted `draft_offer` and tells a human about the result.
 *
 * WHAT HAPPENED TO GATE 1
 * -----------------------
 * It moved. The old flow asked a person to accept the extracted action, and the
 * quote appeared after that click. The operator's decision is that the QUOTE is
 * now the review artefact: the action executes on its own and the salesperson
 * reviews a real draft document instead of a JSON payload. Nothing else about
 * the safety model changed — the quote is still `draft`, every price still
 * comes from the catalogue, and a line the catalogue cannot price still refuses
 * to become a quote at all.
 *
 * WHAT IT WILL NOT EXECUTE
 * ------------------------
 *  - a proposal this module's extraction did not write (`extractedBy` marker),
 *    so an extraction by core, or by anything added later, still waits for a
 *    human;
 *  - any action type but `draft_offer`;
 *  - an action that is not `pending`, which is also what makes a re-delivered
 *    event harmless: a `failed` action is retried by a person from the proposal
 *    card, deliberately, not by a queue redelivery that would fail identically
 *    and raise a second alarm.
 *
 * THE RBAC GATE IS NOT WEAKENED
 * -----------------------------
 * The execution runs as the automation user with `isSuperAdmin: false`, so
 * core's `ensureUserCanExecuteAction` still checks
 * `offer_automation.offers.draft` against that account's own ACL. No feature
 * is bypassed anywhere; the seeder grants the account exactly that one.
 */
export const metadata = {
  event: 'inbox_ops.proposal.created',
  persistent: true,
  id: 'offer_automation:draft-offer-executor',
}

/**
 * Who hears about a drafted quote: everyone allowed to read quotes.
 *
 * Deliberately NOT `offer_automation.offers.draft`. That feature says "may
 * draft an offer", which is what the machine now does; the notification is for
 * the people who review and send them.
 */
export const QUOTE_AUDIENCE_FEATURE = 'sales.quotes.view'

/**
 * Who hears about a refusal: the same desk, for a reason worth spelling out.
 *
 * The obvious choice is `offer_automation.offers.draft`, the feature the action
 * itself requires. It is the WRONG choice now, because that feature is held by
 * the machine account too, and a notification addressed to an account with no
 * login is a message nobody reads. The people who act on a refused draft are
 * the people waiting for the quote: they chase the missing price and they hit
 * Retry on the proposal card.
 */
export const DRAFT_FAILURE_AUDIENCE_FEATURE = QUOTE_AUDIENCE_FEATURE

type ProposalCreatedPayload = {
  proposalId: string
  emailId: string
  tenantId: string
  organizationId: string | null
  actionCount?: number
  discrepancyCount?: number
  confidence?: string
  summary?: string
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

const logger = createLogger('offer_automation').child({ component: 'draft-offer-executor' })

/** Grep marker: proves the automatic execution reached this subscriber. */
export const AUTO_EXECUTION_MARKER = 'OFFER_AUTOMATION_AUTO_EXECUTED'

export default async function handle(
  payload: ProposalCreatedPayload,
  ctx: ResolverContext,
): Promise<void> {
  const container = ctx as unknown as AwilixContainer
  const organizationId = payload.organizationId
  if (!organizationId) {
    logger.warn('Proposal event carried no organization; refusing to execute', {
      proposalId: payload.proposalId,
    })
    return
  }
  const scope = { tenantId: payload.tenantId, organizationId }
  const em = (container.resolve('em') as EntityManager).fork({ clear: true })

  const proposal = (await em.findOne(InboxProposal, {
    id: payload.proposalId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as never)) as { id: string; metadata?: Record<string, unknown> | null } | null
  if (!proposal) {
    logger.warn('Proposal not found', { proposalId: payload.proposalId })
    return
  }

  if ((proposal.metadata as { extractedBy?: string } | null)?.extractedBy !== EXTRACTED_BY_MARKER) {
    logger.info('Proposal was not produced by this module; leaving it for a human', {
      proposalId: payload.proposalId,
    })
    return
  }

  const actions = (await em.find(
    InboxProposalAction,
    {
      proposalId: payload.proposalId,
      actionType: DRAFT_OFFER_ACTION_TYPE,
      status: 'pending',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as never,
    { orderBy: { sortOrder: 'ASC' } } as never,
  )) as unknown as Array<{ id: string; proposalId: string; payload?: Record<string, unknown> | null }>

  if (actions.length === 0) {
    logger.info('No pending draft_offer action on this proposal', {
      proposalId: payload.proposalId,
    })
    return
  }

  const automationUserId = await resolveAutomationUserId(em, scope.tenantId)
  if (!automationUserId) {
    // Fail loud, change nothing. The proposal stays pending and a person can
    // still accept it by hand, which is the same place the flow was before.
    logger.error('No automation user in this tenant; the offer stays pending', {
      proposalId: payload.proposalId,
      tenantId: scope.tenantId,
      expectedEmail: AUTOMATION_USER_EMAIL,
      fix: 'yarn mercato offer_automation seed-demo',
    })
    return
  }

  try {
    await ensureInboxActionRegistryResolvable()
  } catch (err) {
    logger.warn('Could not install the CLI inbox-action registry shim', { err })
  }

  for (const action of actions) {
    await executeOne(container, em, action, {
      ...scope,
      userId: automationUserId,
      proposalId: payload.proposalId,
    })
  }
}

async function executeOne(
  container: AwilixContainer,
  em: EntityManager,
  action: { id: string; proposalId: string; payload?: Record<string, unknown> | null },
  ctx: { tenantId: string; organizationId: string; userId: string; proposalId: string },
): Promise<void> {
  const customerName = readCustomerName(action.payload)

  let result: {
    success?: boolean
    createdEntityId?: string | null
    error?: string
    statusCode?: number
  }
  try {
    result = await executeAction(action as never, {
      em,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      container,
      eventBus: resolveOptionalEventBus(container),
      // Never a super-admin. The automation gets exactly the reach its own ACL
      // gives it, which is one feature.
      auth: {
        sub: ctx.userId,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        orgId: ctx.organizationId,
        isSuperAdmin: false,
      },
    } as never)
  } catch (err) {
    // The engine reports failures as a result rather than a throw, so landing
    // here means something below it broke. Reported to a human the same way a
    // refusal is, because from the sales desk's side the outcome is identical:
    // an email arrived and no quote came out.
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Execution threw', { actionId: action.id, err })
    await notifyFailure(container, ctx, { customerName, reason: message })
    return
  }

  if (!result.success) {
    logger.warn(`${AUTO_EXECUTION_MARKER} refused`, {
      actionId: action.id,
      proposalId: ctx.proposalId,
      statusCode: result.statusCode,
      error: result.error,
      executedByUserId: ctx.userId,
    })
    await notifyFailure(container, ctx, {
      customerName,
      reason: result.error ?? 'unknown error',
    })
    return
  }

  const quoteId = result.createdEntityId ?? null
  const quote = quoteId
    ? ((await em.fork({ clear: true }).findOne(SalesQuote, { id: quoteId } as never)) as {
        quoteNumber?: string
        currencyCode?: string
        grandTotalNetAmount?: string
      } | null)
    : null

  logger.info(AUTO_EXECUTION_MARKER, {
    actionId: action.id,
    proposalId: ctx.proposalId,
    quoteId,
    quoteNumber: quote?.quoteNumber ?? null,
    executedByUserId: ctx.userId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })

  if (!quoteId) return

  await notifySuccess(container, ctx, {
    quoteId,
    quoteNumber: quote?.quoteNumber ?? quoteId,
    customerName,
    currencyCode: quote?.currencyCode ?? '',
    totalNet: quote?.grandTotalNetAmount ?? '',
    lineCount: readLineCount(action.payload),
  })
}

function readCustomerName(payload: Record<string, unknown> | null | undefined): string {
  const value = payload?.customerName
  return typeof value === 'string' && value.trim() ? value.trim() : 'an unnamed customer'
}

function readLineCount(payload: Record<string, unknown> | null | undefined): number {
  const value = payload?.lineItems
  return Array.isArray(value) ? value.length : 0
}

/**
 * Notifications never break the flow.
 *
 * The quote already exists when this runs, and a bell that failed to ring is
 * not a reason to throw inside a queue job that would then retry the execution.
 * Core's own `proposalNotifier` re-throws; this one does not, because there the
 * notification IS the job and here it is the last step of one.
 */
async function notifySuccess(
  container: AwilixContainer,
  ctx: { tenantId: string; organizationId: string },
  input: {
    quoteId: string
    quoteNumber: string
    customerName: string
    currencyCode: string
    totalNet: string
    lineCount: number
  },
): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === QUOTE_DRAFTED_NOTIFICATION_TYPE)
  if (!typeDef) return
  try {
    const service = resolveNotificationService(container)
    await service.createForFeature(
      buildFeatureNotificationFromType(typeDef, {
        requiredFeature: QUOTE_AUDIENCE_FEATURE,
        bodyVariables: {
          quoteNumber: input.quoteNumber,
          customerName: input.customerName,
          lineCount: String(input.lineCount),
          totalNet: input.totalNet,
          currencyCode: input.currencyCode,
        },
        sourceEntityType: 'sales:quote',
        sourceEntityId: input.quoteId,
        linkHref: `/backend/sales/quotes/${input.quoteId}`,
        // One notification per quote, so a redelivery that somehow got past the
        // status guard still groups onto the same thing rather than reading as
        // a second quote.
        groupKey: `offer_automation:quote:${input.quoteId}`,
      }),
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
  } catch (err) {
    logger.error('Quote was drafted but the notification failed', { err, quoteId: input.quoteId })
  }
}

async function notifyFailure(
  container: AwilixContainer,
  ctx: { tenantId: string; organizationId: string; proposalId: string },
  input: { customerName: string; reason: string },
): Promise<void> {
  const typeDef = notificationTypes.find(
    (type) => type.type === QUOTE_DRAFT_FAILED_NOTIFICATION_TYPE,
  )
  if (!typeDef) return
  try {
    const service = resolveNotificationService(container)
    await service.createForFeature(
      buildFeatureNotificationFromType(typeDef, {
        requiredFeature: DRAFT_FAILURE_AUDIENCE_FEATURE,
        bodyVariables: {
          customerName: input.customerName,
          // The engine's message names every line it could not price and what
          // to change; it is the whole value of this notification, so it is
          // carried verbatim rather than summarised.
          reason: input.reason,
        },
        sourceEntityType: 'inbox_ops:proposal',
        sourceEntityId: ctx.proposalId,
        linkHref: `/backend/inbox-ops/proposals/${ctx.proposalId}`,
        groupKey: `offer_automation:proposal:${ctx.proposalId}`,
      }),
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
  } catch (err) {
    logger.error('Could not tell anybody the draft failed', { err, proposalId: ctx.proposalId })
  }
}
