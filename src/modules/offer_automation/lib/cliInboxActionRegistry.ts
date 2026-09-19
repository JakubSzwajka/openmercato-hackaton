import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { compileAppSourceFile } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'

/**
 * Makes the installed `inbox_ops` execution engine loadable from a CLI process.
 *
 * Why it is needed
 * ----------------
 * `executionEngine.executeByType()` reaches the action registry with a
 * webpack/esbuild alias specifier:
 *
 *   node_modules/@open-mercato/core/dist/modules/inbox_ops/lib/executionEngine.js:252
 *     await import('@/.mercato/generated/inbox-actions.generated')
 *
 * Next.js and the CLI bundler both rewrite `@/`. Plain Node does not, and the
 * engine runs from `dist/` (already compiled, so no bundler touches it). Calling
 * `executeAction()` from a CLI therefore fails with:
 *
 *   Cannot find package '@/.mercato' imported from .../dist/.../executionEngine.js
 *
 * What this does
 * --------------
 * Compiles the generated registry with `compileAppSourceFile` — documented by
 * `@open-mercato/shared/lib/bootstrap/dynamicLoader` as "the only supported way
 * to load app source from a plain Node process" — and teaches the running Node
 * resolver that this one specifier means that one artifact. Nothing else is
 * intercepted, no core file is patched, and the engine still performs its own
 * RBAC check, status claiming, events and proposal recalculation.
 *
 * This is CLI-only. The dev server and the production server never call it,
 * because a bundler already resolves the alias there.
 *
 * Removal condition
 * -----------------
 * Delete this file and its single call in `../cli.ts` once core resolves the
 * registry through a specifier plain Node can follow (a `#generated/...`
 * subpath import, or a registry injected through DI).
 */

const ALIAS_SPECIFIER = '@/.mercato/generated/inbox-actions.generated'
const SOURCE_RELATIVE_PATH = path.join('.mercato', 'generated', 'inbox-actions.generated.ts')
// Kept out of `.mercato/generated/` on purpose: that directory belongs to
// `yarn generate`, and this artifact is ours to write and re-write.
const ARTIFACT_RELATIVE_PATH = path.join('.mercato', 'offer_automation', 'inbox-actions.cli.mjs')

let registered = false

/**
 * Idempotent. A second call reuses the hook already installed in this process.
 * Returns the absolute path of the compiled artifact so a caller can report it.
 */
export async function enableInboxActionRegistryForCli(appRoot: string): Promise<string> {
  const sourcePath = path.join(appRoot, SOURCE_RELATIVE_PATH)
  const artifactPath = path.join(appRoot, ARTIFACT_RELATIVE_PATH)

  await compileAppSourceFile(sourcePath, { appRoot, outFile: artifactPath })

  if (registered) return artifactPath
  const artifactUrl = pathToFileURL(artifactPath).href

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === ALIAS_SPECIFIER) {
        return { url: artifactUrl, shortCircuit: true }
      }
      return nextResolve(specifier, context)
    },
  })
  registered = true

  return artifactPath
}
