import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
// Knowing exception, dev seed script only, and the same one `cli.ts` and
// `demoCompany.ts` already document: this reaches straight into the installed
// `inbox_ops`, `messages`, `sales` and `notifications` entities so
// `seed-demo --reset` empties the tables the demo actually wrote to. It is NOT
// a cross-module ORM relation. No `offer_automation` entity exists, nothing
// here declares a foreign key, and every row is reached through that module's
// own entity with both scope ids in the filter.
//
// The one write that does NOT go through an entity directly is the quote:
// `sales.quotes.delete` already empties the five child tables that carry a real
// foreign key to `sales_quotes` and queues the index cleanup, so the command is
// used instead of reimplementing its cascade here.
import {
  InboxDiscrepancy,
  InboxEmail,
  InboxProposal,
  InboxProposalAction,
} from '@open-mercato/core/modules/inbox_ops/data/entities'
import {
  Message,
  MessageAccessToken,
  MessageConfirmation,
  MessageObject,
  MessageRecipient,
} from '@open-mercato/core/modules/messages/data/entities'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { assertDisposableSeedTarget } from './demoCompany'
import { buildSeedCommandContext } from './seedCommandContext'

/** One tenant, one organization. Both are required; neither is ever inferred. */
export type DemoResetScope = { tenantId: string; organizationId: string }

/**
 * Anything MikroORM will accept as an entity name. Kept structural so the plan
 * can be asserted without a database and without an ORM instance.
 */
export type ResetEntity = { name: string }

/**
 * How a step removes its rows.
 *
 * `hard-delete` is `em.nativeDelete`. `command-cascade` hands the row to an
 * installed delete command that owns the cascade.
 *
 * THERE IS NO `soft-delete` MEMBER, deliberately. Every activity table below
 * supports a hard delete: `inbox_emails`, `inbox_proposals`,
 * `inbox_proposal_actions`, `inbox_discrepancies`, `messages` and
 * `sales_quotes` do carry `deleted_at`, but nothing stops the row being
 * removed, and `notifications` carries no `deleted_at` at all
 * (notifications/data/entities.ts:14-118) so it could only ever be a hard
 * delete. A reset that merely stamped `deleted_at` would also leave
 * `inbox_emails`' two partial unique indexes on `(organization_id, tenant_id,
 * message_id)` and `(..., content_hash)` in force over rows nobody can see,
 * which is exactly the failure a re-run would hit. Add the member on the day an
 * installed entity refuses a hard delete, and print it.
 */
export type ResetMode = 'hard-delete' | 'command-cascade'

export type DemoResetStep = {
  /** Table this step empties. The printed label and the step's identity. */
  table: string
  /** The installed entity the rows are reached through. */
  entity: ResetEntity
  /**
   * Table whose rows own these, or `null` for a root.
   *
   * A parent is deleted AFTER its children, so the parent's step appears LATER
   * in the plan. `buildDemoResetPlan` guarantees that and the suite pins it.
   */
  parent: string | null
  mode: ResetMode
  /**
   * The filter every deleted row must match, always carrying BOTH scope ids.
   *
   * `null` only for a child table that carries no scope column at all.
   * `message_recipients`, `message_objects` and `message_access_tokens` hold a
   * `message_id` and nothing else (messages/data/entities.ts:147-262). Those
   * rows are reached through the parent's id list, which was itself resolved
   * with both ids, so the scope still holds; it is enforced one hop away.
   */
  where: (DemoResetScope & Record<string, unknown>) | null
  /**
   * The column holding the parent's id, for a step whose `where` is `null`.
   *
   * Named on the step rather than assumed by the executor: the delete is `{
   * [parentKey]: { $in: parentIds } }`, and a wrong column name there is a
   * delete of the wrong rows.
   */
  parentKey?: string
  /** Tables an installed cascade empties as part of this step. */
  cascades: readonly string[]
  /** Why this step exists, printed in the operator's `how` column. */
  how: string
}

export type DemoResetPlan = {
  scope: DemoResetScope
  steps: readonly DemoResetStep[]
}

export type DemoResetRow = {
  table: string
  /** `null` when this installed module set does not register the entity. */
  deleted: number | null
  how: string
}

export type DemoResetResult = {
  scope: DemoResetScope
  rows: DemoResetRow[]
  /** Rows deleted across every step. Counts a cascade as its parent only. */
  total: number
  /** Tables skipped because the entity is not registered in this app. */
  absent: string[]
}

/**
 * The flag, and the whole of the opt-in.
 *
 * Named here rather than read inline in `cli.ts` so the default can be pinned
 * without a database: a run that did not ask for a reset must not delete
 * anything, and that is a property of this one function. The two accepted
 * shapes mirror `readBoolean` in `cli.ts`, which is what parses every other
 * boolean flag on this command.
 */
export const DEMO_RESET_FLAG = 'reset'

export function isDemoResetRequested(args: Record<string, string | boolean>): boolean {
  const value = args[DEMO_RESET_FLAG]
  return value === true || value === 'true'
}

/** Both ids or nothing. A reset with half a scope is refused, never widened. */
function assertCompleteScope(scope: DemoResetScope): void {
  const missing = [
    scope.tenantId?.trim() ? null : 'tenantId',
    scope.organizationId?.trim() ? null : 'organizationId',
  ].filter(Boolean)
  if (missing.length === 0) return
  throw new Error(
    `Refusing to reset demo activity without ${missing.join(' and ')}. `
      + 'Every delete is filtered on the tenant AND the organization; a missing id would '
      + 'widen the delete instead of narrowing it.',
  )
}

/**
 * The ordered delete plan, as data.
 *
 * Pure on purpose. The order, the scope filter on every step and the
 * children-before-parents rule are the three things that make this command safe
 * to run, and all three are assertable here without a database.
 *
 * WHAT IS DELETED: activity. Inbound emails, the message thread they produced,
 * the proposals and actions core extracted from them, the quotes those actions
 * drafted, and the notifications the whole chain raised.
 *
 * WHAT SURVIVES, and is absent from this list on purpose: the tenant, the
 * organization, roles, users, the automation account, feature grants,
 * currencies, the sales dictionaries and statuses, the sales channel, the
 * freight catalogue, and the three freight customers with their contacts.
 *
 * `inbox_settings` survives too, and deliberately: the seed's inbound-mailbox
 * step writes exactly one row per organization and adopts it on a re-run, so it
 * is company configuration rather than activity, and `send-email` depends on
 * it. That step produces no per-run artefact of its own, so there is nothing
 * else of its to clear here.
 *
 * The seed rebuilds none of the above because it never removed them.
 * Operation/audit log entries also survive: they are the record of who did
 * what, and a reset of demo activity is not a reason to erase history.
 */
export function buildDemoResetPlan(scope: DemoResetScope): DemoResetPlan {
  assertCompleteScope(scope)
  const inScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const steps: DemoResetStep[] = [
    // --- the messages thread, children first -------------------------------
    {
      table: 'message_access_tokens',
      entity: MessageAccessToken,
      parent: 'messages',
      parentKey: 'messageId',
      mode: 'hard-delete',
      where: null,
      cascades: [],
      how: 'hard delete by message id',
    },
    {
      table: 'message_objects',
      entity: MessageObject,
      parent: 'messages',
      parentKey: 'messageId',
      mode: 'hard-delete',
      where: null,
      cascades: [],
      how: 'hard delete by message id',
    },
    {
      table: 'message_recipients',
      entity: MessageRecipient,
      parent: 'messages',
      parentKey: 'messageId',
      mode: 'hard-delete',
      where: null,
      cascades: [],
      how: 'hard delete by message id',
    },
    {
      // Carries both ids itself, so it is filtered directly rather than
      // through the parent's id list.
      table: 'message_confirmations',
      entity: MessageConfirmation,
      parent: 'messages',
      mode: 'hard-delete',
      where: { ...inScope },
      cascades: [],
      how: 'hard delete',
    },
    {
      // `thread_id` is a column on `messages`, not a table of its own, so
      // emptying the org's messages empties its threads.
      table: 'messages',
      entity: Message,
      parent: null,
      mode: 'hard-delete',
      where: { ...inScope },
      cascades: [],
      how: 'hard delete (threads are a column here)',
    },
    // --- the quotes the accepted actions drafted ---------------------------
    {
      table: 'sales_quotes',
      entity: SalesQuote,
      parent: null,
      mode: 'command-cascade',
      where: { ...inScope },
      cascades: [
        'sales_document_addresses',
        'sales_notes',
        'sales_document_tag_assignments',
        'sales_quote_adjustments',
        'sales_quote_lines',
      ],
      how: 'sales.quotes.delete, one per quote (+5 child tables)',
    },
    // --- the inbound artefacts, children first -----------------------------
    {
      table: 'inbox_discrepancies',
      entity: InboxDiscrepancy,
      parent: 'inbox_proposals',
      mode: 'hard-delete',
      where: { ...inScope },
      cascades: [],
      how: 'hard delete',
    },
    {
      table: 'inbox_proposal_actions',
      entity: InboxProposalAction,
      parent: 'inbox_proposals',
      mode: 'hard-delete',
      where: { ...inScope },
      cascades: [],
      how: 'hard delete',
    },
    {
      table: 'inbox_proposals',
      entity: InboxProposal,
      parent: 'inbox_emails',
      mode: 'hard-delete',
      where: { ...inScope },
      cascades: [],
      how: 'hard delete',
    },
    {
      table: 'inbox_emails',
      entity: InboxEmail,
      parent: null,
      mode: 'hard-delete',
      where: { ...inScope },
      cascades: [],
      how: 'hard delete',
    },
    // --- what the desk was told about all of it ----------------------------
    {
      // EVERY notification in this organization, not only this module's two
      // types. `inbox_ops.proposal.created`, `messages.*` and the sales quote
      // notifications all describe the same demo activity, and a filter that
      // kept them would leave the bell full of links into deleted records.
      // Notifications carrying `organization_id IS NULL` are tenant-wide and
      // are deliberately left alone: this command never deletes outside one
      // organization.
      table: 'notifications',
      entity: Notification,
      parent: null,
      mode: 'hard-delete',
      where: { ...inScope },
      cascades: [],
      how: 'hard delete (no deleted_at on this entity)',
    },
  ]

  return { scope, steps }
}

/**
 * Finds the tenant and organization the reset applies to, by the slug the seed
 * is idempotent on.
 *
 * Returns `null` when the organization does not exist, which is the ordinary
 * first-run case: there is no activity because there is no company yet.
 * Refuses when the slug is ambiguous, the same way `send-email` does. Picking
 * whichever row the database returned first is how a reset deletes another
 * tenant's data.
 */
export async function resolveDemoResetScope(
  em: EntityManager,
  orgSlug: string,
): Promise<DemoResetScope | null> {
  const candidates = (await em.find(Organization, {
    slug: orgSlug,
    deletedAt: null,
  } as never)) as unknown as Array<{ id: string; tenant?: { id?: string } }>

  if (candidates.length === 0) return null
  if (candidates.length > 1) {
    throw new Error(
      `${candidates.length} organizations share the slug "${orgSlug}"; refusing to guess which one to reset.`,
    )
  }
  const only = candidates[0]!
  const tenantId = only.tenant?.id
  if (!tenantId) {
    throw new Error(`Organization ${only.id} has no tenant; refusing to guess one.`)
  }
  return { tenantId, organizationId: only.id }
}

/**
 * Picks the user the quote deletes are recorded against.
 *
 * `sales.quotes.delete` writes an operation-log entry with an undo payload, so
 * it needs a real actor. The oldest non-deleted user in the same tenant AND
 * organization is used. That is a read inside the scope already resolved, never a
 * guess across tenants and never a made-up system id. Same rule as
 * `resolveSeedActorUserId` in `cli.ts`.
 */
async function resolveResetActorUserId(
  em: EntityManager,
  scope: DemoResetScope,
): Promise<string | null> {
  const user = await em.findOne(
    User,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as never,
    { orderBy: { createdAt: 'ASC', id: 'ASC' } } as never,
  )
  return (user as unknown as { id?: string } | null)?.id ?? null
}

/** Ids of the rows a step's own filter selects. Only `id` is read. */
async function selectIds(
  em: EntityManager,
  entity: ResetEntity,
  where: Record<string, unknown>,
): Promise<string[]> {
  // No limit and no chunking. A demo organization holds tens of rows; if one
  // ever holds enough to matter, the `$in` below is where it will be felt.
  const rows = (await em.find(entity as never, where as never, {
    fields: ['id'],
  } as never)) as unknown as Array<{ id: string }>
  return rows.map((row) => row.id)
}

/**
 * Deletes the demo organization's activity and reports what it removed.
 *
 * Refuses in a production-like environment first, through the SAME guard the
 * seed's writes use, and on its own terms rather than because the caller
 * remembered to check: this is the only part of `seed-demo` that destroys
 * anything, so it is the last place that should trust an ordering. Never prints
 * a password, because it never reads one.
 */
export async function runDemoReset(
  container: AwilixContainer,
  scope: DemoResetScope,
  /**
   * Environment the production guard reads. Defaults to the real one; passed
   * explicitly by the suite so a test can pin the refusal without mutating
   * `process.env` and leaking into another test file.
   */
  env: NodeJS.ProcessEnv = process.env,
): Promise<DemoResetResult> {
  assertDisposableSeedTarget(env)
  assertCompleteScope(scope)

  const plan = buildDemoResetPlan(scope)
  const em = (container.resolve('em') as EntityManager).fork()

  /**
   * Whether this app's ORM knows the entity at all.
   *
   * `find` and NOT `has`. `MetadataStorage.has` is a bare identity lookup in
   * the map keyed by the exact reference used at registration
   * (@mikro-orm/core/metadata/MetadataStorage.js:97-99), while `find` falls
   * back to the class-name map (:84-96). If discovery ever registered the
   * compiled copy of an entity while this file imported the typed one, `has`
   * would answer false and the step would be reported as "not present" while
   * its rows quietly survived. A wrong skip that prints as a clean result is
   * the one failure this command must not have.
   */
  const metadata = em.getMetadata()
  const isRegistered = (entity: ResetEntity): boolean =>
    Boolean(metadata.find(entity as never))

  const rows: DemoResetRow[] = []
  const absent: string[] = []
  const stepByTable = new Map(plan.steps.map((step) => [step.table, step]))
  const idsByTable = new Map<string, string[]>()
  let total = 0

  /**
   * Ids of a step's rows, read once and cached.
   *
   * A child with no scope column asks for its parent's ids BEFORE the parent's
   * own step runs, which is the only reason this is lazy: the parent rows are
   * still there at that point. The lookup always uses the parent's own filter,
   * so both scope ids are applied.
   */
  const idsFor = async (table: string): Promise<string[]> => {
    const cached = idsByTable.get(table)
    if (cached) return cached
    const step = stepByTable.get(table)
    if (!step?.where) {
      throw new Error(
        `Reset step "${table}" has no scope filter of its own; refusing to resolve its ids unscoped.`,
      )
    }
    const ids = isRegistered(step.entity) ? await selectIds(em, step.entity, step.where) : []
    idsByTable.set(table, ids)
    return ids
  }

  for (const step of plan.steps) {
    if (!isRegistered(step.entity)) {
      absent.push(step.table)
      rows.push({ table: step.table, deleted: null, how: 'not present in this app' })
      continue
    }

    if (step.mode === 'command-cascade') {
      const deleted = await deleteQuotesThroughCommand(
        container,
        em,
        scope,
        await idsFor(step.table),
      )
      rows.push({ table: step.table, deleted, how: step.how })
      total += deleted
      continue
    }

    if (step.where) {
      const deleted = await em.nativeDelete(step.entity as never, step.where as never)
      rows.push({ table: step.table, deleted, how: step.how })
      total += deleted
      continue
    }

    // Child table with no scope column. Its parent's ids are resolved with
    // both ids; an empty list means there is nothing to reach.
    if (!step.parent || !step.parentKey) {
      throw new Error(
        `Reset step "${step.table}" has no scope filter and no parent column to reach its rows by; `
          + 'refusing to run an unscoped delete.',
      )
    }
    const parentIds = await idsFor(step.parent)
    const deleted = parentIds.length
      ? await em.nativeDelete(step.entity as never, {
          [step.parentKey]: { $in: parentIds },
        } as never)
      : 0
    rows.push({ table: step.table, deleted, how: step.how })
    total += deleted
  }

  return { scope, rows, total, absent }
}

/**
 * Removes each quote through `sales.quotes.delete`.
 *
 * The command is used rather than a delete of its own because it already owns
 * the cascade: five tables carry a real foreign key to `sales_quotes`
 * (`sales_quote_lines`, `sales_quote_adjustments`, `sales_document_addresses`,
 * `sales_notes`, `sales_document_tag_assignments`), it removes them inside one
 * transaction, and it queues the search/index cleanup afterwards. It also
 * re-checks the scope itself through `ensureQuoteScope`, so every quote is
 * scope-checked twice: once by the query that found it, once by the command.
 */
async function deleteQuotesThroughCommand(
  container: AwilixContainer,
  em: EntityManager,
  scope: DemoResetScope,
  quoteIds: string[],
): Promise<number> {
  if (quoteIds.length === 0) return 0

  const actorUserId = await resolveResetActorUserId(em, scope)
  if (!actorUserId) {
    throw new Error(
      `${quoteIds.length} quote(s) to delete in organization ${scope.organizationId}, but no user in `
        + 'that tenant and organization to record the delete against. `sales.quotes.delete` logs an '
        + 'actor and an undo payload; refusing to invent one.',
    )
  }

  const commandBus = container.resolve('commandBus') as CommandBus
  if (!commandBus || typeof commandBus.execute !== 'function') {
    throw new Error('Command bus is not available; cannot delete quotes through sales.quotes.delete.')
  }

  const ctx = buildSeedCommandContext(container, { ...scope, actorUserId })
  let deleted = 0
  for (const id of quoteIds) {
    await commandBus.execute('sales.quotes.delete', { input: { id }, ctx })
    deleted += 1
  }
  return deleted
}

/**
 * The `0/7` block's body, in the same two-space columns as the rest of the
 * command.
 *
 * A formatter rather than inline `console.log` so the suite can read the output
 * without a database, the way `buildSeedClosingLines` is read.
 */
export function formatDemoResetLines(result: DemoResetResult): string[] {
  const lines = [
    `  tenantId       ${result.scope.tenantId}`,
    `  organizationId ${result.scope.organizationId}`,
    `  ${'table'.padEnd(26)} ${'deleted'.padStart(7)}  how`,
  ]
  for (const row of result.rows) {
    const count = row.deleted === null ? 'n/a' : String(row.deleted)
    lines.push(`  ${row.table.padEnd(26)} ${count.padStart(7)}  ${row.how}`)
  }
  lines.push(`  ${result.total} row(s) deleted by this run.`)

  // Called out on its own line because it answers the one question the reset
  // exists for. Core's inbound webhook dedupes on `content_hash` per tenant and
  // organization with no time window (inbox_ops/api/webhook/inbound.ts:437,
  // `checkDuplicate`), so a rehearsal that resends the same enquiry body is
  // silently dropped with a 200 until this row is gone.
  const emails = result.rows.find((row) => row.table === 'inbox_emails')
  if (emails && emails.deleted !== null) {
    lines.push(
      `  inbox emails deleted: ${emails.deleted}`
        + (emails.deleted > 0
          ? '  -> the same enquiry body can be sent again; core deduplicates it forever otherwise'
          : '  -> nothing was blocking a resend'),
    )
  }

  if (result.absent.length > 0) {
    // Said out loud rather than left as an `n/a` in a column. A table this app
    // does not register held no demo activity to remove, and an operator
    // chasing a row that survived needs to know this command never looked.
    lines.push(
      `  NOT DELETED, entity not registered in this app: ${result.absent.join(', ')}.`,
    )
  }

  lines.push('  The company, users, sales channel, catalogue and customers were left alone.')
  return lines
}
