import { findAppRoot } from '@open-mercato/shared/lib/bootstrap/appResolver'
import { enableInboxActionRegistryForCli } from './cliInboxActionRegistry'

/**
 * Makes `executeAction` work in whatever process it is called from.
 *
 * The engine reaches the generated action registry through the bundler alias
 * `@/.mercato/generated/inbox-actions.generated`. Next resolves it; plain Node
 * does not, and the queue worker (`mercato queue worker --all`, which
 * `yarn dev` auto-spawns) IS plain Node. Without this the subscriber's first
 * execution dies with `Cannot find package '@/.mercato'` and the action is
 * written back as `failed` for a reason that has nothing to do with the
 * business rules.
 *
 * `NEXT_RUNTIME` is the discriminator: Next sets it in every server runtime it
 * owns, and nothing else does. Under Next the shim is skipped entirely, so no
 * resolver hook is installed and no artifact is compiled in a served request.
 *
 * Failure is logged by the caller and never fatal: under a bundler the
 * execution works without us, so a shim that cannot install must not be the
 * thing that stops a quote being drafted.
 */
export function needsInboxActionRegistryShim(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !env.NEXT_RUNTIME
}

/** Idempotent per process; see `cliInboxActionRegistry.ts`. */
export async function ensureInboxActionRegistryResolvable(): Promise<string | null> {
  if (!needsInboxActionRegistryShim()) return null
  const appRoot = findAppRoot()?.appDir ?? process.cwd()
  return enableInboxActionRegistryForCli(appRoot)
}
