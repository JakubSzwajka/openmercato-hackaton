import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// Knowing exception, same standing as `demoCompany.ts`: `User` is READ to find
// out whether a previous run already created the automation account. The two
// writes below go through core's command bus (`auth.users.create`,
// `auth.user-acl.update`); nothing here calls `em.persist`.
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { DRAFT_OFFER_REQUIRED_FEATURE } from '../inbox-actions'

/**
 * The account every automatic quote is attributable to.
 *
 * WHY A USER AND NOT A SYSTEM ACTOR
 * ---------------------------------
 * The `inbox_ops` execution engine authorises every action against a real user
 * id (`executionEngine.ts` `ensureUserCanExecuteAction`), and the command bus
 * stamps that id onto the operation log of the quote it creates. A bot that
 * "ran as nobody" would either need the RBAC gate switched off or a zero-UUID
 * actor on a real sales document. So the automation gets an account, and
 * `sales_quotes` rows drafted by the machine carry an actor a human can tell
 * apart from a colleague at a glance.
 *
 * WHAT IT IS ALLOWED TO DO
 * ------------------------
 * Exactly one feature: `offer_automation.offers.draft`. The grant is a per-user
 * ACL, which `rbacService` uses EXCLUSIVELY when present (`rbacService.ts:227`),
 * so the account holds no role and inherits nothing — not `inbox_ops`
 * proposals, not `sales.quotes.view`, and never super-admin. That is also why
 * it never appears in the audience of the notifications this module sends: the
 * bot cannot see quotes, it can only draft them.
 */
export const AUTOMATION_USER_EMAIL = 'automation@nordwind-logistics.example'
export const AUTOMATION_USER_NAME = 'Offer Automation'

/** The whole grant. Kept as a list so the seeder and the docs read the same value. */
export const AUTOMATION_USER_FEATURES = [DRAFT_OFFER_REQUIRED_FEATURE] as const

/**
 * Finds the automation account in one tenant.
 *
 * `email` is in the auth module's encryption map, so the lookup goes through
 * the deterministic hash exactly as `demoCompany.ts` does. Returns `null` when
 * the account does not exist; every caller then says so rather than falling
 * back to another user, because "the machine drafted this" must never quietly
 * become "a person drafted this".
 */
export async function resolveAutomationUserId(
  em: EntityManager,
  tenantId: string,
  email: string = AUTOMATION_USER_EMAIL,
): Promise<string | null> {
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
 * A password nobody knows, including this process after it returns.
 *
 * `auth.users.create` requires either a password or an invite email, and an
 * invite to a `.example` address goes nowhere. A random one satisfies the
 * command, is stored only as a bcrypt hash, and is never printed: the account
 * is not meant to be logged into, and it is created unconfirmed, so the login
 * form rejects it regardless.
 */
function mintUnknowablePassword(): string {
  return `Aa1!${randomBytes(24).toString('base64url')}`
}

export type AutomationUser = {
  email: string
  userId: string
  features: string[]
  created: boolean
}

/**
 * Creates the automation account once, then leaves it alone.
 *
 * Idempotent on the email address. The ACL is re-applied on every run because
 * it is the security-relevant half: a run that finds the account must still
 * guarantee the grant is exactly `AUTOMATION_USER_FEATURES`, otherwise a hand
 * edit in the admin UI could silently widen what the machine may do.
 */
export async function ensureAutomationUser(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string; actorUserId: string },
  email: string = AUTOMATION_USER_EMAIL,
): Promise<AutomationUser> {
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as {
    execute: <TInput, TResult>(
      commandId: string,
      options: { input: TInput; ctx: unknown },
    ) => Promise<{ result: TResult }>
  }
  if (!commandBus || typeof commandBus.execute !== 'function') {
    throw new Error('Command bus is not available; cannot create the automation user.')
  }

  const ctx = {
    container,
    auth: {
      sub: scope.actorUserId,
      userId: scope.actorUserId,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      isSuperAdmin: false,
    },
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }

  let userId = await resolveAutomationUserId(em, scope.tenantId, email)
  const existed = Boolean(userId)

  if (!userId) {
    const { result } = await commandBus.execute<Record<string, unknown>, { user: { id: string } }>(
      'auth.users.create',
      {
        input: {
          email,
          name: AUTOMATION_USER_NAME,
          password: mintUnknowablePassword(),
          organizationId: scope.organizationId,
          // No role. The per-user ACL below is the entire grant.
          roles: [],
        },
        ctx,
      },
    )
    userId = String(result.user.id)
  }

  await commandBus.execute<Record<string, unknown>, unknown>('auth.user-acl.update', {
    input: {
      userId,
      tenantId: scope.tenantId,
      clear: false,
      isSuperAdmin: false,
      features: [...AUTOMATION_USER_FEATURES],
      // Visible in this organization only. `null` would mean "every
      // organization in the tenant", which is more reach than drafting offers
      // for one company needs.
      organizations: [scope.organizationId],
    },
    ctx,
  })

  return {
    email,
    userId,
    features: [...AUTOMATION_USER_FEATURES],
    created: !existed,
  }
}
