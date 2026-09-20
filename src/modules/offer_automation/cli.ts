import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { getCliModules } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { findAppRoot } from '@open-mercato/shared/lib/bootstrap/appResolver'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
// Knowing exception, dev seed script only: this reaches straight into the
// installed `inbox_ops` and `sales` entities so the demo proposal lands in the
// same tables the core review UI reads, and so the summary can report the quote
// core created. It is NOT a cross-module ORM relation — no `offer_automation`
// entity exists, and nothing here declares a foreign key against either module.
// Runtime code in this module must keep going through the inbox-action contract
// and the command bus instead.
import {
  InboxEmail,
  InboxProposal,
  InboxProposalAction,
} from '@open-mercato/core/modules/inbox_ops/data/entities'
import type { InboxActionType } from '@open-mercato/core/modules/inbox_ops/data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { emitInboxOpsEvent } from '@open-mercato/core/modules/inbox_ops/events'
import { executeAction } from '@open-mercato/core/modules/inbox_ops/lib/executionEngine'
import { resolveOptionalEventBus } from '@open-mercato/core/modules/inbox_ops/lib/eventBus'
import { enableInboxActionRegistryForCli } from './lib/cliInboxActionRegistry'
import {
  createDemoMessageRecord,
  MESSAGE_AUDIENCE_FEATURE,
  type SeededEmailForMessage,
} from './lib/demoMessageRecord'
import { listOfferOrigins } from './lib/offerOrigins'
import { buildSeedClosingLines } from './lib/seedSummary'
import { buildEnquiryEmail } from './lib/inboundEnquiry'
import {
  DEMO_INBOX_ADDRESS,
  ensureDemoInbox,
  findInboxForScope,
  isInboxAddressActive,
} from './lib/demoInbox'
import {
  decideWebhookOutcome,
  describeWebhookOutcome,
  INBOUND_WEBHOOK_PATH,
  postInboundWebhook,
  signWebhookRequest,
  WEBHOOK_SECRET_ENV,
  webhookContentHash,
  type InboundWebhookPayload,
} from './lib/inboxWebhook'
import { POLL_INTERVAL_MS, sleep } from './lib/poll'
import {
  deriveSenderIdentity,
  MAX_BODY_CHARS,
  previewBody,
  resolveEmailOverrides,
  type EmailOverrides,
} from './lib/customEmailInput'
import {
  describeMessageThread,
  describeWhoCanSeeThread,
  messageThreadUrl,
} from './lib/messageThreadReport'
import { preflightCrmLink } from './lib/crmLinkPreflight'
import { describeUnsettled, watchSettled, type WatchState } from './lib/sendEmailWatch'
import {
  describeAiProvider,
  probeAiProvider,
  probeCoreExtractionSchema,
  type AiProviderDescription,
} from './lib/aiProviderCheck'
import {
  runLiveExtraction,
  type LiveExtractionMode,
  type LiveExtractionOutcome,
} from './lib/liveExtraction'
import {
  FREIGHT_CURRENCY,
  FREIGHT_SERVICES,
  seedFreightServices,
  type FreightCatalogSeedResult,
} from './lib/freightCatalog'
import {
  formatDemoResetLines,
  isDemoResetRequested,
  resolveDemoResetScope,
  runDemoReset,
} from './lib/demoReset'
import {
  AUTOMATION_USER_EMAIL,
  ensureAutomationUser,
  resolveAutomationUserId,
  type AutomationUser,
} from './lib/automationUser'
import {
  assertPasswordAcceptable,
  DEFAULT_DEMO_PASSWORD,
  DEMO_ADMIN_EMAIL,
  DEMO_COMPANY_NAME,
  DEMO_ORG_SLUG,
  DEMO_SALES_EMAIL,
  ensureDemoTenant,
  ensureDemoUsers,
  ensureSalesChannel,
  hasActiveSalesChannel,
  primaryDemoContact,
  seedDemoCustomers,
  type DemoUser,
} from './lib/demoCompany'
import {
  DRAFT_OFFER_ACTION_TYPE,
  DRAFT_OFFER_REQUIRED_FEATURE,
  draftOfferPayloadSchema,
} from './inbox-actions'

const COMMAND = 'demo'

const USAGE = [
  'Usage:',
  '  yarn mercato offer_automation demo --tenant <tenantId> --org <organizationId>',
  '  yarn mercato offer_automation demo --tenant <tenantId> --org <organizationId> --auto-accept --user <userId>',
  '  yarn mercato offer_automation demo --tenant <tenantId> --org <organizationId> --live --auto-accept --user <userId>',
  '',
  'THIS IS THE DETERMINISTIC COMMAND. It writes the inbox email itself and can',
  'stub the extraction, so it needs no server, no model, no API key and no queue',
  'worker, and it accepts the action itself with --auto-accept instead of waiting',
  'for a subscriber. Use it when the network, the key or the worker cannot be',
  'relied on.',
  'The other one is `send-email`: it POSTs a signed webhook to the running app,',
  'core writes the email and emits the event, and everything after that happens',
  'because subscribers react. Use that one to show the system working on its own.',
  '',
  'Seeds the transport services in the catalogue (idempotent, see `seed-catalog`),',
  'then the inbound artefacts a real customer email would have produced (one inbox',
  'email, one messages thread, one proposal, one pending app-owned `draft_offer`',
  'action) so a human can accept it in the backend.',
  '',
  'By default extraction is STUBBED: the proposal payload is written by this',
  'command and no model is called, so the demo works with no API key and no',
  'network. Add --live and core\'s own extraction worker calls the configured',
  'model instead, which is what turns the email into the action. Check the model',
  'is reachable first with: yarn mercato offer_automation check-ai',
  '',
  'Flags:',
  '  --tenant <uuid>   Required. Never inferred.',
  '  --org <uuid>      Required. Must belong to --tenant.',
  '  --live            Have a model read the email and pick the catalogue lines.',
  '                    The action and its SKUs come from the model; the prices',
  '                    stay ours. Costs one API call.',
  '  --live-mode <m>   `app` (default) uses this module\'s own narrow extraction,',
  '                    which is the only one that runs today: core\'s extraction',
  '                    schema is rejected by OpenAI strict structured outputs.',
  '                    `core` calls the installed extraction worker here.',
  '                    `core-via-events` emits the persistent',
  '                    `inbox_ops.email.received` event the inbound webhook emits',
  '                    and waits for a queue worker; that needs `yarn dev`',
  '                    running (or `yarn mercato queue worker --all`). Both core',
  '                    modes currently end `failed`; run check-ai for why.',
  '  --live-timeout <ms>  How long `core-via-events` waits. Default 120000.',
  '  --auto-accept     Also run the acceptance through the inbox_ops execution',
  '                    engine, headless, as --user. Creates the draft quote.',
  '  --user <uuid>     Acting user for --auto-accept. Must hold',
  `                    ${DRAFT_OFFER_REQUIRED_FEATURE}.`,
  '  --force-unpriced  Name a service this seller does not sell, the way an',
  '                    over-confident model would, to demonstrate the refusal.',
  '                    With --auto-accept the action ends `failed` and NO quote',
  '                    is created.',
  '  --no-message      Skip the messages record. The demo writes one by default,',
  '                    because the real extraction worker always does; that needs',
  `                    a user in --tenant holding ${MESSAGE_AUDIENCE_FEATURE},`,
  '                    and the run refuses rather than seeding half the chain.',
  '                    Ignored with --live: core writes the record itself there.',
  '  --from <addr>     Sender of the enquiry. Spelled `--from` on both commands;',
  '                    `--customer-email` is accepted as an alias. The default is',
  '                    a one-off address nobody in the CRM owns, so the quote',
  '                    carries a customer snapshot. Point it at a seeded CRM',
  '                    contact and the quote links to that customer record.',
  '  --customer-name <name>   Company the sender writes on behalf of.',
  '  --contact-name <name>    Person who signs the email.',
].join('\n')

// A prefix on the seeded email's Message-ID is how a later run recognises the
// artefacts an earlier run left behind. Keeping the legacy `seed-` value in the
// list means a proposal from the previous `seed-proposal` command is superseded
// too, instead of sitting in the review queue with a payload the current schema
// rejects.
const SEEDED_MESSAGE_ID_PREFIXES = ['<offer-automation-demo-', '<offer-automation-seed-']

type Args = Record<string, string | boolean>

function parseArgs(rest: string[]): Args {
  const args: Args = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a) continue
    if (!a.startsWith('--')) continue
    const [k, v] = a.replace(/^--/, '').split('=')
    if (!k) continue
    if (v !== undefined) args[k] = v
    else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
      args[k] = rest[i + 1]!
      i++
    } else args[k] = true
  }
  return args
}

function readFlag(args: Args, ...names: string[]): string | null {
  for (const name of names) {
    const value = args[name]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function readBoolean(args: Args, ...names: string[]): boolean {
  return names.some((name) => args[name] === true || args[name] === 'true')
}

/**
 * Ends the run with a non-zero exit code.
 *
 * The CLI harness returns 0 for any command that merely sets `process.exitCode`
 * (`@open-mercato/cli/dist/mercato.js` returns 0 straight after `cmd.run()`), so
 * a refusal has to throw to be detectable by a script. The hint lines go to
 * stderr first; the harness prints the headline as "Failed: <message>".
 */
function fail(message: string, ...details: string[]): never {
  for (const line of details) console.error(line)
  throw new Error(message)
}

function baseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

/** End of the current month, which is the deadline the seeded email asks for. */
function endOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12, 0, 0))
}

/**
 * Picks the user the catalogue seed is recorded against.
 *
 * Every write goes through core's command bus, which stamps an operation-log
 * actor. `--user` is used when the run has one. Otherwise the oldest
 * non-deleted user in the same tenant AND organization is used, which is a read
 * inside the scope the command already validated, never a guess across tenants.
 * A scope with no user at all refuses rather than inventing a system actor.
 */
async function resolveSeedActorUserId(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  preferredUserId: string | null,
): Promise<string> {
  if (preferredUserId) return preferredUserId

  const user = await em.findOne(
    User,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as never,
    { orderBy: { createdAt: 'ASC', id: 'ASC' } } as never,
  )
  const userId = (user as unknown as { id?: string } | null)?.id
  if (!userId) {
    fail(
      `No user in tenant ${scope.tenantId} / organization ${scope.organizationId} to record the catalogue seed against.`,
      'Create one, or re-run with --user <userId>.',
    )
  }
  return userId
}

function printCatalogSummary(catalog: FreightCatalogSeedResult): void {
  console.log('Transport services in the catalogue:')
  for (const row of catalog.rows) {
    const what = [
      row.created.product ? 'product' : null,
      row.created.variant ? 'variant' : null,
      row.created.price ? 'price' : null,
    ].filter(Boolean)
    const state = what.length ? `created ${what.join(' + ')}` : 'already present'
    console.log(`  ${row.sku.padEnd(18)} ${row.unitPriceNet.padStart(8)} ${FREIGHT_CURRENCY}  ${state}`)
    console.log(`  ${''.padEnd(18)} ${row.title}`)
  }
  if (catalog.priceKindCreated) console.log(`  price kind "regular" created for this tenant`)
  console.log(`  ${catalog.createdCount} row(s) created by this run.`)
}

/** One line naming who wrote the payload, and which extractor asked them. */
function describeExtractionSource(outcome: LiveExtractionOutcome | null): string {
  if (!outcome) return 'stubbed by this command (no model called)'
  const model = outcome.llmModel || '<model unknown>'
  const extractor =
    outcome.mode === 'app'
      ? "offer_automation's own extraction (shim #4)"
      : "core's inbox_ops extraction worker"
  return `${model} via ${extractor} (--live-mode ${outcome.mode})`
}

/**
 * Prints what the model actually returned, next to what the catalogue holds.
 *
 * The SKU columns are the point of the whole live path: an operator has to be
 * able to see, without SQL, whether the model copied real catalogue SKUs or
 * invented plausible-looking ones. A `MISS` here is the honest answer to "is
 * this reliable?", and it is printed before any quote is created.
 */
function printLiveExtraction(
  outcome: LiveExtractionOutcome,
  catalog: FreightCatalogSeedResult,
): void {
  const knownSkus = new Set(catalog.rows.map((row) => row.sku))

  console.log('')
  console.log(`Extraction result (real model call, ${describeExtractionSource(outcome)}):`)
  console.log(`  mode:          ${outcome.mode}`)
  console.log(`  model:         ${outcome.llmModel ?? '<none: extraction did not complete>'}`)
  console.log(`  tokens:        ${outcome.llmTokensUsed ?? 0}`)
  console.log(`  elapsed:       ${(outcome.waitedMs / 1000).toFixed(1)}s`)
  console.log(`  emailStatus:   ${outcome.emailStatus}`)
  console.log(`  confidence:    ${outcome.proposalConfidence ?? '<none>'}`)
  if (outcome.processingError) console.log(`  error:         ${outcome.processingError}`)
  if (outcome.timedOut) {
    console.log('  timedOut:      yes — no events worker drained the queue in time.')
    console.log('                 The job is durable and still queued. Start a worker with:')
    console.log('                   yarn mercato queue worker --all')
    console.log('                 or re-run with --live-mode in-process.')
  }
  if (outcome.proposalSummary) console.log(`  summary:       ${outcome.proposalSummary}`)

  if (outcome.actions.length === 0) {
    console.log('  actions:       <none>')
    return
  }

  console.log('')
  console.log('  Proposed actions:')
  for (const action of outcome.actions) {
    console.log(`    ${action.actionType} (${action.status}, confidence ${action.confidence ?? '?'})`)
    if (action.actionType !== DRAFT_OFFER_ACTION_TYPE) continue

    const lineItems = Array.isArray((action.payload as { lineItems?: unknown } | null)?.lineItems)
      ? ((action.payload as { lineItems: Record<string, unknown>[] }).lineItems)
      : []
    if (lineItems.length === 0) {
      console.log('      <no lineItems>')
      continue
    }
    console.log('      sku                 in catalogue  qty        name')
    for (const item of lineItems) {
      const sku = typeof item.sku === 'string' ? item.sku : '<none>'
      const hit = knownSkus.has(sku) ? 'HIT ' : 'MISS'
      const qty = item.quantity == null ? '?' : String(item.quantity)
      const name = typeof item.productName === 'string' ? item.productName : '<unnamed>'
      console.log(`      ${sku.padEnd(20)}${hit.padEnd(14)}${qty.padEnd(11)}${name}`)
      // The one thing a model is never allowed to decide. Printed when present
      // so an operator can see it was returned AND see it changed nothing.
      if (item.unitPrice != null) {
        console.log(`      ${''.padEnd(20)}model sent unitPrice ${String(item.unitPrice)} — IGNORED, priced from the catalogue`)
      }
    }
  }
}

async function supersedePreviousDemoProposals(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  keepProposalId: string,
): Promise<number> {
  const emails = await em.find(InboxEmail, {
    $or: SEEDED_MESSAGE_ID_PREFIXES.map((prefix) => ({ messageId: { $like: `${prefix}%` } })),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as never)
  const emailIds = emails.map((email) => email.id)
  if (emailIds.length === 0) return 0

  // `isActive: false` is core's own supersede flag: the review UI hides the
  // proposal and the accept API answers 409 "superseded by a newer extraction".
  // Nothing is deleted, so earlier runs stay auditable.
  //
  // Only unfinished demo proposals are retired. One that was already accepted
  // or rejected is history the operator should keep seeing, and its quote
  // exists regardless.
  return em.nativeUpdate(
    InboxProposal,
    {
      inboxEmailId: { $in: emailIds },
      id: { $ne: keepProposalId },
      isActive: true,
      status: { $in: ['pending', 'partial'] },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as never,
    { isActive: false } as never,
  )
}

const demo: ModuleCli = {
  command: COMMAND,
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(USAGE)
      return
    }

    const tenantId = readFlag(args, 'tenant', 'tenantId')
    const organizationId = readFlag(args, 'org', 'organizationId')
    const autoAccept = readBoolean(args, 'auto-accept', 'autoAccept')
    const actingUserId = readFlag(args, 'user', 'userId')
    // On by default: a real inbound email always produces a message record, so a
    // demo that skipped it would show an incomplete chain at /backend/messages.
    const withMessage = !readBoolean(args, 'no-message', 'noMessage', 'skip-message')
    // Demo switch for the unhappy path. A line nobody can price must never turn
    // into a zero, and the only way an operator can see that for themselves is
    // to break one on purpose.
    const forceUnpriced = readBoolean(args, 'force-unpriced', 'forceUnpriced')
    const live = readBoolean(args, 'live')
    const liveModeFlag = readFlag(args, 'live-mode', 'liveMode') ?? 'app'
    if (liveModeFlag !== 'app' && liveModeFlag !== 'core' && liveModeFlag !== 'core-via-events') {
      fail(
        `--live-mode must be "app", "core" or "core-via-events", not "${liveModeFlag}".`,
        USAGE,
      )
    }
    const liveMode = liveModeFlag as LiveExtractionMode
    const liveTimeoutMs = Number(readFlag(args, 'live-timeout', 'liveTimeout') ?? '120000')
    if (!Number.isInteger(liveTimeoutMs) || liveTimeoutMs < 1000) {
      fail('--live-timeout must be an integer of at least 1000 (milliseconds).', USAGE)
    }
    // `--force-unpriced` breaks the payload this command writes. With --live the
    // payload is the model's, so there is nothing here to break; refusing beats
    // running something that silently ignores a flag the operator typed.
    if (live && forceUnpriced) {
      fail(
        '--force-unpriced and --live are mutually exclusive.',
        'The unpriced demo works by writing a deliberately broken payload, and with',
        '--live the payload comes from the model. Drop one of the two flags.',
      )
    }

    // Fail closed. Never fall back to "whatever tenant the database happens to
    // have" — a seed that guesses its scope writes into someone else's data.
    if (!tenantId || !organizationId) {
      fail(
        'Both --tenant and --org are required; neither is inferred.',
        USAGE,
        'List them with: yarn mercato auth list-tenants / yarn mercato auth list-orgs',
      )
    }
    if (autoAccept && !actingUserId) {
      fail('--auto-accept needs --user <userId>: the acceptance is recorded against a real person.', USAGE)
    }

    const container = (await createRequestContainer()) as unknown as AwilixContainer
    const em = (container.resolve('em') as EntityManager).fork()

    const organization = await em.findOne(Organization, {
      id: organizationId,
      deletedAt: null,
    } as never)
    if (!organization) {
      fail(`Organization ${organizationId} not found (or soft-deleted).`)
    }
    const ownerTenantId = (organization as unknown as { tenant?: { id?: string } }).tenant?.id
    if (ownerTenantId !== tenantId) {
      fail(
        `Organization ${organizationId} belongs to tenant ${ownerTenantId ?? '<unknown>'}, not ${tenantId}. Refusing to seed across tenants.`,
      )
    }

    // Authorize before writing anything. A seeded proposal whose acceptance is
    // going to be denied is worse than no proposal at all.
    if (autoAccept) {
      const user = await em.findOne(User, { id: actingUserId, deletedAt: null } as never)
      if (!user) {
        fail(`User ${actingUserId} not found (or soft-deleted).`)
      }
      const userTenantId = (user as unknown as { tenantId?: string | null }).tenantId ?? null
      const userOrganizationId = (user as unknown as { organizationId?: string | null }).organizationId ?? null
      if (userTenantId !== tenantId || userOrganizationId !== organizationId) {
        fail(
          `User ${actingUserId} belongs to tenant ${userTenantId ?? '<none>'} / organization ${userOrganizationId ?? '<none>'}, not ${tenantId} / ${organizationId}.`,
        )
      }

      const rbacService = container.resolve('rbacService') as {
        userHasAllFeatures: (
          userId: string,
          features: string[],
          scope: { tenantId: string; organizationId: string },
        ) => Promise<boolean>
      }
      const allowed = await rbacService.userHasAllFeatures(actingUserId!, [DRAFT_OFFER_REQUIRED_FEATURE], {
        tenantId,
        organizationId,
      })
      // This mirrors the gate the execution engine applies anyway
      // (executionEngine.ts `ensureUserCanExecuteAction`). It runs first only so
      // the operator gets the reason instead of a bare 403 later. The engine's
      // own check still runs and is still authoritative.
      if (!allowed) {
        fail(
          `User ${actingUserId} lacks ${DRAFT_OFFER_REQUIRED_FEATURE}; refusing to execute.`,
          'Grant it by assigning a role that holds the feature, then re-run:',
          `  yarn mercato auth sync-role-acls --tenant ${tenantId}`,
        )
      }
    }

    // The catalogue comes first: the payload below references seeded variants by
    // id, and the action prices from those rows. Idempotent, so re-running the
    // demo creates nothing here after the first time.
    const actorUserId = await resolveSeedActorUserId(em, { tenantId, organizationId }, actingUserId)
    const catalog = await seedFreightServices(container, {
      tenantId,
      organizationId,
      actorUserId,
    })
    const productIdBySku = new Map(catalog.rows.map((row) => [row.sku, row.productId]))
    const requireProductId = (sku: string): string => {
      const id = productIdBySku.get(sku)
      if (!id) fail(`Catalogue seed did not produce a product for ${sku}.`)
      return id
    }

    const now = new Date()
    const suffix = now.getTime()
    // Default sender: a unique address nobody in the CRM owns, so the accepted
    // quote falls back to `customerSnapshot` and the unlinked path stays
    // demonstrable. `seed-demo` overrides it with a seeded contact, which is
    // what makes core's `resolveCustomerEntityIdByEmail` find a real customer.
    const customerEmail =
      readFlag(args, 'from', 'customer-email', 'customerEmail') ??
      `logistics+${suffix}@acme-industrial.example`
    const customerName =
      readFlag(args, 'customer-name', 'customerName') ?? 'Acme Industrial Logistics'
    const contactName = readFlag(args, 'contact-name', 'contactName') ?? 'Marta Nowak'

    // Stubbed extraction. This is exactly the object an extraction model has to
    // produce from the email below; the schema that validates it is core's
    // `orderPayloadSchema`, the same one `create_quote` uses. With --live a
    // model writes this object instead and none of it is used.
    //
    // IT CARRIES ONLY IDENTIFIERS A MODEL COULD ACTUALLY RETURN. A model is
    // shown PRODUCT rows (`inbox_ops/lib/catalogLookup.ts:91-96`), so it knows
    // a `sku` and a product `id` and has never seen a variant id. The first
    // line uses the SKU and the second the product id, so both halves of
    // `resolveVariantForLine` run against the real catalogue on every demo.
    //
    // No `unitPrice` anywhere, and that is the point. The extraction supplies
    // identifiers and quantities; every amount on the quote is read from the
    // catalogue by `priceLinesFromCatalog` once the action is accepted.
    const payload = draftOfferPayloadSchema.parse({
      customerName,
      customerEmail,
      currencyCode: FREIGHT_CURRENCY,
      lineItems: [
        {
          productName: 'Groupage (LTL) road freight, per pallet',
          // `--force-unpriced` names a service this seller does not sell, which
          // is what an over-confident model looks like from the outside.
          sku: forceUnpriced ? 'FRT-SEA-CONTAINER' : 'FRT-LTL-PALLET',
          quantity: '8',
          kind: 'service',
          description: 'Poznań (PL) to Rotterdam (NL), 8 EUR pallets, 1.6 m high, ~420 kg each',
        },
        {
          productName: 'Tail-lift delivery, per stop',
          productId: requireProductId('FRT-ACC-TAILLIFT'),
          quantity: '1',
          kind: 'service',
          description: 'Delivery site has no loading dock',
        },
      ],
      requestedDeliveryDate: endOfMonth(now).toISOString(),
      notes:
        'Collection from our Poznań warehouse, delivery to Rotterdam. No dock at the delivery address, tail-lift needed. Please confirm transit time.',
      shippingAddress: {
        company: customerName,
        contactName,
        line1: 'Waalhaven Oostzijde 81',
        city: 'Rotterdam',
        postalCode: '3087 BM',
        country: 'NL',
      },
    })

    const emailId = randomUUID()
    // On the stub path these are ours to mint. On the live path core mints them
    // and we read them back off the rows the extraction worker wrote.
    let proposalId: string | null = randomUUID()
    let actionId: string | null = randomUUID()

    // One literal for the inbound email, shared with `send-email`
    // (`lib/inboundEnquiry.ts`). The messages record below is built from this
    // same object, so the thread at /backend/messages and the Inbox Ops email
    // can never drift apart in subject, sender or body.
    const seededEmail = buildEnquiryEmail({
      emailId,
      messageIdPrefix: SEEDED_MESSAGE_ID_PREFIXES[0]!,
      customerEmail,
      customerName,
      contactName,
      tenantId,
      organizationId,
      status: live ? 'received' : 'processed',
      seededBy: `offer_automation ${COMMAND}${live ? ' --live' : ''}`,
      now,
    })

    em.persist(em.create(InboxEmail, seededEmail))

    let liveOutcome: LiveExtractionOutcome | null = null

    if (live) {
      // Nothing else is written here. Everything downstream of the email is the
      // model's work, through core's worker.
      await em.flush()

      // The extraction prompt is assembled from the generated inbox-action
      // registry (`inbox_ops/lib/extractionPrompt.ts:12`), reached through a
      // bundler alias plain Node cannot resolve. Without this hook the prompt
      // would silently omit OUR `draft_offer` schema and the model could never
      // propose it.
      const appRootForRegistry = findAppRoot()?.appDir ?? process.cwd()
      await enableInboxActionRegistryForCli(appRootForRegistry)

      console.log('')
      console.log(`Running core's extraction worker (${liveMode}). This calls the model.`)
      liveOutcome = await runLiveExtraction(container, {
        emailId,
        scope: { tenantId, organizationId },
        forwardedByAddress: seededEmail.forwardedByAddress,
        subject: seededEmail.subject,
        mode: liveMode,
        timeoutMs: liveTimeoutMs,
      })

      proposalId = liveOutcome.proposalId
      const draftOfferActions = liveOutcome.actions.filter(
        (action) => action.actionType === DRAFT_OFFER_ACTION_TYPE,
      )
      actionId = draftOfferActions[0]?.id ?? null
    } else {
      em.persist(
        em.create(InboxProposal, {
        id: proposalId,
        inboxEmailId: emailId,
        summary:
          `${customerName} asks for a transport quote: groupage of 8 pallets from Poznań to Rotterdam plus a tail-lift delivery, collected before month end.`,
        participants: [{ email: customerEmail, name: customerName, role: 'buyer' }] as never,
        confidence: '0.95',
        detectedLanguage: 'en',
        category: 'rfq',
        status: 'pending',
        workingLanguage: 'en',
        organizationId,
        tenantId,
        metadata: { seededBy: `offer_automation ${COMMAND}` },
        }),
      )

      em.persist(
        em.create(InboxProposalAction, {
        id: actionId,
        proposalId,
        sortOrder: 0,
        // The `action_type` column is plain `text`; the exported
        // `InboxActionType` union is closed and does not know app-owned types,
        // so the cast is the documented seam, not a workaround for bad data.
        actionType: DRAFT_OFFER_ACTION_TYPE as InboxActionType,
        description: 'Draft an offer for 8 pallets of groupage freight plus one tail-lift delivery',
        payload: payload as unknown as Record<string, unknown>,
        status: 'pending',
        confidence: '0.92',
        requiredFeature: DRAFT_OFFER_REQUIRED_FEATURE,
        organizationId,
        tenantId,
        metadata: { seededBy: `offer_automation ${COMMAND}` },
        }),
      )

      await em.flush()
    }

    if (liveOutcome) printLiveExtraction(liveOutcome, catalog)

    const superseded = await supersedePreviousDemoProposals(
      em,
      { tenantId, organizationId },
      // A live run that produced no proposal has nothing to keep, so every
      // earlier unfinished demo proposal is retired. A random id matches none.
      proposalId ?? randomUUID(),
    )

    // Supersede retires the earlier *proposal*, which is an extraction and can
    // be replaced. It does not touch earlier message rows, because a message is
    // the record that an email arrived, and that stayed true. Each earlier
    // message still points at its own `inbox_emails` row and its own thread, so
    // nothing is orphaned; the messages list simply grows by one per run.
    //
    // In the two core live modes the installed extraction worker calls
    // `createMessageRecordForEmail` itself, so writing a second record here
    // would double the thread. The app mode writes no message record, so this
    // one is still needed there.
    const coreWritesMessage = live && liveMode !== 'app'
    let messageId: string | null = null
    let messageRecipients = 0
    if (withMessage && !coreWritesMessage) {
      const outcome = await createDemoMessageRecord(
        container,
        {
          id: seededEmail.id,
          subject: seededEmail.subject,
          cleanedText: seededEmail.cleanedText,
          rawText: seededEmail.rawText,
          forwardedByAddress: seededEmail.forwardedByAddress,
          forwardedByName: seededEmail.forwardedByName,
          status: seededEmail.status,
        },
        { tenantId, organizationId },
      )
      if (!outcome.ok) {
        fail(
          `Seeded the proposal but could not create its message record: ${outcome.reason}`,
          ...outcome.hints,
        )
      }
      messageId = outcome.messageId
      messageRecipients = outcome.recipientCount
    }

    const messageLine = coreWritesMessage
      ? '<written by core\'s extraction worker; see /backend/messages>'
      : withMessage
        ? `${messageId}  (${messageRecipients} recipient(s))`
        : '<skipped: --no-message>'

    const proposalUrl = proposalId
      ? `${baseUrl()}/backend/inbox-ops/proposals/${proposalId}`
      : `${baseUrl()}/backend/inbox-ops/proposals`

    // A live run that produced no `draft_offer` has nothing to accept and
    // nothing to print a next step for. This is a real outcome, not a crash:
    // the reason is on the rows above, so say it and exit non-zero.
    if (live && !actionId) {
      console.log('')
      fail(
        'The model produced no `draft_offer` action for this email.',
        liveOutcome?.processingError
          ? `Extraction error: ${liveOutcome.processingError}`
          : 'Extraction succeeded but proposed something else; the proposal above lists what.',
        'Check the model is reachable:  yarn mercato offer_automation check-ai',
        'Demo without a model instead:   drop --live.',
      )
    }

    if (!autoAccept) {
      console.log('')
      printCatalogSummary(catalog)
      console.log('')
      console.log('Inbound request seeded. Gate 1 is yours: a human accepts the extracted action.')
      console.log(`  extraction:      ${describeExtractionSource(liveOutcome)}`)
      console.log(`  tenantId:        ${tenantId}`)
      console.log(`  organizationId:  ${organizationId}`)
      console.log(`  inboxEmailId:    ${emailId}`)
      console.log(`  messageId:       ${messageLine}`)
      console.log(`  proposalId:      ${proposalId}`)
      console.log(`  actionId:        ${actionId}  (${DRAFT_OFFER_ACTION_TYPE}, status: pending)`)
      console.log(`  superseded:      ${superseded} earlier unfinished demo proposal(s) set inactive`)
      console.log('                   (earlier message rows are kept: the emails really arrived)')
      console.log('')
      console.log(`Inbox:    ${baseUrl()}/backend/messages`)
      console.log(`Proposal: ${proposalUrl}`)
      console.log('Next:  click Accept on the "draft_offer" card. That creates the draft quote,')
      console.log('       priced from the catalogue, and the card turns green with')
      console.log('       "Created sales_quote".')
      console.log('')
      return
    }

    const appRoot = findAppRoot()?.appDir ?? process.cwd()
    await enableInboxActionRegistryForCli(appRoot)

    const seededAction = await em.findOne(InboxProposalAction, { id: actionId } as never)
    if (!seededAction) {
      fail(`Seeded action ${actionId} disappeared before execution.`)
    }

    const result = await executeAction(seededAction, {
      em,
      userId: actingUserId!,
      tenantId,
      organizationId,
      container,
      eventBus: resolveOptionalEventBus(container),
      // `isSuperAdmin: false` on purpose: the CLI never hands the acting user
      // more authority than a browser session would.
      auth: {
        sub: actingUserId!,
        userId: actingUserId!,
        tenantId,
        orgId: organizationId,
        isSuperAdmin: false,
      },
    } as never)

    const executedAction = await em.fork().findOne(InboxProposalAction, { id: actionId } as never)
    const executedProposal = await em.fork().findOne(InboxProposal, { id: proposalId } as never)
    const quoteId = (result as { createdEntityId?: string | null }).createdEntityId ?? null
    const quote = quoteId
      ? await em.fork().findOne(SalesQuote, { id: quoteId } as never)
      : null

    console.log('')
    printCatalogSummary(catalog)
    console.log('')
    console.log('Inbound request seeded and accepted headlessly through the inbox_ops engine.')
    console.log(`  extraction:      ${describeExtractionSource(liveOutcome)}`)
    console.log(`  tenantId:        ${tenantId}`)
    console.log(`  organizationId:  ${organizationId}`)
    console.log(`  acceptedBy:      ${actingUserId}`)
    console.log(`  inboxEmailId:    ${emailId}`)
    console.log(`  messageId:       ${messageLine}`)
    console.log(`  proposalId:      ${proposalId}`)
    console.log(`  proposalStatus:  ${(executedProposal as { status?: string } | null)?.status ?? '<unknown>'}`)
    console.log(`  actionId:        ${actionId}`)
    console.log(`  actionStatus:    ${(executedAction as { status?: string } | null)?.status ?? '<unknown>'}`)
    console.log(`  superseded:      ${superseded} earlier unfinished demo proposal(s) set inactive`)
    console.log('                   (earlier message rows are kept: the emails really arrived)')

    if (!(result as { success?: boolean }).success) {
      console.log('')
      fail(
        `Execution failed: ${(result as { error?: string }).error ?? 'unknown error'} (status ${(result as { statusCode?: number }).statusCode ?? '?'})`,
        `Inspect the action on ${proposalUrl} — it is retryable from the card.`,
      )
    }

    const quoteNumber = (quote as { quoteNumber?: string } | null)?.quoteNumber ?? '<unknown>'
    const quoteStatus = (quote as { status?: string | null } | null)?.status ?? 'draft (no status set)'

    console.log(`  quoteId:         ${quoteId}`)
    console.log(`  quoteNumber:     ${quoteNumber}`)
    console.log(`  quoteStatus:     ${quoteStatus}`)

    const quoteLines = quoteId
      ? ((await em.fork().find(
          SalesQuoteLine,
          { quote: quoteId } as never,
          { orderBy: { lineNumber: 'ASC' } } as never,
        )) as unknown as Array<{
          lineNumber: number
          name?: string | null
          quantity: string
          unitPriceNet: string
          totalNetAmount: string
          currencyCode: string
        }>)
      : []

    if (quoteLines.length > 0) {
      console.log('')
      console.log('Quote lines, priced from the catalogue:')
      for (const line of quoteLines) {
        console.log(
          `  ${String(line.lineNumber).padStart(2)}. ${(line.name ?? '<unnamed>').padEnd(42)}` +
            ` qty ${line.quantity.padStart(10)}` +
            ` x ${line.unitPriceNet.padStart(10)}` +
            ` = ${line.totalNetAmount.padStart(12)} ${line.currencyCode}`,
        )
      }
      const grandTotal = (quote as { grandTotalNetAmount?: string } | null)?.grandTotalNetAmount
      if (grandTotal) console.log(`  net total: ${grandTotal} ${(quote as { currencyCode?: string }).currencyCode}`)
    }

    console.log('')
    console.log(`Inbox:    ${baseUrl()}/backend/messages`)
    console.log(`Proposal: ${proposalUrl}`)
    console.log(`Quote:    ${baseUrl()}/backend/sales/quotes/${quoteId}`)
    console.log('')
    console.log('Gate 2 is the salesperson: review the priced quote and send it. Nothing has')
    console.log('been sent to the customer.')
    console.log('')
  },
}

const ORIGINS_USAGE = [
  'Usage:',
  '  yarn mercato offer_automation origins --tenant <tenantId> --org <organizationId> [--page 1] [--page-size 20]',
  '',
  'Prints both legs of the email -> proposal -> quote trail for recent',
  '`draft_offer` actions, reading through the same decryption path the backend',
  'page uses. `linksBack` is the backward leg: it is true when the quote\'s own',
  'metadata points at the proposal, which is what the quote detail page reads.',
].join('\n')

/**
 * Headless view of what `/backend/offer-automation/origins` shows.
 *
 * Exists so the trail can be verified without a browser session, and so an
 * operator can tell a broken link apart from a missing one: a row with a quote
 * but `linksBack: false` means the quote was created before this module wrote
 * `buildSourceMetadata` onto it.
 */
const origins: ModuleCli = {
  command: 'origins',
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(ORIGINS_USAGE)
      return
    }

    const tenantId = readFlag(args, 'tenant', 'tenantId')
    const organizationId = readFlag(args, 'org', 'organizationId')
    // Fail closed, exactly as `demo` does: a report that guesses its scope
    // reads someone else's data.
    if (!tenantId || !organizationId) {
      fail('Both --tenant and --org are required; neither is inferred.', ORIGINS_USAGE)
    }

    const page = Number(readFlag(args, 'page') ?? '1')
    const pageSize = Number(readFlag(args, 'page-size', 'pageSize') ?? '20')
    if (!Number.isInteger(page) || page < 1) fail('--page must be a positive integer.', ORIGINS_USAGE)
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      fail('--page-size must be an integer between 1 and 100.', ORIGINS_USAGE)
    }

    const container = (await createRequestContainer()) as unknown as AwilixContainer
    const em = (container.resolve('em') as EntityManager).fork()

    const result = await listOfferOrigins(em, { tenantId: tenantId!, organizationId: organizationId! }, page, pageSize)

    if (result.items.length === 0) {
      console.log('No draft_offer actions in this organization yet.')
      console.log(`Seed one with: yarn mercato offer_automation demo --tenant ${tenantId} --org ${organizationId}`)
      return
    }

    console.log(`draft_offer actions, page ${result.page} (page size ${result.pageSize}):`)
    for (const row of result.items) {
      console.log('')
      console.log(`  status:     ${row.actionStatus}${row.executedAt ? ` at ${row.executedAt}` : ''}`)
      console.log(`  request:    ${row.proposalSummary ?? '<no summary>'}`)
      console.log(`              ${baseUrl()}${row.proposalHref}`)
      console.log(`  quote:      ${row.quoteNumber ?? '<none>'}`)
      console.log(`              ${row.quoteHref ? `${baseUrl()}${row.quoteHref}` : '<none>'}`)
      console.log(`  linksBack:  ${row.quoteLinksBack}`)
    }
    console.log('')
    if (result.hasNextPage) console.log(`More rows on page ${result.page + 1}.`)
  },
}

const SEED_CATALOG_USAGE = [
  'Usage:',
  '  yarn mercato offer_automation seed-catalog --tenant <tenantId> --org <organizationId> [--user <userId>]',
  '',
  'Creates the four transport services this app sells, each with one variant and',
  `one net list price in ${FREIGHT_CURRENCY}, through core's catalogue commands.`,
  'Idempotent: a second run finds every row by SKU and creates nothing.',
  '',
  'Services:',
  ...FREIGHT_SERVICES.map(
    (service) =>
      `  ${service.sku.padEnd(18)} ${service.unitPriceNet.padStart(8)} ${FREIGHT_CURRENCY} per ${service.unitLabel}`,
  ),
  '',
  '`demo` runs this itself, so seeding separately is only useful when you want the',
  'catalogue without an inbound request.',
].join('\n')

/**
 * The catalogue half of the demo, on its own command.
 *
 * Split out of `demo` so the seed can be re-run, inspected and counted without
 * creating another inbox proposal, and so `demo` stays readable.
 */
const seedCatalog: ModuleCli = {
  command: 'seed-catalog',
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(SEED_CATALOG_USAGE)
      return
    }

    const tenantId = readFlag(args, 'tenant', 'tenantId')
    const organizationId = readFlag(args, 'org', 'organizationId')
    if (!tenantId || !organizationId) {
      fail('Both --tenant and --org are required; neither is inferred.', SEED_CATALOG_USAGE)
    }

    const container = (await createRequestContainer()) as unknown as AwilixContainer
    const em = (container.resolve('em') as EntityManager).fork()

    // Same cross-tenant refusal `demo` makes: an organization is only seeded by
    // the tenant that owns it.
    const organization = await em.findOne(Organization, {
      id: organizationId,
      deletedAt: null,
    } as never)
    if (!organization) fail(`Organization ${organizationId} not found (or soft-deleted).`)
    const ownerTenantId = (organization as unknown as { tenant?: { id?: string } }).tenant?.id
    if (ownerTenantId !== tenantId) {
      fail(
        `Organization ${organizationId} belongs to tenant ${ownerTenantId ?? '<unknown>'}, not ${tenantId}. Refusing to seed across tenants.`,
      )
    }

    const actorUserId = await resolveSeedActorUserId(
      em,
      { tenantId: tenantId!, organizationId: organizationId! },
      readFlag(args, 'user', 'userId'),
    )

    const catalog = await seedFreightServices(container, {
      tenantId: tenantId!,
      organizationId: organizationId!,
      actorUserId,
    })

    console.log('')
    printCatalogSummary(catalog)
    console.log('')
    console.log(`Catalogue: ${baseUrl()}/backend/catalog/products`)
    console.log('')
  },
}

const SEED_DEMO_USAGE = [
  'Usage:',
  '  yarn mercato offer_automation seed-demo',
  '  yarn mercato offer_automation seed-demo --reset',
  '  yarn mercato offer_automation seed-demo --password "S3cret!"',
  '  yarn mercato offer_automation seed-demo --org-slug throwaway-freight --admin-email admin@throwaway.example',
  '',
  `Builds the company and stops: the ${DEMO_COMPANY_NAME} tenant and`,
  'organization, its roles and feature grants, an admin, a sales employee and the',
  'automation account, EUR, the sales prerequisites, the freight catalogue and',
  'three freight customers with contacts.',
  '',
  'IT CREATES NO ACTIVITY. No inbound email, no message thread, no proposal, no',
  'action, no quote and no notification. The first enquiry in the system is the',
  'one you send yourself:  yarn mercato offer_automation send-email',
  '',
  'Idempotent. Every step creates what is missing and skips what exists, and no',
  'other tenant is touched. Without --reset nothing is ever deleted.',
  '',
  'Flags:',
  '  --reset                 Delete this organization\'s ACTIVITY first, as step',
  '                          0/8: inbound emails, the message thread, proposals,',
  '                          actions, drafted quotes and notifications. The',
  '                          company survives. Tenant, organization, roles,',
  '                          users, the automation account, feature grants,',
  '                          currencies, sales statuses, the sales channel, the',
  '                          freight catalogue and the three freight customers',
  '                          are all left exactly as they are, and the seed then',
  '                          runs unchanged. Scoped to the --org-slug tenant AND',
  '                          organization; refuses if either cannot be resolved.',
  '                          Off by default.',
  '  --password <value>      Password for both seeded users.',
  '  --admin-password <value>  Overrides --password for the admin.',
  '  --sales-password <value>  Overrides --password for the sales employee.',
  '  --admin-email <addr>    Defaults to ' + DEMO_ADMIN_EMAIL + '.',
  '  --sales-email <addr>    Defaults to ' + DEMO_SALES_EMAIL + '.',
  `  --org-slug <slug>       Defaults to ${DEMO_ORG_SLUG}. The slug is the identity`,
  '                          this seed is idempotent on, so another value seeds a',
  '                          SECOND, throwaway company beside the first instead of',
  '                          reusing it. `send-email` with no arguments only finds',
  '                          the default slug; the closing block prints the exact',
  '                          command for whichever slug you used.',
  `  --org-name <name>       Display name. Defaults to ${DEMO_COMPANY_NAME}.`,
  '',
  '`--skip-demo` is gone. It used to stop the seed before the demo chain; the',
  'chain is gone, so there is nothing left to skip.',
  '',
  'Environment: OM_DEMO_PASSWORD, OM_DEMO_ADMIN_PASSWORD, OM_DEMO_SALES_PASSWORD.',
  `Default password when nothing is supplied: ${DEFAULT_DEMO_PASSWORD} (dev-only seed data).`,
].join('\n')

/**
 * Core seed commands this run delegates to, in order.
 *
 * They are invoked through the CLI registry rather than reimplemented, so the
 * demo tenant gets exactly the configuration a `mercato init` tenant gets.
 *
 * DELIBERATELY ABSENT: `catalog seed-examples`, `sales seed-examples` and
 * `customers seed-examples`. Each imports the fashion demo's own products,
 * quotes and customers, which would put dresses and sneakers next to freight
 * services on every screen this demo is meant to show. The freight catalogue
 * and the freight customers below replace them.
 */
const CORE_SEED_STEPS: ReadonlyArray<{ module: string; command: string; scope: 'tenant' | 'org' }> = [
  { module: 'currencies', command: 'seed', scope: 'org' },
  { module: 'catalog', command: 'seed-units', scope: 'org' },
  { module: 'catalog', command: 'seed-price-kinds', scope: 'org' },
  // Prerequisite #1. `executeDraftOffer` resolves the `draft` entry of
  // `sales.order_status`; without this the quote has no initial status.
  { module: 'sales', command: 'seed-statuses', scope: 'org' },
  { module: 'sales', command: 'seed-tax-rates', scope: 'org' },
  { module: 'sales', command: 'seed-adjustment-kinds', scope: 'org' },
  { module: 'sales', command: 'seed-shipping-methods', scope: 'org' },
  { module: 'sales', command: 'seed-payment-methods', scope: 'org' },
  { module: 'customers', command: 'seed-dictionaries', scope: 'org' },
]

/**
 * Runs one command from another module's CLI, in this process.
 *
 * `getCliModules()` is the registry the `mercato` bin populates before it
 * dispatches, so this is the same lookup the bin performs for a command the
 * operator types. Calling it here means the seed composes core's commands
 * instead of duplicating their SQL.
 */
async function runModuleCli(moduleId: string, command: string, rest: string[]): Promise<void> {
  const modules = getCliModules()
  if (modules.length === 0) {
    fail(
      'No CLI modules are registered; run this through `yarn mercato`, not directly.',
      'If you did, run `yarn generate` first.',
    )
  }
  const mod = modules.find((entry) => entry.id === moduleId)
  const found = mod?.cli?.find((entry) => entry.command === command)
  if (!found) {
    fail(
      `Core command \`${moduleId} ${command}\` is not registered in this app.`,
      'The installed module set changed; update CORE_SEED_STEPS in',
      'src/modules/offer_automation/cli.ts to match.',
    )
  }
  console.log(`  -> mercato ${moduleId} ${command} ${rest.join(' ')}`)
  await found.run(rest)
}

function resolvePassword(args: Args, specific: string[], envKeys: string[]): string {
  const flag = readFlag(args, ...specific, 'password')
  if (flag) return flag
  for (const key of [...envKeys, 'OM_DEMO_PASSWORD']) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return DEFAULT_DEMO_PASSWORD
}

/**
 * One line for the machine account, in the same columns as the humans.
 *
 * The features column stands where a role would, because the account holds no
 * role at all. Its password is not printed and could not be: see
 * `mintUnknowablePassword` in `lib/automationUser.ts`.
 */
function printAutomationUser(user: AutomationUser): void {
  console.log(
    `  ${user.email.padEnd(34)} ${'<no login>'.padEnd(14)} ${user.userId}  ${
      user.created ? 'created' : 'already present'
    }  features ${user.features.join(',')}`,
  )
}

/**
 * The seeded humans, without their credential.
 *
 * NO PASSWORD COLUMN, deliberately. The caller supplied the password or took
 * the documented default, so echoing it back teaches nobody anything and puts
 * a working login into shell history and into every pasted log.
 */
function printUserTable(users: DemoUser[]): void {
  for (const user of users) {
    const state = user.created ? 'created' : 'already present'
    console.log(
      `  ${user.email.padEnd(34)} ${user.roles.join(',').padEnd(14)} ${user.userId}  ${state}`,
    )
  }
}

/**
 * One command that rebuilds the entire demo.
 *
 * Order matters in three places and nowhere else:
 *  1. the tenant comes first, because everything is scoped to it;
 *  2. the sales employee is created before role ACLs are synced and before the
 *     demo runs, because the messages leg needs a user holding
 *     `inbox_ops.proposals.view` and the acceptance needs one holding
 *     `offer_automation.offers.draft`;
 *  3. the CRM customers are seeded before the enquiry, because the enquiry is
 *     sent FROM one of their contacts and that is what links the quote to a
 *     real customer record.
 */
const seedDemo: ModuleCli = {
  command: 'seed-demo',
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(SEED_DEMO_USAGE)
      return
    }

    const orgSlug = readFlag(args, 'org-slug', 'orgSlug') ?? DEMO_ORG_SLUG
    const orgName = readFlag(args, 'org-name', 'orgName') ?? DEMO_COMPANY_NAME
    const adminEmail = readFlag(args, 'admin-email', 'adminEmail') ?? DEMO_ADMIN_EMAIL
    const salesEmail = readFlag(args, 'sales-email', 'salesEmail') ?? DEMO_SALES_EMAIL
    const adminPassword = resolvePassword(args, ['admin-password', 'adminPassword'], [
      'OM_DEMO_ADMIN_PASSWORD',
    ])
    const salesPassword = resolvePassword(args, ['sales-password', 'salesPassword'], [
      'OM_DEMO_SALES_PASSWORD',
    ])

    // Checked before anything is written. A rejected password half-way through
    // would leave a company nobody can log into.
    try {
      assertPasswordAcceptable('--admin-password', adminPassword)
      assertPasswordAcceptable('--sales-password', salesPassword)
    } catch (err) {
      fail((err as Error).message, SEED_DEMO_USAGE)
    }

    const container = (await createRequestContainer()) as unknown as AwilixContainer

    // Step zero, and the only destructive thing this command can do. Opt-in,
    // off by default, and it runs BEFORE the tenant step so the seed that
    // follows is the same create-if-missing run it always was. The scope comes
    // from the slug the seed is idempotent on, never from a flag pair the
    // operator typed, and `runDemoReset` refuses in a production-like
    // environment through the same guard the seed's writes use.
    if (isDemoResetRequested(args)) {
      console.log('')
      console.log(`0/8  Reset (org ${orgSlug})`)
      const resetEm = (container.resolve('em') as EntityManager).fork()
      let target: Awaited<ReturnType<typeof resolveDemoResetScope>>
      try {
        target = await resolveDemoResetScope(resetEm, orgSlug)
      } catch (err) {
        fail((err as Error).message, 'Name the company to reset with --org-slug <slug>.')
      }
      if (!target) {
        // The ordinary first run: no company, so no activity. Nothing is
        // deleted and the seed below builds it.
        console.log(`  no organization with slug "${orgSlug}"; nothing to delete`)
      } else {
        const reset = await runDemoReset(container, target)
        for (const line of formatDemoResetLines(reset)) console.log(line)
      }
    }

    console.log('')
    console.log(`1/8  Tenant and organization ("${orgName}", slug ${orgSlug})`)
    const tenant = await ensureDemoTenant(container, { adminEmail, adminPassword, orgSlug, orgName })
    const scopeIds = { tenantId: tenant.tenantId, organizationId: tenant.organizationId }
    console.log(`  tenantId       ${tenant.tenantId}`)
    console.log(`  organizationId ${tenant.organizationId}`)
    console.log(`  ${tenant.created ? 'created by this run' : 'already present; reused'}`)

    console.log('')
    console.log('2/8  Roles and users')
    console.log(`  ${'email'.padEnd(34)} ${'access'.padEnd(14)} userId`)
    await runModuleCli('auth', 'seed-roles', ['--tenant', tenant.tenantId])
    const users = await ensureDemoUsers(
      container,
      scopeIds,
      { admin: adminPassword, sales: salesPassword },
      { admin: adminEmail, sales: salesEmail },
      tenant.created,
    )
    printUserTable(users)
    const adminUser = users.find((user) => user.email === adminEmail)!
    const salesUser = users.find((user) => user.email === salesEmail)!
    const scope = { ...scopeIds, actorUserId: adminUser.userId }
    // The account `send-email` hands the drafting to. Created here so the
    // subscriber never has to invent an actor, and granted exactly one feature
    // so the RBAC gate still means something.
    const automationUser = await ensureAutomationUser(container, scope)
    printAutomationUser(automationUser)

    console.log('')
    console.log('3/8  Core seeds (currency, catalogue basics, sales prerequisites, CRM dictionaries)')
    for (const step of CORE_SEED_STEPS) {
      const stepArgs =
        step.scope === 'tenant'
          ? ['--tenant', tenant.tenantId]
          : ['--tenant', tenant.tenantId, '--org', tenant.organizationId]
      await runModuleCli(step.module, step.command, stepArgs)
    }

    console.log('')
    console.log('4/8  Feature grants')
    await runModuleCli('auth', 'sync-role-acls', ['--tenant', tenant.tenantId])
    console.log(`  employee role now holds ${DRAFT_OFFER_REQUIRED_FEATURE} and ${MESSAGE_AUDIENCE_FEATURE}`)

    console.log('')
    console.log('5/8  Sales channel')
    const channel = await ensureSalesChannel(container, scope)
    console.log(
      `  ${channel.name} (${channel.channelId}) ${channel.created ? 'created' : 'already present'}`,
    )

    console.log('')
    console.log('6/8  Freight catalogue')
    const catalog = await seedFreightServices(container, scope)
    printCatalogSummary(catalog)

    console.log('')
    console.log('7/8  Freight customers')
    const customers = await seedDemoCustomers(container, scope)
    for (const row of customers.rows) {
      const what = [row.created.company ? 'company' : null, row.created.contact ? 'contact' : null]
        .filter(Boolean)
        .join(' + ')
      console.log(`  ${row.companyName.padEnd(26)} ${row.contactEmail.padEnd(40)} ${what ? `created ${what}` : 'already present'}`)
      // The contact's entity id is printed because it is the value an accepted
      // quote's `customer_entity_id` must equal. Without it that link can only
      // be checked by decrypting the CRM row by hand.
      console.log(`  ${''.padEnd(26)} contact entity ${row.contactEntityId}  company entity ${row.companyEntityId}`)
    }
    console.log(`  ${customers.createdCount} row(s) created by this run.`)

    console.log('')
    console.log('8/8  Inbound mailbox')
    // The address `send-email` posts to. It is what picks this tenant inside
    // core's webhook, so without this row the webhook answers 200 and silently
    // drops the email.
    const inbox = await ensureDemoInbox(container, scopeIds)
    console.log(`  ${inbox.inboxAddress.padEnd(40)} ${inbox.state}`)
    if (inbox.previousAddress) {
      console.log(`  ${''.padEnd(40)} was ${inbox.previousAddress}, written by core's inbox_ops setup hook`)
    }
    console.log(`  ${''.padEnd(40)} settings row ${inbox.settingsId}, signed with ${WEBHOOK_SECRET_ENV}`)

    // Both prerequisites are verified in the new tenant before the run can
    // report success. Either one missing turns the accepted offer into a
    // failure the operator would otherwise only meet in the browser.
    const em = (container.resolve('em') as EntityManager).fork()
    const { resolveStatusEntryIdByValue } = await import(
      '@open-mercato/core/modules/sales/lib/statusHelpers'
    )
    const draftStatusEntryId = await resolveStatusEntryIdByValue(em, {
      tenantId: tenant.tenantId,
      organizationId: tenant.organizationId,
      value: 'draft',
    })
    const channelActive = await hasActiveSalesChannel(container, scopeIds)
    console.log('')
    console.log('Prerequisite check:')
    console.log(`  sales.order_status "draft"   ${draftStatusEntryId ?? '<MISSING>'}`)
    console.log(`  active sales channel         ${channelActive ? 'yes' : '<MISSING>'}`)
    if (!draftStatusEntryId) {
      fail(
        'The `draft` entry of `sales.order_status` is missing; an accepted offer would have no status.',
        `Re-run: yarn mercato sales seed-statuses --tenant ${tenant.tenantId} --org ${tenant.organizationId}`,
      )
    }
    if (!channelActive) {
      fail(
        'No active sales channel in this organization; `executeDraftOffer` refuses without one.',
        'Activate one under Sales > Channels and re-run.',
      )
    }

    // Where the demo chain used to run. It is deliberately gone: the seed now
    // leaves the organization empty of activity, so the first inbound email in
    // the system is one an operator sent on purpose with `send-email`.
    const contact = primaryDemoContact()
    for (const line of buildSeedClosingLines({
      companyName: orgName,
      orgSlug,
      slugIsDefault: orgSlug === DEMO_ORG_SLUG,
      tenantId: tenant.tenantId,
      organizationId: tenant.organizationId,
      baseUrl: baseUrl(),
      inboxAddress: inbox.inboxAddress,
      users: [
        ...users.map((user) => ({
          email: user.email,
          roles: user.roles,
          userId: user.userId,
          created: user.created,
          canLogIn: true,
        })),
        {
          email: automationUser.email,
          roles: [],
          userId: automationUser.userId,
          created: automationUser.created,
          features: automationUser.features,
          canLogIn: false,
        },
      ],
      salesUserId: salesUser.userId,
      demoContact: {
        email: contact.contact.primaryEmail,
        companyName: contact.company.displayName,
        personName: `${contact.contact.firstName} ${contact.contact.lastName}`,
      },
    })) {
      console.log(line)
    }
  },
}

const CHECK_AI_USAGE = [
  'Usage:',
  '  yarn mercato offer_automation check-ai',
  '  yarn mercato offer_automation check-ai --no-call',
  '',
  'Answers one question: will `demo --live` reach a model? Reports the provider,',
  'the model and whether the API key env var is set, then makes one small real',
  'call through the same code path core\'s extraction uses.',
  '',
  'No key, token or secret is ever printed. Presence only, and provider error',
  'messages are scrubbed before they are shown.',
  '',
  'Flags:',
  '  --no-call   Report the configuration and stop. Makes no API call and costs',
  '              nothing, but proves only that the settings exist.',
  '  --timeout <ms>  How long the call may take. Default 30000.',
].join('\n')

function printAiConfiguration(description: AiProviderDescription): void {
  console.log('Model configuration:')
  console.log(`  provider:      ${description.providerId} (${description.providerName})`)
  console.log(`  model:         ${description.modelWithProvider ?? '<could not resolve>'}`)
  console.log(`  api key env:   ${description.apiKeyEnvVar}`)
  console.log(`  api key set:   ${description.apiKeyPresent ? 'yes' : 'NO'}`)
  if (description.configurationError) {
    console.log(`  error:         ${description.configurationError}`)
  }
}

/**
 * The pre-flight an operator runs before demoing the live path.
 *
 * Exists because the failure it catches is the one that ruins a demo: a key
 * that is missing, expired or out of quota looks exactly like a working setup
 * until the model is called. Thirty seconds here beats finding out on stage.
 */
const checkAi: ModuleCli = {
  command: 'check-ai',
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(CHECK_AI_USAGE)
      return
    }

    const skipCall = readBoolean(args, 'no-call', 'noCall', 'offline')
    const timeoutMs = Number(readFlag(args, 'timeout') ?? '30000')
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
      fail('--timeout must be an integer of at least 1000 (milliseconds).', CHECK_AI_USAGE)
    }

    console.log('')
    const description = await describeAiProvider()
    printAiConfiguration(description)
    console.log('')

    if (skipCall) {
      console.log('No call made (--no-call). Re-run without the flag to test reachability.')
      console.log('')
      if (!description.apiKeyPresent || description.configurationError) {
        fail('The model path is NOT configured; `demo --live` would fail.')
      }
      return
    }

    // Two questions, asked separately on purpose. "Is the model reachable?" and
    // "does this provider accept core's extraction schema?" have different
    // answers on this install, and an operator who cannot see which is which
    // will go hunting for a key problem that does not exist.
    console.log('1/2  Is the model reachable? (strict-safe schema, the `app` live mode)')
    const reach = await probeAiProvider(timeoutMs)
    if (reach.ok) {
      console.log(`     OK. ${reach.modelWithProvider}, ${reach.tokensUsed} tokens, ${(reach.elapsedMs / 1000).toFixed(1)}s`)
    } else {
      console.log(`     FAILED (${reach.failure})`)
      console.log(`     provider said: ${reach.detail}`)
      console.log(`     fix:           ${reach.hint}`)
    }

    console.log('')
    console.log("2/2  Does this provider accept core's extraction schema? (route A, --live-mode core)")
    const routeA = await probeCoreExtractionSchema(timeoutMs)
    if (routeA.ok) {
      console.log(`     OK. ${routeA.modelWithProvider}, ${routeA.tokensUsed} tokens, ${(routeA.elapsedMs / 1000).toFixed(1)}s`)
    } else {
      console.log(`     FAILED (${routeA.failure})`)
      console.log(`     provider said: ${routeA.detail}`)
      console.log(`     fix:           ${routeA.hint}`)
    }

    console.log('')
    if (!reach.ok) {
      console.log('No live path is usable. Demo the stub instead: drop --live.')
      console.log('')
      fail(`Model is NOT reachable (${reach.failure}); every \`demo --live\` mode would fail.`)
    }

    if (routeA.ok) {
      console.log('Both paths work. Prefer route A, which is core\'s own extraction:')
      console.log('  yarn mercato offer_automation demo --tenant <t> --org <o> \\')
      console.log('    --live --live-mode core --auto-accept --user <salesUserId>')
    } else {
      console.log('The model works; core\'s extraction schema does not. Use the app mode:')
      console.log('  yarn mercato offer_automation demo --tenant <t> --org <o> \\')
      console.log('    --live --auto-accept --user <salesUserId>')
    }
    console.log('')
  },
}

const SEND_EMAIL_USAGE = [
  'Usage:',
  '  yarn mercato offer_automation send-email',
  '  yarn mercato offer_automation send-email --tenant <tenantId> --org <organizationId>',
  '  yarn mercato offer_automation send-email --from marta.nowak@nordwind-spedition.example',
  '  yarn mercato offer_automation send-email --subject "Quote please" --body "3 pallets Poznan to Hamburg, no dock."',
  '  yarn mercato offer_automation send-email --body-file ./enquiry.txt',
  '',
  'Delivers ONE inbound customer email and stops. It signs a JSON payload and',
  `POSTs it to ${INBOUND_WEBHOOK_PATH} — the same endpoint a real`,
  'mail provider calls. CORE does the rest: it parses the email, deduplicates it,',
  'writes the `inbox_emails` row and emits the persistent',
  '`inbox_ops.email.received` event. This command creates no proposal, executes no',
  'action and takes no --user.',
  '',
  'It therefore needs two things the offline `demo` command does not:',
  `  - a running server at ${'${APP_URL}'} (default http://localhost:3000), and`,
  `  - ${WEBHOOK_SECRET_ENV} set in .env, which is the HMAC key it signs with.`,
  '    The SERVER reads the same variable, so add it once and restart `yarn dev`.',
  '',
  'The recipient address is the organization\'s configured inbox, written by',
  '`seed-demo`. That address is what picks the tenant inside core: nothing in the',
  'payload can override it.',
  '',
  'What reacts, in order:',
  '  1. an events worker picks the job up (`yarn dev` spawns one automatically),',
  '  2. extraction turns the email into a proposal with a `draft_offer` action,',
  '  3. `offer_automation:draft-offer-executor` runs that action as the automation',
  '     user, which creates the priced draft quote,',
  '  4. everyone holding sales.quotes.view gets a notification naming the quote.',
  '',
  '`demo` is the other command and the deterministic one: it can stub the',
  'extraction, needs no model and no worker, and accepts the action itself with',
  '--auto-accept. It also writes the inbox email itself instead of POSTing it, so',
  'it needs no server and no webhook secret. Use `demo` when any of those is',
  'missing; use `send-email` to show the system reacting on its own.',
  '',
  'Flags:',
  '  --tenant <uuid>   Defaults to the tenant of the seeded logistics company.',
  `  --org <uuid>      Defaults to the "${DEMO_ORG_SLUG}" organization when exactly`,
  '                    one exists. Both are required together when given.',
  '  --from <addr>     Sender. Defaults to the seeded CRM contact, so the quote',
  '                    links to a real customer record. `--customer-email` is',
  '                    accepted as an alias; `--from` is the canonical spelling',
  '                    and `demo` takes it too. An address no CRM customer owns',
  '                    is fine: the quote is still created and carries a customer',
  '                    snapshot instead of a link. The command says which of the',
  '                    two happened.',
  '  --customer-name <name>   Company the sender writes for.',
  '  --contact-name <name>    Person who signs the email.',
  '  --subject <text>  Subject line. Defaults to the built-in enquiry subject.',
  '  --body <text>     The WHOLE email body, written by you. It REPLACES the',
  '                    built-in enquiry rather than being added to it, so the',
  '                    extraction reads only your job. Ask for something the four',
  '                    seeded services cannot cover and the action ends `failed`',
  '                    with no quote, which is the refusal path. It also makes the',
  '                    email unique, which matters: core deduplicates on subject +',
  '                    sender + body, per organization, with no time window, so the',
  '                    built-in enquiry can only be delivered here once.',
  '  --body-file <path>  The same, read from a file, so a long multi-paragraph',
  '                    email does not have to survive shell quoting. Mutually',
  '                    exclusive with --body.',
  `                    Either way the body is capped at ${MAX_BODY_CHARS} characters,`,
  '                    because it is pasted whole into the extraction prompt.',
  '  --note <text>     One more sentence from the customer, appended to the body.',
  '                    Use it to demonstrate the refusal path: --note "Please',
  '                    quote in USD." makes the extraction ask for a currency the',
  '                    catalogue has no price in, the action ends `failed`, NO',
  '                    quote is created and an error notification goes to the',
  '                    desk waiting for the quote.',
  '  --no-watch        Deliver and exit. By default the command watches the rows',
  '                    the subscribers write and prints them; the watch is',
  '                    READ-ONLY and changes nothing.',
  '  --watch-timeout <ms>  How long to watch. Default 60000.',
  '  --replay <inboxEmailId>      Re-emit `inbox_ops.email.received` for an email',
  '                    that already exists. Writes NOTHING. This is how the',
  '                    handoff is proven idempotent: a redelivered job must not',
  '                    produce a second proposal or a second quote.',
  '  --replay-proposal <proposalId>  Same, for `inbox_ops.proposal.created`, which',
  '                    is the event the executor listens to.',
].join('\n')

/**
 * Message-ID prefix for emails this command sends.
 *
 * It is also how the command finds the row afterwards. Core's webhook answers
 * `200 {"ok":true}` whether it stored the email or dropped it, and it assigns
 * the row id itself, so the message id we put in the payload is the only handle
 * we keep on the other side of the POST.
 */
const SENT_MESSAGE_ID_PREFIX = '<offer-automation-send-'

/** How long to wait for the row core writes, after a 200. */
const WEBHOOK_ROW_TIMEOUT_MS = 5000

/**
 * Waits for the row core's webhook writes, found by the message id we sent.
 *
 * Forked and cleared on every read because the row is written by ANOTHER
 * process (the dev server), so a cached identity map would keep reporting the
 * first miss. `message_id` is one of the columns core deliberately leaves
 * unencrypted, so it can be used in a WHERE clause.
 *
 * Returns null when the window closes with nothing stored. That is not an
 * error by itself: it is the input to `decideWebhookOutcome`.
 */
async function awaitStoredEmail(
  container: AwilixContainer,
  messageId: string,
  scope: { tenantId: string; organizationId: string },
  timeoutMs: number,
): Promise<string | null> {
  const startedAt = Date.now()
  for (;;) {
    const em = (container.resolve('em') as EntityManager).fork({ clear: true })
    const row = (await em.findOne(InboxEmail, {
      messageId,
      ...scope,
      deletedAt: null,
    } as never)) as { id: string } | null
    if (row) return row.id
    if (Date.now() - startedAt >= timeoutMs) return null
    await sleep(POLL_INTERVAL_MS)
  }
}

/**
 * The email core already held under this content hash, if any.
 *
 * `content_hash` is unencrypted for exactly this reason: it is core's own
 * deduplication key, matched per tenant and organization with no time window.
 */
async function findEmailIdByContentHash(
  em: EntityManager,
  contentHash: string,
  scope: { tenantId: string; organizationId: string },
): Promise<string | null> {
  const row = (await em.findOne(InboxEmail, {
    contentHash,
    ...scope,
    deletedAt: null,
  } as never)) as { id: string } | null
  return row?.id ?? null
}

/**
 * Core's stored email, decrypted, in the shape the messages leg needs.
 *
 * Subject and body are encrypted at rest, so a plain find would hand the
 * message record ciphertext. Read through core's own decrypting helper instead.
 */
async function readStoredEmail(
  container: AwilixContainer,
  inboxEmailId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<SeededEmailForMessage | null> {
  const em = (container.resolve('em') as EntityManager).fork({ clear: true })
  const row = (await findOneWithDecryption(
    em,
    InboxEmail,
    { id: inboxEmailId, ...scope } as never,
    undefined,
    scope,
  )) as {
    id: string
    subject?: string | null
    cleanedText?: string | null
    rawText?: string | null
    forwardedByAddress?: string | null
    forwardedByName?: string | null
    status?: string | null
  } | null
  if (!row) return null
  return {
    id: row.id,
    subject: row.subject ?? '(no subject)',
    cleanedText: row.cleanedText ?? null,
    rawText: row.rawText ?? null,
    forwardedByAddress: row.forwardedByAddress ?? '',
    forwardedByName: row.forwardedByName ?? null,
    status: row.status ?? 'received',
  }
}

/**
 * Reads what the subscribers have written so far. Writes nothing, ever.
 *
 * Forks and clears on every call because the rows are produced by ANOTHER
 * process (the events worker), so a cached identity map would keep reporting
 * the first state it saw.
 */
async function readWatchState(
  container: AwilixContainer,
  emailId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<WatchState> {
  const em = (container.resolve('em') as EntityManager).fork({ clear: true })

  const email = (await em.findOne(InboxEmail, { id: emailId } as never)) as {
    status?: string
    processingError?: string | null
  } | null

  const proposal = (await em.findOne(
    InboxProposal,
    { inboxEmailId: emailId, isActive: true, ...scope } as never,
    { orderBy: { createdAt: 'DESC' } } as never,
  )) as { id: string } | null

  const action = proposal
    ? ((await em.findOne(
        InboxProposalAction,
        { proposalId: proposal.id, actionType: DRAFT_OFFER_ACTION_TYPE } as never,
        { orderBy: { sortOrder: 'ASC' } } as never,
      )) as {
        id: string
        status?: string
        executionError?: string | null
        createdEntityId?: string | null
        executedByUserId?: string | null
      } | null)
    : null

  const quoteId = action?.createdEntityId ?? null
  const quote = quoteId
    ? ((await em.findOne(SalesQuote, { id: quoteId } as never)) as {
        quoteNumber?: string
        grandTotalNetAmount?: string
        currencyCode?: string
        customerEntityId?: string | null
      } | null)
    : null

  // Read-only count of the bells this flow rang, so the operator can see the
  // notification exists without opening the UI.
  const notificationCount = quoteId
    ? await em.count(Notification, {
        sourceEntityType: 'sales:quote',
        sourceEntityId: quoteId,
        tenantId: scope.tenantId,
      } as never)
    : proposal
      ? await em.count(Notification, {
          sourceEntityType: 'inbox_ops:proposal',
          sourceEntityId: proposal.id,
          tenantId: scope.tenantId,
        } as never)
      : 0

  return {
    proposalId: proposal?.id ?? null,
    actionId: action?.id ?? null,
    actionStatus: action?.status ?? null,
    executionError: action?.executionError ?? null,
    emailStatus: email?.status ?? '<email missing>',
    processingError: email?.processingError ?? null,
    quoteId,
    quoteNumber: quote?.quoteNumber ?? null,
    quoteTotal: quote?.grandTotalNetAmount ?? null,
    quoteCurrency: quote?.currencyCode ?? null,
    customerEntityId: quote?.customerEntityId ?? null,
    executedByUserId: action?.executedByUserId ?? null,
    notificationCount,
  }
}

/**
 * Re-delivers one event for artefacts that already exist.
 *
 * Reads the row first so the payload is the real one rather than something
 * retyped by hand: a replay that carried a different payload would prove
 * nothing about the handler's idempotency.
 */
async function replayEvent(
  container: AwilixContainer,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  input: { replayEmailId: string | null; replayProposalId: string | null },
): Promise<void> {
  if (input.replayEmailId) {
    const email = (await em.findOne(InboxEmail, {
      id: input.replayEmailId,
      ...scope,
    } as never)) as {
      id: string
      subject?: string | null
      forwardedByAddress: string
      status?: string
    } | null
    if (!email) fail(`Inbox email ${input.replayEmailId} not found in this scope.`)

    await emitInboxOpsEvent(
      'inbox_ops.email.received',
      {
        emailId: email!.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        forwardedByAddress: email!.forwardedByAddress,
        subject: email!.subject ?? '',
      },
      { persistent: true, ...scope },
    )
    console.log('')
    console.log('Re-emitted inbox_ops.email.received for an email that already exists.')
    console.log(`  inboxEmailId:    ${email!.id}`)
    console.log(`  emailStatus:     ${email!.status ?? '<unknown>'}`)
    console.log('Nothing was written by this command. Every extractor claims the email with')
    console.log('one conditional UPDATE, so an email that is no longer `received` is left')
    console.log('alone: expect no new proposal and no new quote.')
    console.log('')
    return
  }

  const proposal = (await em.findOne(InboxProposal, {
    id: input.replayProposalId!,
    ...scope,
  } as never)) as { id: string; inboxEmailId?: string; summary?: string | null } | null
  if (!proposal) fail(`Proposal ${input.replayProposalId} not found in this scope.`)

  await emitInboxOpsEvent(
    'inbox_ops.proposal.created',
    {
      proposalId: proposal!.id,
      emailId: proposal!.inboxEmailId ?? '',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      actionCount: 1,
      discrepancyCount: 0,
      confidence: '0.90',
      summary: proposal!.summary ?? '',
    },
    { persistent: true, ...scope },
  )
  console.log('')
  console.log('Re-emitted inbox_ops.proposal.created for a proposal that already exists.')
  console.log(`  proposalId:      ${proposal!.id}`)
  console.log('Nothing was written by this command. The executor only runs actions whose')
  console.log('status is still `pending`, and core\'s engine claims even those with one')
  console.log('conditional UPDATE: expect no second quote.')
  console.log('')
}

/**
 * One command that starts the whole chain and then gets out of the way.
 *
 * It deliberately does NOT execute the action, create the quote or take a
 * `--user`. If this command could do any of that, the demo would prove nothing:
 * the point is that a quote appears because the system reacted to an event, not
 * because a flag told it to.
 */
const sendEmail: ModuleCli = {
  command: 'send-email',
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(SEND_EMAIL_USAGE)
      return
    }

    const tenantFlag = readFlag(args, 'tenant', 'tenantId')
    const orgFlag = readFlag(args, 'org', 'organizationId')
    if (Boolean(tenantFlag) !== Boolean(orgFlag)) {
      fail('--tenant and --org are given together or not at all.', SEND_EMAIL_USAGE)
    }
    const replayEmailId = readFlag(args, 'replay', 'replay-email', 'replayEmail')
    const replayProposalId = readFlag(args, 'replay-proposal', 'replayProposal')
    if (replayEmailId && replayProposalId) {
      fail('Give --replay or --replay-proposal, not both.', SEND_EMAIL_USAGE)
    }
    const watch = !readBoolean(args, 'no-watch', 'noWatch')
    const watchTimeoutMs = Number(readFlag(args, 'watch-timeout', 'watchTimeout') ?? '60000')
    if (!Number.isInteger(watchTimeoutMs) || watchTimeoutMs < 1000) {
      fail('--watch-timeout must be an integer of at least 1000 (milliseconds).', SEND_EMAIL_USAGE)
    }

    // Everything the operator typed is checked before the container is even
    // built. A bad path or an empty body must cost a re-typed command, not a
    // half-seeded chain: past this point an `inbox_emails` row exists and an
    // event is on the queue.
    const overrideResult = resolveEmailOverrides({
      body: args.body,
      bodyFile: args['body-file'] ?? args.bodyFile,
      subject: args.subject,
      from: args.from ?? args['customer-email'] ?? args.customerEmail,
    })
    if (!overrideResult.ok) {
      fail(
        overrideResult.message,
        ...overrideResult.hints,
        '',
        'Nothing was written. Full flag list: send-email --help',
      )
    }
    const overrides: EmailOverrides = overrideResult.overrides

    const container = (await createRequestContainer()) as unknown as AwilixContainer
    const em = (container.resolve('em') as EntityManager).fork()

    let tenantId: string
    let organizationId: string
    if (tenantFlag && orgFlag) {
      const organization = await em.findOne(Organization, {
        id: orgFlag,
        deletedAt: null,
      } as never)
      if (!organization) fail(`Organization ${orgFlag} not found (or soft-deleted).`)
      const ownerTenantId = (organization as unknown as { tenant?: { id?: string } }).tenant?.id
      if (ownerTenantId !== tenantFlag) {
        fail(
          `Organization ${orgFlag} belongs to tenant ${ownerTenantId ?? '<unknown>'}, not ${tenantFlag}. Refusing to send across tenants.`,
        )
      }
      tenantId = tenantFlag
      organizationId = orgFlag
    } else {
      // The convenience path: with one seeded logistics company, the operator
      // types the command with no arguments. Ambiguity refuses rather than
      // picking one, because "whichever organization the database happens to
      // return first" is how a demo writes into the wrong tenant.
      const candidates = (await em.find(Organization, {
        slug: DEMO_ORG_SLUG,
        deletedAt: null,
      } as never)) as unknown as Array<{ id: string; tenant?: { id?: string } }>
      if (candidates.length === 0) {
        fail(
          `No organization with slug "${DEMO_ORG_SLUG}" exists, and no --tenant/--org was given.`,
          'Build the demo company first:  yarn mercato offer_automation seed-demo',
          'Or name the scope explicitly:   --tenant <uuid> --org <uuid>',
        )
      }
      if (candidates.length > 1) {
        fail(
          `${candidates.length} organizations share the slug "${DEMO_ORG_SLUG}"; refusing to guess.`,
          'Name the scope explicitly: --tenant <uuid> --org <uuid>',
        )
      }
      const only = candidates[0]!
      const ownerTenantId = only.tenant?.id
      if (!ownerTenantId) fail(`Organization ${only.id} has no tenant; refusing to guess one.`)
      tenantId = ownerTenantId!
      organizationId = only.id
    }

    const scope = { tenantId, organizationId }

    // Preflight, before anything is written: without this account the executor
    // subscriber refuses to act and the proposal would sit there pending. Said
    // here, once, instead of being discovered in a worker log.
    const automationUserId = await resolveAutomationUserId(em, tenantId)
    if (!automationUserId) {
      fail(
        `No automation user (${AUTOMATION_USER_EMAIL}) in tenant ${tenantId}; the drafted quote would never be created.`,
        'Create it (idempotent, creates nothing else that already exists):',
        '  yarn mercato offer_automation seed-demo',
      )
    }

    // Replay path: emit an event for artefacts that already exist and stop.
    // Nothing is created here, which is the whole point — whatever happens next
    // is the subscribers' own idempotency, or the lack of it.
    if (replayEmailId || replayProposalId) {
      await replayEvent(container, em, scope, { replayEmailId, replayProposalId })
      return
    }

    // Two more preflights, still before anything leaves this process. Both
    // failures are one line to fix and painful to diagnose afterwards: one
    // comes back as a 503 from the server, the other as a 200 that stored
    // nothing.
    const webhookSecret = process.env[WEBHOOK_SECRET_ENV]?.trim()
    if (!webhookSecret) {
      fail(
        `${WEBHOOK_SECRET_ENV} is not set, so this command cannot sign the webhook and the server would answer 503.`,
        'Add one line to .env. Any long random string will do, and the value is',
        'never printed by this command:',
        `  ${WEBHOOK_SECRET_ENV}=<a long random string>`,
        'The SERVER reads the same variable, so restart `yarn dev` after adding it.',
        'Nothing was written.',
      )
    }

    // The address decides the tenant. Core's webhook resolves the recipient to
    // one `inbox_settings` row and takes the tenant and organization off THAT
    // row, ignoring anything else in the payload. So the address is read from
    // the scope this command already validated, never hardcoded: sending to a
    // fixed address would deliver into whichever organization owns it.
    const inbox = await findInboxForScope(em.fork(), scope)
    if (!inbox || !inbox.isActive) {
      fail(
        `No active inbox address is configured for organization ${organizationId}; core's webhook would answer 200 and drop the email.`,
        'The recipient address is what picks the tenant, so it is not optional.',
        'Write it (idempotent, creates nothing else that already exists):',
        '  yarn mercato offer_automation seed-demo',
        `The demo company uses ${DEMO_INBOX_ADDRESS}.`,
        'Nothing was written.',
      )
    }
    const toAddress = inbox!.inboxAddress

    const contact = primaryDemoContact()
    const customerEmail = overrides.from ?? contact.contact.primaryEmail
    // A sender the operator typed gets a name read off their own address. The
    // seeded contact's company is only kept for the seeded contact: an email
    // from a stranger that still says "Nordwind Spedition GmbH" would put a
    // company on the quote snapshot that never wrote in.
    const derived =
      overrides.from && overrides.from !== contact.contact.primaryEmail.toLowerCase()
        ? deriveSenderIdentity(overrides.from)
        : null
    const customerName =
      readFlag(args, 'customer-name', 'customerName') ??
      derived?.customerName ??
      contact.company.displayName
    const contactName =
      readFlag(args, 'contact-name', 'contactName') ??
      derived?.contactName ??
      `${contact.contact.firstName} ${contact.contact.lastName}`

    // `emailId` is this module's proposal only. Core's webhook assigns the row
    // id itself, so the id that ends up in `inbox_emails` is read back below.
    const emailId = randomUUID()
    const seededEmail = buildEnquiryEmail({
      emailId,
      messageIdPrefix: SENT_MESSAGE_ID_PREFIX,
      customerEmail,
      customerName,
      contactName,
      tenantId,
      organizationId,
      toAddress,
      // The status every extractor's optimistic claim looks for. Core sets it
      // itself on this path; it is still passed so the two commands build one
      // email and not two.
      status: 'received',
      seededBy: 'offer_automation send-email',
      extraNote: readFlag(args, 'note'),
      body: overrides.body,
      subject: overrides.subject,
      now: new Date(),
    })

    // Asked before the POST so the answer can be printed next to the sender,
    // which is the only place an operator will connect the two.
    const crmLink = await preflightCrmLink(container, em.fork(), scope, customerEmail)

    // The handoff. This is a real HTTP call to the endpoint a mail provider
    // would call, signed with the same HMAC scheme core verifies. Everything
    // after it — parsing, deduplication, the `inbox_emails` row and the
    // persistent `inbox_ops.email.received` event — is core's own code, which
    // is the point: nothing here fakes a step of the inbound path.
    const payload: InboundWebhookPayload = {
      from: `${customerName} <${customerEmail}>`,
      to: toAddress,
      subject: seededEmail.subject,
      text: seededEmail.rawText,
      messageId: seededEmail.messageId,
      replyTo: seededEmail.replyTo,
    }
    const webhookUrl = `${baseUrl()}${INBOUND_WEBHOOK_PATH}`
    const posted = await postInboundWebhook({
      url: webhookUrl,
      signed: signWebhookRequest({ payload, secret: webhookSecret!, now: new Date() }),
    })

    if (!posted.ok && posted.kind === 'unreachable') {
      fail(
        `Could not reach ${webhookUrl}: ${posted.detail}`,
        'Nothing was written, in any tenant.',
        `This command delivers over HTTP, so the app has to be running at ${baseUrl()}`,
        '(set APP_URL to point somewhere else). Start it with:',
        '  yarn dev',
        'Or run the offline path, which writes the email itself and needs no server:',
        `  yarn mercato offer_automation demo --tenant ${tenantId} --org ${organizationId}`,
      )
    }
    if (!posted.ok) {
      fail(
        `The inbound webhook refused the request: HTTP ${posted.status}.`,
        `  response body: ${posted.body || '<empty>'}`,
        'Nothing was written, in any tenant.',
        posted.status === 503
          ? `503 means the SERVER has no ${WEBHOOK_SECRET_ENV}. Add it to .env and restart \`yarn dev\`.`
          : posted.status === 400
            ? 'A 400 here is a signature or timestamp rejection. Check that this machine'
              + " and the server agree on the time to within five minutes, and that both read the same .env."
            : 'See the dev-server log for the inbox_ops webhook.',
      )
    }

    // Core answers `200 {"ok":true}` for a stored email, for an unknown
    // recipient AND for a duplicate, so the 200 above proves nothing. The row
    // is read back by the message id we sent, which is the only handle that
    // survives the POST.
    const storedInboxEmailId = await awaitStoredEmail(
      container,
      seededEmail.messageId,
      scope,
      WEBHOOK_ROW_TIMEOUT_MS,
    )
    if (!storedInboxEmailId) {
      const probeEm = (container.resolve('em') as EntityManager).fork({ clear: true })
      const outcome = decideWebhookOutcome({
        storedInboxEmailId: null,
        duplicateInboxEmailId: await findEmailIdByContentHash(
          probeEm,
          webhookContentHash(payload),
          scope,
        ),
        inboxSettingsPresent: await isInboxAddressActive(probeEm, toAddress),
      })
      console.error('')
      console.error('=============================================================================')
      console.error('THE WEBHOOK ANSWERED 200 AND NO EMAIL WAS STORED.')
      console.error('=============================================================================')
      for (const line of describeWebhookOutcome(outcome, {
        toAddress,
        tenantId,
        organizationId,
        messageId: seededEmail.messageId,
      })) {
        console.error(line)
      }
      console.error('')
      fail(`No inbox email was stored for ${toAddress} (outcome: ${outcome.kind}).`)
    }

    // Read core's own row. Its text has been through core's parser, so the
    // thread on /backend/messages says what the stored email says rather than
    // what this command typed. The fields below are encrypted at rest, hence
    // the decrypting read.
    const storedEmail = await readStoredEmail(container, storedInboxEmailId!, scope)
    if (!storedEmail) {
      fail(
        `Inbox email ${storedInboxEmailId} vanished between two reads; refusing to write a message record for it.`,
      )
    }

    // Core's extraction worker writes this record itself, but only after a
    // SUCCESSFUL extraction (`extractionWorker.ts` step 8c), and on this install
    // it never gets that far. Writing it here is what puts the thread on
    // /backend/messages whichever extractor ends up winning.
    const message = await createDemoMessageRecord(container, storedEmail!, scope)
    if (!message.ok) {
      // Loud on purpose. The operator's next move is to open /backend/messages
      // and look for a row, and without this banner they would spend that search
      // on a thread that was never written.
      console.error('')
      console.error('=============================================================================')
      console.error('NO MESSAGES ROW WAS WRITTEN. Nothing will appear at /backend/messages,')
      console.error('in any tenant, for any login. Do not go looking for it.')
      console.error('=============================================================================')
      console.error(`  inboxEmailId:    ${storedInboxEmailId}  (core DID store this row)`)
      console.error(`  reason:          ${message.reason}`)
      console.error('')
      fail(
        `Core stored the inbox email, but its message record could not be created: ${message.reason}`,
        ...message.hints,
      )
    }

    // Read back what core wrote. Every name below is resolved from the database;
    // none of it is a literal, so it stays true when the audience feature moves
    // to another role or the tenant is renamed.
    const thread = await describeMessageThread(em.fork({ clear: true }), {
      messageId: message.messageId,
      recipientUserIds: message.recipientUserIds,
      senderUserId: message.senderUserId,
      tenantId,
    })

    // Nothing below this line touches the business flow. The persistent
    // `inbox_ops.email.received` event was emitted by core's webhook, inside
    // the request above, and is being drained by an events worker in another
    // process with retry and dead-lettering.

    const bodyLines = previewBody(seededEmail.rawText)

    console.log('')
    console.log('Inbound email delivered to core\'s webhook, parsed and stored.')
    console.log('')
    console.log('This is what was sent:')
    console.log(`  from:            ${customerEmail} (${customerName})`)
    console.log(`  to:              ${toAddress}`)
    console.log(`  subject:         ${seededEmail.subject}`)
    console.log(`  body:            ${bodyLines[0] ?? ''}`)
    for (const line of bodyLines.slice(1)) console.log(`                   ${line}`)
    console.log(
      `  body source:     ${
        overrides.bodySource === 'built-in'
          ? 'built-in enquiry (no --body / --body-file given)'
          : overrides.bodyPath
            ? `${overrides.bodySource} ${overrides.bodyPath}`
            : overrides.bodySource
      }`,
    )
    if (crmLink.customerEntityId) {
      console.log(
        `  CRM customer:    ${crmLink.customerEntityId} (the quote will link to this record)`,
      )
    } else {
      console.log('  CRM customer:    none, so the quote will carry a snapshot, not a link')
      for (const line of crmLink.explanation) console.log(`                   ${line}`)
    }
    console.log('')
    console.log('Rows written:')
    console.log(`  tenantId:        ${tenantId}`)
    console.log(`  organizationId:  ${organizationId}`)
    console.log(`  inboxEmailId:    ${storedInboxEmailId}  (written by core, not by this command)`)
    console.log(`  messageId:       ${message.messageId}`)
    console.log(`  threadId:        ${thread.threadId ?? '<none: core created no thread>'}`)
    console.log(`  addressed to:    ${thread.recipients.length} user(s)`)
    for (const recipient of thread.recipients) {
      console.log(`                   ${recipient.email}  (${recipient.userId})`)
    }
    console.log(`  sender shown as: ${thread.senderEmail ?? message.senderUserId}`)
    console.log(`  webhook:         POST ${webhookUrl} -> ${posted.status}`)
    console.log('  event:           inbox_ops.email.received (persistent, emitted by core)')
    console.log(`  will act as:     ${AUTOMATION_USER_EMAIL} (${automationUserId})`)
    console.log('')
    console.log('Where to read it:')
    console.log(`  Thread:    ${messageThreadUrl(baseUrl(), message.messageId)}`)
    for (const line of describeWhoCanSeeThread(thread)) console.log(`             ${line}`)
    console.log('')
    console.log(`  Inbox:     ${baseUrl()}/backend/messages`)
    console.log(`  Proposals: ${baseUrl()}/backend/inbox-ops/proposals`)
    console.log(`  Quotes:    ${baseUrl()}/backend/sales/quotes`)
    console.log(`  Origins:   ${baseUrl()}/backend/offer-automation/origins`)

    if (!watch) {
      console.log('')
      console.log('Not watching (--no-watch). Nothing else runs in this process.')
      console.log('')
      return
    }

    console.log('')
    console.log(`Watching the rows the subscribers write (read-only, up to ${Math.round(watchTimeoutMs / 1000)}s)...`)

    const startedAt = Date.now()
    let state = await readWatchState(container, storedInboxEmailId!, scope)
    while (!watchSettled(state) && Date.now() - startedAt < watchTimeoutMs) {
      await sleep(POLL_INTERVAL_MS)
      state = await readWatchState(container, storedInboxEmailId!, scope)
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

    console.log('')
    console.log(`After ${elapsed}s:`)
    console.log(`  emailStatus:     ${state.emailStatus}`)
    if (state.processingError) console.log(`  emailError:      ${state.processingError}`)
    console.log(`  proposalId:      ${state.proposalId ?? '<none yet>'}`)
    console.log(`  actionId:        ${state.actionId ?? '<none yet>'}`)
    console.log(`  actionStatus:    ${state.actionStatus ?? '<none yet>'}`)
    if (state.executionError) console.log(`  actionError:     ${state.executionError}`)
    console.log(`  executedBy:      ${state.executedByUserId ?? '<nobody yet>'}`)
    console.log(`  quoteNumber:     ${state.quoteNumber ?? '<none yet>'}`)
    console.log(
      `  quoteTotal:      ${state.quoteTotal ? `${state.quoteTotal} ${state.quoteCurrency ?? ''}`.trim() : '<none yet>'}`,
    )
    console.log(`  customerEntity:  ${state.customerEntityId ?? '<snapshot only>'}`)
    console.log(`  notifications:   ${state.notificationCount}`)

    if (state.quoteId) {
      console.log('')
      console.log(`Quote: ${baseUrl()}/backend/sales/quotes/${state.quoteId}`)
      console.log('A salesperson reviews the draft and sends it. Nothing went to the customer.')
      console.log('')
      return
    }

    console.log('')
    if (state.proposalId && state.actionStatus === 'failed') {
      console.log('The action ran and refused. No quote was created, on purpose: see actionError')
      console.log('above. The action is retryable from the proposal card, and everyone who can')
      console.log('read quotes has an error notification naming the reason.')
      console.log(`Proposal: ${baseUrl()}/backend/inbox-ops/proposals/${state.proposalId}`)
      console.log('')
      return
    }

    if (state.emailStatus === 'failed') {
      console.log('Extraction refused this email, so no action and no quote exist. The reason is')
      console.log('on emailError above; the usual one is that the model judged it not to be a')
      console.log('freight enquiry. An email that is never processed at all looks different:')
      console.log('it stays `received` with no error.')
      console.log('')
      return
    }

    if (describeUnsettled(state) === 'nothing-reacted') {
      console.log('Nothing has touched this email. The job is durable and still queued, so the')
      console.log('cause is almost always that no events worker is draining the queue.')
      console.log('Start one with:')
      console.log('  yarn mercato queue worker --all')
      console.log('(`yarn dev` spawns one itself when AUTO_SPAWN_WORKERS is on.)')
    } else {
      console.log('Something is working on it and the watch window closed first. Give it longer')
      console.log('with --watch-timeout, or check the queue worker log for an error.')
    }
    console.log('Then watch it land:')
    console.log(`  yarn mercato offer_automation origins --tenant ${tenantId} --org ${organizationId}`)
    console.log('')
  },
}

const cli: ModuleCli[] = [demo, sendEmail, seedDemo, seedCatalog, origins, checkAi]

export default cli
