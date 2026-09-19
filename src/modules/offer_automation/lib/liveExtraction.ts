import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
// Knowing exception, dev demo path only, same standing as the reads in `cli.ts`:
// this drives the INSTALLED extraction worker and then reads the rows it wrote,
// so an operator can watch the real path without a mail server. It adds no
// extraction of our own and changes nothing about how core extracts.
import {
  InboxEmail,
  InboxProposal,
  InboxProposalAction,
} from '@open-mercato/core/modules/inbox_ops/data/entities'
import { emitInboxOpsEvent } from '@open-mercato/core/modules/inbox_ops/events'
import { POLL_INTERVAL_MS, sleep } from './poll'

/**
 * Runs core's own extraction over a seeded email, so a model does the matching.
 *
 * ROUTE A, NOT A SECOND IMPLEMENTATION
 * ------------------------------------
 * `inbox_ops` already has the worker that calls the model:
 * `node_modules/@open-mercato/core/src/modules/inbox_ops/subscribers/extractionWorker.ts`.
 * It builds the prompt from the generated inbox-action registry (so OUR
 * `draft_offer` schema is already in it) and from the tenant's catalogue. This
 * module only decides HOW that worker is reached, because a CLI has no HTTP
 * request and may have no queue worker beside it.
 *
 * Two ways in, both ending in the same core function:
 *
 *   core             imports the worker's handler and calls it with the CLI's
 *                    container. Deterministic: when this returns, extraction is
 *                    over, success or failure.
 *
 *   core-via-events  emits `inbox_ops.email.received` with `persistent: true`,
 *                    exactly as the inbound webhook does
 *                    (`inbox_ops/api/webhook/inbound.ts:393`), then waits for a
 *                    proposal to appear. This is the production path, and it
 *                    only completes when an events worker is draining the
 *                    queue. Under `yarn dev` one is: `mercato server dev`
 *                    auto-spawns `mercato queue worker --all --with-scheduler`
 *                    because AUTO_SPAWN_WORKERS is true in `.env`.
 *
 * NEITHER RUNS ON THIS INSTALL. Core's extraction schema is rejected by OpenAI
 * strict structured outputs for every email; see the header of
 * `freightExtraction.ts`, which is the third mode (`app`) and the one that
 * works today. These two stay because they are the real path and they are how
 * an operator sees, in one command, that the blockage is upstream.
 */

export type LiveExtractionMode = 'core' | 'core-via-events' | 'app'

export type ExtractedActionRow = {
  id: string
  actionType: string
  status: string
  confidence: string | null
  payload: Record<string, unknown> | null
}

export type LiveExtractionOutcome = {
  mode: LiveExtractionMode
  /** `processed`, `needs_review`, `failed`, or still `received` on a timeout. */
  emailStatus: string
  processingError: string | null
  proposalId: string | null
  proposalSummary: string | null
  proposalConfidence: string | null
  /** Model core actually used, e.g. `openai/gpt-5-mini`. Never a key. */
  llmModel: string | null
  llmTokensUsed: number | null
  actions: ExtractedActionRow[]
  waitedMs: number
  /** True when `via-events` gave up waiting. Nothing was lost: the job is durable. */
  timedOut: boolean
}

export type LiveExtractionScope = {
  tenantId: string
  organizationId: string
}


/**
 * Reads back what extraction produced for one email.
 *
 * Forks the EntityManager every time on purpose: with `via-events` the rows are
 * written by ANOTHER process, so a cached identity map would keep reporting the
 * email as `received` forever.
 */
async function readOutcome(
  container: AwilixContainer,
  emailId: string,
  scope: LiveExtractionScope,
): Promise<{
  emailStatus: string
  processingError: string | null
  proposal: {
    id: string
    summary: string | null
    confidence: string | null
    llmModel: string | null
    llmTokensUsed: number | null
  } | null
  actions: ExtractedActionRow[]
}> {
  const em = (container.resolve('em') as EntityManager).fork({ clear: true })

  const email = (await em.findOne(InboxEmail, {
    id: emailId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as never)) as { status?: string; processingError?: string | null } | null

  const proposalRow = (await em.findOne(
    InboxProposal,
    {
      inboxEmailId: emailId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
    } as never,
    { orderBy: { createdAt: 'DESC' } } as never,
  )) as {
    id: string
    summary?: string | null
    confidence?: string | null
    llmModel?: string | null
    llmTokensUsed?: number | null
  } | null

  const actions = proposalRow
    ? ((await em.find(
        InboxProposalAction,
        { proposalId: proposalRow.id } as never,
        { orderBy: { sortOrder: 'ASC' } } as never,
      )) as unknown as Array<{
        id: string
        actionType: string
        status: string
        confidence?: string | null
        payload?: Record<string, unknown> | null
      }>)
    : []

  return {
    emailStatus: email?.status ?? '<email missing>',
    processingError: email?.processingError ?? null,
    proposal: proposalRow
      ? {
          id: proposalRow.id,
          summary: proposalRow.summary ?? null,
          confidence: proposalRow.confidence ?? null,
          llmModel: proposalRow.llmModel ?? null,
          llmTokensUsed: proposalRow.llmTokensUsed ?? null,
        }
      : null,
    actions: actions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      confidence: action.confidence ?? null,
      payload: action.payload ?? null,
    })),
  }
}

function toOutcome(
  mode: LiveExtractionMode,
  read: Awaited<ReturnType<typeof readOutcome>>,
  waitedMs: number,
  timedOut: boolean,
): LiveExtractionOutcome {
  return {
    mode,
    emailStatus: read.emailStatus,
    processingError: read.processingError,
    proposalId: read.proposal?.id ?? null,
    proposalSummary: read.proposal?.summary ?? null,
    proposalConfidence: read.proposal?.confidence ?? null,
    llmModel: read.proposal?.llmModel ?? null,
    llmTokensUsed: read.proposal?.llmTokensUsed ?? null,
    actions: read.actions,
    waitedMs,
    timedOut,
  }
}

/**
 * Calls the installed extraction worker's handler directly.
 *
 * The import is dynamic so the CLI still loads in an app whose `inbox_ops` is
 * disabled; the failure then lands here, with a readable message, instead of at
 * module load for every unrelated command.
 */
async function runInProcess(
  container: AwilixContainer,
  input: { emailId: string; scope: LiveExtractionScope; forwardedByAddress: string; subject: string },
): Promise<void> {
  const mod = (await import(
    '@open-mercato/core/modules/inbox_ops/subscribers/extractionWorker'
  )) as {
    default: (
      payload: {
        emailId: string
        tenantId: string
        organizationId: string
        forwardedByAddress: string
        subject: string
      },
      ctx: { resolve: <T = unknown>(name: string) => T },
    ) => Promise<void>
  }

  await mod.default(
    {
      emailId: input.emailId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      forwardedByAddress: input.forwardedByAddress,
      subject: input.subject,
    },
    container as unknown as { resolve: <T = unknown>(name: string) => T },
  )
}

/**
 * Emits the event the inbound webhook emits, byte for byte in shape.
 *
 * `persistent: true` means the bus enqueues it and, under the default
 * single-delivery mode, does NOT run the subscriber inline. Whoever drains the
 * queue runs the extraction. If nothing drains it the job waits; it is not
 * lost, which is why the timeout below reports rather than fails.
 */
async function runViaEvents(
  input: { emailId: string; scope: LiveExtractionScope; forwardedByAddress: string; subject: string },
): Promise<void> {
  await emitInboxOpsEvent(
    'inbox_ops.email.received',
    {
      emailId: input.emailId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      forwardedByAddress: input.forwardedByAddress,
      subject: input.subject,
    },
    {
      persistent: true,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    },
  )
}

/**
 * Drives one seeded email through core's extraction and reports what came back.
 *
 * Never throws on a model failure: a failed extraction is a result an operator
 * needs to see (core writes the reason onto `inbox_emails.processing_error`),
 * not an exception that hides it. It throws only when the worker itself cannot
 * be reached at all.
 */
export async function runLiveExtraction(
  container: AwilixContainer,
  input: {
    emailId: string
    scope: LiveExtractionScope
    forwardedByAddress: string
    subject: string
    mode: LiveExtractionMode
    timeoutMs: number
  },
): Promise<LiveExtractionOutcome> {
  const startedAt = Date.now()

  if (input.mode === 'app') {
    // Imported here rather than at module load so the two core modes never pay
    // for the AI SDK, and so a broken shim cannot break the real path.
    const { runFreightExtraction } = await import('./freightExtraction')
    return runFreightExtraction(container, {
      emailId: input.emailId,
      scope: input.scope,
      // This path belongs to `demo`, which keeps a human at Gate 1. Announcing
      // the proposal here would deliver `inbox_ops.proposal.created` inline in
      // the demo command's own process, and the executor subscriber would draft
      // the quote before (or while) `--auto-accept` does. See the option's
      // comment in `freightExtraction.ts`.
      announceProposal: false,
    })
  }

  if (input.mode === 'core') {
    await runInProcess(container, input)
    const read = await readOutcome(container, input.emailId, input.scope)
    return toOutcome('core', read, Date.now() - startedAt, false)
  }

  await runViaEvents(input)

  while (Date.now() - startedAt < input.timeoutMs) {
    await sleep(POLL_INTERVAL_MS)
    const read = await readOutcome(container, input.emailId, input.scope)
    const settled = read.emailStatus !== 'received' && read.emailStatus !== 'processing'
    if (settled || read.proposal) {
      return toOutcome('core-via-events', read, Date.now() - startedAt, false)
    }
  }

  const read = await readOutcome(container, input.emailId, input.scope)
  return toOutcome('core-via-events', read, Date.now() - startedAt, true)
}
