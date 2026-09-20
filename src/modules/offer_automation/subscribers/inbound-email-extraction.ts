import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
// Knowing exception, documented in `lib/freightExtraction.ts`: the installed
// `InboxEmail` row is READ here to find out who won the claim. No entity of
// ours is involved and nothing is written outside core's own extraction path.
import { InboxEmail } from '@open-mercato/core/modules/inbox_ops/data/entities'
import { EXTRACTION_FAILURE_PREFIX, runFreightExtraction } from '../lib/freightExtraction'
import { POLL_INTERVAL_MS, sleep } from '../lib/poll'

/**
 * Turns an inbound email into a proposal, without anybody asking it to.
 *
 * WHY THIS SUBSCRIBER EXISTS NEXT TO CORE'S
 * -----------------------------------------
 * `inbox_ops` already subscribes to this event with its own extraction worker
 * (`inbox_ops:extraction-worker`), and on this install that worker fails for
 * EVERY email: OpenAI strict structured outputs rejects core's extraction
 * schema. The reason, the measurements and the deletion condition are in the
 * header of `lib/freightExtraction.ts`.
 *
 * The event bus runs every persistent subscriber for one event CONCURRENTLY
 * (`@open-mercato/events/src/bus.ts` `dispatchQueued` uses `Promise.allSettled`),
 * so this handler and core's start at the same instant and both try the same
 * optimistic claim on `inbox_emails.status`. Exactly one wins. Both outcomes
 * are handled and both end the same way:
 *
 *   we win    core's worker finds 0 rows claimed and returns; we extract.
 *   core wins we wait for its verdict. It fails (today, always), and we then
 *             claim the email from `failed` and extract. If it ever SUCCEEDS,
 *             we do nothing: its proposal already carries our `draft_offer`
 *             schema, because the generated inbox-action registry is in its
 *             prompt.
 *
 * So this is a fallback, not a replacement, and the day core's schema is fixed
 * this file quietly stops doing any work.
 *
 * IDEMPOTENCY
 * -----------
 * Three guards, all of them atomic or read-only:
 *  1. the claim is a single `UPDATE ... WHERE status = ?`, so two runners can
 *     never both extract;
 *  2. a re-delivered job finds the email in `processed` / `needs_review` and
 *     returns without calling the model;
 *  3. our own refusal is marked on `processing_error` with
 *     `EXTRACTION_FAILURE_PREFIX`, so a re-delivery cannot take the email over
 *     a second time and spend another model call on an email we already judged.
 */
export const metadata = {
  event: 'inbox_ops.email.received',
  persistent: true,
  id: 'offer_automation:freight-extraction',
}

type EmailReceivedPayload = {
  emailId: string
  tenantId: string
  organizationId: string
  forwardedByAddress?: string
  subject?: string
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

const logger = createLogger('offer_automation').child({ component: 'inbound-email-extraction' })

/** How long to wait for the other runner's verdict before giving up. */
const TAKEOVER_TIMEOUT_MS = 120_000

/** Statuses that mean nobody is working on the email any more. */
const SETTLED_STATUSES = new Set(['processed', 'needs_review', 'failed'])

export type TakeoverDecision =
  | { action: 'extract' }
  | { action: 'skip'; reason: string }
  | { action: 'wait' }

/**
 * What to do with an email this handler did not manage to claim.
 *
 * Pure, and unit-tested, because it is the piece that decides whether a second
 * model call happens. Getting it wrong is either a missing quote or an endless
 * retry loop that bills for every attempt.
 */
export function decideTakeover(email: {
  status: string
  processingError?: string | null
}): TakeoverDecision {
  if (!SETTLED_STATUSES.has(email.status)) return { action: 'wait' }
  if (email.status !== 'failed') {
    return { action: 'skip', reason: `another extraction finished it (status ${email.status})` }
  }
  if ((email.processingError ?? '').startsWith(EXTRACTION_FAILURE_PREFIX)) {
    return { action: 'skip', reason: 'this module already extracted it and refused' }
  }
  return { action: 'extract' }
}

export default async function handle(
  payload: EmailReceivedPayload,
  ctx: ResolverContext,
): Promise<void> {
  // The subscriber context exposes `resolve`, which is every dependency
  // `runFreightExtraction` reads. Same cast `lib/liveExtraction.ts` makes in
  // the other direction, for the same reason.
  const container = ctx as unknown as AwilixContainer
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }

  const claimed = await tryExtract(container, payload.emailId, scope, ['received'])
  if (claimed) return

  const startedAt = Date.now()
  while (Date.now() - startedAt < TAKEOVER_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS)

    // Forked and cleared every time: the row is written by another runner (and
    // usually another process), so a cached identity map would report the
    // email as `processing` forever.
    const em = (container.resolve('em') as EntityManager).fork({ clear: true })
    const email = (await em.findOne(InboxEmail, {
      id: payload.emailId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as never)) as { status?: string; processingError?: string | null } | null

    if (!email) {
      logger.warn('Email disappeared while waiting for the other extractor', {
        emailId: payload.emailId,
      })
      return
    }

    const decision = decideTakeover({
      status: email.status ?? 'received',
      processingError: email.processingError,
    })
    if (decision.action === 'wait') continue
    if (decision.action === 'skip') {
      logger.info('Leaving this email alone', { emailId: payload.emailId, reason: decision.reason })
      return
    }

    logger.info("Taking the email over after another extraction failed", {
      emailId: payload.emailId,
      otherError: email.processingError,
    })
    await tryExtract(container, payload.emailId, scope, ['failed'])
    return
  }

  logger.warn('Gave up waiting for the other extraction to finish', {
    emailId: payload.emailId,
    waitedMs: Date.now() - startedAt,
  })
}

/**
 * Runs the extraction if the claim succeeds.
 *
 * Returns false when another runner holds the email. Never throws on a model
 * failure: `runFreightExtraction` writes the reason onto the email and returns
 * it, and an exception here would only make the queue retry a call that will
 * fail again for the same reason.
 */
async function tryExtract(
  container: AwilixContainer,
  emailId: string,
  scope: { tenantId: string; organizationId: string },
  claimFrom: readonly string[],
): Promise<boolean> {
  let outcome
  try {
    outcome = await runFreightExtraction(container, { emailId, scope, claimFrom })
  } catch (err) {
    // The only throw on this path is a lost claim, which is an expected race,
    // not an error. Anything else is reported and swallowed for the reason
    // above.
    logger.info('Did not extract this email', {
      emailId,
      claimFrom: [...claimFrom],
      reason: err instanceof Error ? err.message : String(err),
    })
    return false
  }

  logger.info('Extraction finished', {
    emailId,
    emailStatus: outcome.emailStatus,
    proposalId: outcome.proposalId,
    actionCount: outcome.actions.length,
    model: outcome.llmModel,
    processingError: outcome.processingError,
  })
  return true
}
