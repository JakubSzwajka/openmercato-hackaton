import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

/**
 * The scope every seed command runs under: one tenant, one organization, and a
 * real user to record as the actor.
 */
export type SeedCommandScope = {
  tenantId: string
  organizationId: string
  /** Acting user. Recorded as the operation-log actor for every seeded command. */
  actorUserId: string
}

/**
 * Builds the command context a CLI seed runs its commands with.
 *
 * `freightCatalog.ts` and `demoCompany.ts` each had their own copy of this, with
 * the same fields and the same reasoning written twice in different words. One
 * copy is enough, and it keeps the `isSuperAdmin` decision in a single place.
 *
 * Never a super-admin. A seed gets exactly the reach a browser session for this
 * user would have, so a scope bug fails here rather than in production.
 */
export function buildSeedCommandContext(
  container: AwilixContainer,
  scope: SeedCommandScope,
): CommandRuntimeContext {
  return {
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
  } as unknown as CommandRuntimeContext
}
