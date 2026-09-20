import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { buildSeedCommandContext } from './seedCommandContext'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  formatPasswordRequirements,
  getPasswordPolicy,
  validatePassword,
} from '@open-mercato/shared/lib/auth/passwordPolicy'
import { getCliModules } from '@open-mercato/shared/modules/registry'
// Knowing exception, dev seed only, and the same one `freightCatalog.ts`
// already documents: the installed entities below are READ to find out what a
// previous run left behind, so a second run creates nothing. Every write goes
// through core's own code — `setupInitialTenant` for the tenant, and the
// command bus (`auth.users.create`, `sales.channels.create`,
// `customers.companies.create`, `customers.people.create`) for everything
// else. Nothing here declares a relation against another module and nothing
// here calls `em.persist`.
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { ensureRoles, setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'

/**
 * The logistics company the demo is about.
 *
 * Every identifier here is DETERMINISTIC. The organization slug is the lookup
 * key that makes `seed-demo` idempotent: a second run finds the organization by
 * slug, reuses its tenant and creates nothing. Change these and the next run
 * builds a second company instead of finding the first.
 */
export const DEMO_ORG_SLUG = 'nordwind-logistics'
export const DEMO_COMPANY_NAME = 'Nordwind Logistics'

/** `.example` is reserved by RFC 2606, so no seeded address can reach a real inbox. */
export const DEMO_EMAIL_DOMAIN = 'nordwind-logistics.example'
export const DEMO_ADMIN_EMAIL = `admin@${DEMO_EMAIL_DOMAIN}`
export const DEMO_SALES_EMAIL = `sales@${DEMO_EMAIL_DOMAIN}`

/**
 * DEV-ONLY SEED CREDENTIAL. This password is written into a local demo tenant
 * so an operator can log in straight after running the seed, and the command
 * prints it in clear text. It is not a secret, it must never be used outside a
 * throwaway development database, and nothing in the auth path is relaxed to
 * accept it: it is a normal password that satisfies the configured policy and
 * is stored as a bcrypt hash like any other. Override it per run with
 * `--admin-password` / `--sales-password`, or with `OM_DEMO_ADMIN_PASSWORD` /
 * `OM_DEMO_SALES_PASSWORD`.
 *
 * "Never outside a throwaway database" is no longer only a comment:
 * `assertDisposableSeedTarget` below enforces it at runtime.
 */
export const DEFAULT_DEMO_PASSWORD = 'Nordwind!1'

/**
 * The one way past the production refusal below.
 *
 * An environment variable rather than a CLI flag on purpose: a flag is a
 * keystroke inside a command somebody is already typing, while this has to be
 * put in the environment deliberately. It is checked for ONE EXACT VALUE, so
 * the habitual `=1` / `=true` / `=yes` does not unlock it — the operator has to
 * write the sentence out.
 */
export const DEMO_SEED_OVERRIDE_ENV = 'OM_DEMO_SEED_ALLOW_PRODUCTION'
export const DEMO_SEED_OVERRIDE_VALUE = 'i-understand-this-seeds-a-known-password'

/**
 * Whether this process looks like it is pointed at a production system.
 *
 * `NODE_ENV` is the signal, and deliberately the only one. A heuristic over
 * `DATABASE_URL` was considered and rejected twice over: it is wrong in both
 * directions (a production database on `localhost` behind a tunnel passes, a
 * developer's copy called `*-prod-restore` fails), and any refusal that quoted
 * the URL back would print the database password into the terminal and the CI
 * log. `NODE_ENV` is a plain, non-secret, operator-set value.
 */
export function isProductionLikeEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
}

/**
 * Refuses to seed anything when the target does not look throwaway.
 *
 * `DEFAULT_DEMO_PASSWORD` above is published in this repository and printed in
 * clear text by the seed. Until this check existed, the comment saying "never
 * outside a throwaway development database" was the whole enforcement, and one
 * `DATABASE_URL` pointed at the wrong host turned that comment into a real
 * tenant with a real, world-readable login.
 *
 * DELIBERATELY NOT RELAXED BY A CUSTOM PASSWORD. A supplied
 * `--admin-password` removes the published-credential half of the problem, and
 * that is the lesser half: what remains is a seed that creates a tenant, an
 * organization, users, a sales channel, catalogue products and CRM companies in
 * a production database. The password is one symptom; writing demo data into a
 * real system is the thing being refused. So the check takes no password
 * argument at all — it cannot be talked out of it.
 *
 * Throws before any write. Never names the password in the message.
 */
export function assertDisposableSeedTarget(env: NodeJS.ProcessEnv = process.env): void {
  if (!isProductionLikeEnvironment(env)) return
  if ((env[DEMO_SEED_OVERRIDE_ENV] ?? '').trim() === DEMO_SEED_OVERRIDE_VALUE) return
  throw new Error(
    'Refusing to seed demo data: NODE_ENV is "production". '
      + 'This seed creates a tenant, users, catalogue and CRM records, and the default login '
      + 'password it uses is published in this repository\'s source, so anyone who reads that '
      + 'source could sign in. '
      + `If this database really is disposable, set ${DEMO_SEED_OVERRIDE_ENV}=${DEMO_SEED_OVERRIDE_VALUE} `
      + 'and run it again. Supplying your own password does not lift this refusal: the risk it '
      + 'guards is demo data in a real database, not only the default credential.',
  )
}

export const DEMO_CHANNEL_CODE = 'direct-sales'
export const DEMO_CHANNEL_NAME = 'Direct sales'

export type DemoScope = {
  tenantId: string
  organizationId: string
  /** Acting user. Recorded as the operation-log actor for every command below. */
  actorUserId: string
}

async function runCommand<TResult>(
  container: AwilixContainer,
  scope: DemoScope,
  commandId: string,
  input: Record<string, unknown>,
): Promise<TResult> {
  const commandBus = container.resolve('commandBus') as CommandBus
  if (!commandBus || typeof commandBus.execute !== 'function') {
    throw new Error('Command bus is not available; cannot seed through core commands.')
  }
  const { result } = await commandBus.execute<Record<string, unknown>, TResult>(commandId, {
    input,
    ctx: buildSeedCommandContext(container, scope),
  })
  return result
}

/**
 * Refuses a password the configured policy would reject.
 *
 * Checked before the tenant is touched so the operator gets one readable
 * message instead of a half-built company and a bcrypt hash nobody can use.
 */
export function assertPasswordAcceptable(label: string, password: string): void {
  const policy = getPasswordPolicy()
  if (validatePassword(password, policy).ok) return
  const requirements = formatPasswordRequirements(policy, (_key, fallback) => fallback)
  throw new Error(
    `${label} does not meet the password policy${requirements ? `: ${requirements}` : ''}.`,
  )
}

export type DemoTenant = {
  tenantId: string
  organizationId: string
  /** False when a previous run had already created this company. */
  created: boolean
}

/**
 * Finds or creates the logistics tenant and its organization.
 *
 * The slug is the identity. When an organization with `DEMO_ORG_SLUG` exists,
 * its tenant is reused and nothing is created — that is what makes the whole
 * seed re-runnable.
 *
 * THAT GUARANTEE IS SEQUENTIAL ONLY. `organizations` is unique on
 * `(tenant_id, slug)` and not on `slug`
 * (`directory/data/entities.ts:28-41`), and the miss branch below creates a NEW
 * tenant — so two runs racing each other both miss, both create, and the
 * composite constraint stops neither. Re-running the seed is safe; running two
 * copies of it at the same time is not, and is not something this seed tries to
 * support.
 *
 * When it does not exist, core's own `setupInitialTenant` builds the tenant,
 * the organization, the three built-in roles, the tenant DEK and the primary
 * user, and fires every module's `onTenantCreated` hook. That is the same
 * function `mercato auth setup` calls; it is used directly rather than through
 * the CLI command because the command only reports its ids on stdout and this
 * seed needs them as values.
 *
 * `includeDerivedUsers: false` on purpose: core's derived accounts are
 * `admin@acme.com` / `employee@acme.com`, which belong to the fashion demo and
 * have nothing to do with this company.
 *
 * `orgSlug` and `orgName` are optional and default to the constants above. They
 * exist so a second, throwaway company can be seeded beside the first without
 * the slug lookup adopting it: the slug IS the identity here, so a different
 * one means a different tenant rather than a reused one. Everything else about
 * the run is unchanged.
 */
export async function ensureDemoTenant(
  container: AwilixContainer,
  options: { adminEmail: string; adminPassword: string; orgSlug?: string; orgName?: string },
): Promise<DemoTenant> {
  const orgSlug = options.orgSlug?.trim() || DEMO_ORG_SLUG
  const orgName = options.orgName?.trim() || DEMO_COMPANY_NAME
  // First statement in the first function that writes anything. Everything the
  // seed creates is downstream of this tenant.
  assertDisposableSeedTarget()
  const em = (container.resolve('em') as EntityManager).fork()

  const existing = (await findOneWithDecryption(
    em,
    Organization,
    { slug: orgSlug, deletedAt: null } as never,
    { populate: ['tenant'] } as never,
    { tenantId: null, organizationId: null },
  )) as { id: string; tenant?: { id?: string } } | null

  if (existing) {
    const tenantId = existing.tenant?.id
    if (!tenantId) {
      throw new Error(
        `Organization "${orgSlug}" exists but has no tenant; refusing to guess one.`,
      )
    }
    // Cheap and idempotent. A tenant created by an older run of this command
    // already has them; a tenant created by hand might not.
    await ensureRoles(em, { tenantId })
    return { tenantId, organizationId: existing.id, created: false }
  }

  // The slug is free, so the company does not exist. If the admin address is
  // nonetheless taken, a previous run died half-way or the address belongs to
  // somebody else's tenant. `setupInitialTenant` would silently adopt that
  // user's tenant and seed freight services into it, so refuse instead.
  const strayAdmin = await findOneWithDecryption(
    em,
    User,
    { emailHash: { $in: emailHashLookupValues(options.adminEmail) }, deletedAt: null } as never,
    {} as never,
    { tenantId: null, organizationId: null },
  )
  if (strayAdmin) {
    throw new Error(
      `No organization with slug "${orgSlug}" exists, but a user ${options.adminEmail} already does `
        + `(id ${(strayAdmin as { id?: string }).id ?? '<unknown>'}). Refusing to adopt another tenant's user.`,
    )
  }

  const result = await setupInitialTenant(em, {
    orgName,
    orgSlug,
    roleNames: ['superadmin', 'admin', 'employee'],
    primaryUser: { email: options.adminEmail, password: options.adminPassword, confirm: true },
    includeDerivedUsers: false,
    // The slug check above already proved the company is new, and the stray
    // check proved the address is free, so an existing user here is a race we
    // want to hear about rather than absorb.
    failIfUserExists: true,
    modules: getCliModules(),
  })

  return { tenantId: result.tenantId, organizationId: result.organizationId, created: true }
}

export type DemoUser = {
  email: string
  password: string
  userId: string
  roles: string[]
  created: boolean
}

async function findUserIdByEmail(em: EntityManager, tenantId: string, email: string): Promise<string | null> {
  const found = (await findOneWithDecryption(
    em,
    User,
    {
      emailHash: { $in: emailHashLookupValues(email) },
      tenantId,
      deletedAt: null,
    } as never,
    {} as never,
    { tenantId, organizationId: null },
  )) as { id?: string } | null
  return found?.id ?? null
}

/**
 * Makes sure the admin exists (it always does by now) and adds the sales
 * employee.
 *
 * The employee is the user the demo acceptance runs as, so it must hold
 * `offer_automation.offers.draft` AND `inbox_ops.proposals.view`. Both arrive
 * from the built-in `employee` role: our `setup.ts` grants the first, core's
 * `inbox_ops/setup.ts` grants the second. Nothing is granted per user here.
 *
 * Creation goes through `auth.users.create` rather than `mercato auth add-user`
 * because the CLI command writes the email column in clear text and creates a
 * duplicate row on every run; the command encrypts through the data engine and
 * refuses duplicates.
 */
export async function ensureDemoUsers(
  container: AwilixContainer,
  scopeIds: { tenantId: string; organizationId: string },
  passwords: { admin: string; sales: string },
  emails: { admin: string; sales: string },
  /** True when `ensureDemoTenant` built the tenant, which also built the admin. */
  adminCreatedByThisRun: boolean,
): Promise<DemoUser[]> {
  // Checked again rather than trusted from the caller: this function creates a
  // login with a known password, so it refuses on its own terms and not because
  // somebody remembered to call it in the right order.
  assertDisposableSeedTarget()
  const em = (container.resolve('em') as EntityManager).fork()
  const users: DemoUser[] = []

  const adminId = await findUserIdByEmail(em, scopeIds.tenantId, emails.admin)
  if (!adminId) {
    throw new Error(`Admin ${emails.admin} is missing from tenant ${scopeIds.tenantId} after setup.`)
  }
  // The admin is the actor for the create below, so it has to be resolved
  // first. No command runs under a made-up user id.
  const scope: DemoScope = { ...scopeIds, actorUserId: adminId }
  users.push({
    email: emails.admin,
    password: passwords.admin,
    userId: adminId,
    roles: ['superadmin'],
    created: adminCreatedByThisRun,
  })

  let salesId = await findUserIdByEmail(em, scope.tenantId, emails.sales)
  const salesExisted = Boolean(salesId)
  if (!salesId) {
    const result = await runCommand<{ user: { id: string } }>(
      container,
      scope,
      'auth.users.create',
      {
        email: emails.sales,
        name: 'Sales Desk',
        password: passwords.sales,
        organizationId: scope.organizationId,
        roles: ['employee'],
      },
    )
    salesId = String(result.user.id)
  }
  users.push({
    email: emails.sales,
    password: passwords.sales,
    userId: salesId,
    roles: ['employee'],
    created: !salesExisted,
  })

  return users
}

export type DemoChannel = { channelId: string; name: string; created: boolean }

/**
 * Guarantees the one prerequisite nothing else creates.
 *
 * `executeDraftOffer` fails closed with "No active sales channel in this
 * organization" when the org has none, and no core seed command creates one:
 * the only core code that does is `sales seed-examples`, which also imports the
 * fashion demo's quotes and orders. So the seed creates a single channel of its
 * own through `sales.channels.create`.
 */
export async function ensureSalesChannel(
  container: AwilixContainer,
  scope: DemoScope,
): Promise<DemoChannel> {
  const em = (container.resolve('em') as EntityManager).fork()

  const existing = (await findOneWithDecryption(
    em,
    SalesChannel,
    {
      code: DEMO_CHANNEL_CODE,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as never,
    {} as never,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )) as { id: string; name?: string | null; isActive?: boolean } | null

  if (existing) {
    // An existing channel is left exactly as the operator left it, including a
    // deliberate `isActive: false`. The caller verifies activity separately and
    // says so, rather than this seed silently switching it back on.
    return { channelId: existing.id, name: existing.name ?? DEMO_CHANNEL_NAME, created: false }
  }

  const result = await runCommand<{ channelId: string }>(
    container,
    scope,
    'sales.channels.create',
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: DEMO_CHANNEL_NAME,
      code: DEMO_CHANNEL_CODE,
      description: 'Quotes drafted by the sales desk from inbound customer enquiries.',
      isActive: true,
    },
  )
  return { channelId: result.channelId, name: DEMO_CHANNEL_NAME, created: true }
}

/** Reports whether the organization has any active channel at all. */
export async function hasActiveSalesChannel(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  const em = (container.resolve('em') as EntityManager).fork()
  const found = await findOneWithDecryption(
    em,
    SalesChannel,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
      deletedAt: null,
    } as never,
    {} as never,
    scope,
  )
  return Boolean(found)
}

export type DemoCustomerDefinition = {
  company: {
    displayName: string
    legalName: string
    domain: string
    industry: string
    description: string
    primaryEmail: string
  }
  contact: {
    firstName: string
    lastName: string
    jobTitle: string
    /** The address the enquiry arrives from when this contact is the sender. */
    primaryEmail: string
  }
}

/**
 * Three freight customers with a named contact each.
 *
 * The contact's `primaryEmail` is the whole point of this list. Core's
 * `resolveCustomerEntityIdByEmail` (inbox_ops/lib/executionHelpers.ts:367)
 * matches an accepted action's `customerEmail` against
 * `customer_entities.primary_email` in the same organization, so an enquiry
 * sent from one of these addresses produces a quote linked to the real CRM
 * record instead of one carrying an anonymous `customerSnapshot`.
 */
export const DEMO_CUSTOMERS: readonly DemoCustomerDefinition[] = [
  {
    company: {
      displayName: 'Nordwind Spedition GmbH',
      legalName: 'Nordwind Spedition GmbH',
      domain: 'nordwind-spedition.example',
      industry: 'Freight forwarding',
      description: 'Hamburg forwarder, weekly groupage into the Benelux.',
      primaryEmail: 'disposition@nordwind-spedition.example',
    },
    contact: {
      firstName: 'Marta',
      lastName: 'Nowak',
      jobTitle: 'Transport planner',
      primaryEmail: 'marta.nowak@nordwind-spedition.example',
    },
  },
  {
    company: {
      displayName: 'Baltic Freight Partners',
      legalName: 'Baltic Freight Partners Sp. z o.o.',
      domain: 'baltic-freight.example',
      industry: 'Freight forwarding',
      description: 'Gdańsk port operator moving containerised cargo inland.',
      primaryEmail: 'office@baltic-freight.example',
    },
    contact: {
      firstName: 'Jonas',
      lastName: 'Berg',
      jobTitle: 'Head of logistics',
      primaryEmail: 'jonas.berg@baltic-freight.example',
    },
  },
  {
    company: {
      displayName: 'Vistula Logistics',
      legalName: 'Vistula Logistics S.A.',
      domain: 'vistula-logistics.example',
      industry: 'Contract logistics',
      description: 'Warsaw 3PL running distribution for industrial manufacturers.',
      primaryEmail: 'kontakt@vistula-logistics.example',
    },
    contact: {
      firstName: 'Ewa',
      lastName: 'Kowalczyk',
      jobTitle: 'Procurement manager',
      primaryEmail: 'ewa.kowalczyk@vistula-logistics.example',
    },
  },
]

export type SeededCustomerRow = {
  companyName: string
  companyEntityId: string
  contactName: string
  contactEntityId: string
  contactEmail: string
  created: { company: boolean; contact: boolean }
}

export type DemoCustomerSeedResult = {
  rows: SeededCustomerRow[]
  createdCount: number
}

/**
 * Loads every customer entity in the organization, decrypted.
 *
 * `display_name` and `primary_email` are both in the customers module's
 * encryption map, so a `where primary_email = ?` never matches. Core solves
 * this the same way inside `resolveCustomerEntityIdByEmail`: read the rows and
 * compare in memory. The demo organization holds six of them.
 */
async function loadCustomerIndex(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<Map<string, string>> {
  const rows = (await findWithDecryption(
    em,
    CustomerEntity,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as never,
    { limit: 500 } as never,
    scope,
  )) as Array<{ id: string; primaryEmail?: string | null; displayName?: string | null }>

  const index = new Map<string, string>()
  for (const row of rows) {
    if (row.primaryEmail) index.set(`email:${row.primaryEmail.toLowerCase()}`, row.id)
    if (row.displayName) index.set(`name:${row.displayName.toLowerCase()}`, row.id)
  }
  return index
}

/**
 * Puts the three freight customers and their contacts in the CRM, once.
 *
 * Idempotent on the contact's email address and the company's display name,
 * which are the two things the rest of the demo looks a customer up by.
 */
export async function seedDemoCustomers(
  container: AwilixContainer,
  scope: DemoScope,
): Promise<DemoCustomerSeedResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  const index = await loadCustomerIndex(em, scope)

  const rows: SeededCustomerRow[] = []
  for (const definition of DEMO_CUSTOMERS) {
    const created = { company: false, contact: false }

    let companyEntityId = index.get(`name:${definition.company.displayName.toLowerCase()}`) ?? null
    if (!companyEntityId) {
      const result = await runCommand<{ entityId: string }>(
        container,
        scope,
        'customers.companies.create',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          displayName: definition.company.displayName,
          legalName: definition.company.legalName,
          domain: definition.company.domain,
          industry: definition.company.industry,
          description: definition.company.description,
          primaryEmail: definition.company.primaryEmail,
          isActive: true,
        },
      )
      companyEntityId = result.entityId
      created.company = true
    }

    const contactKey = `email:${definition.contact.primaryEmail.toLowerCase()}`
    let contactEntityId = index.get(contactKey) ?? null
    if (!contactEntityId) {
      const result = await runCommand<{ entityId: string }>(
        container,
        scope,
        'customers.people.create',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          firstName: definition.contact.firstName,
          lastName: definition.contact.lastName,
          jobTitle: definition.contact.jobTitle,
          primaryEmail: definition.contact.primaryEmail,
          companyEntityId,
          isActive: true,
        },
      )
      contactEntityId = result.entityId
      created.contact = true
    }

    rows.push({
      companyName: definition.company.displayName,
      companyEntityId,
      contactName: `${definition.contact.firstName} ${definition.contact.lastName}`,
      contactEntityId,
      contactEmail: definition.contact.primaryEmail,
      created,
    })
  }

  const createdCount = rows.reduce(
    (total, row) => total + Number(row.created.company) + Number(row.created.contact),
    0,
  )
  return { rows, createdCount }
}

/** The contact whose address the demo enquiry is sent from. */
export function primaryDemoContact(): DemoCustomerDefinition {
  return DEMO_CUSTOMERS[0]!
}
