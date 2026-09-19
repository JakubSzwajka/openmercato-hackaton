// Explicit imports rather than ambient globals, for the same reason as
// `coreRequiredFeatureShim.test.ts`: `@types/jest` is not in the tsconfig
// typeRoots resolution for this app.
import { describe, expect, it } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'
import { enabledModules } from '@/modules'

const ROUTE_PATH = '/backend/inbox-ops/proposals/[id]'
const OVERRIDE_KEY = `backend:${ROUTE_PATH}`
const OVERLAY_DIR = 'src/modules/inbox_ops/backend/inbox-ops/proposals/[id]'
const CORE_META_MODULE = '@open-mercato/core/modules/inbox_ops/backend/inbox-ops/proposals/[id]/page.meta'

function readGenerated(fileName: string): string {
  return fs.readFileSync(path.join(process.cwd(), '.mercato/generated', fileName), 'utf8')
}

/**
 * This app serves core's proposal detail URL with its own component through the
 * app-overlay mechanism, not through `entry.overrides.routes.pages`.
 *
 * Two facts force that choice, and both are asserted below:
 *  - `src/modules.ts` is compiled by esbuild with `bundle: true` for the CLI,
 *    worker and scheduler, which inlines the whole relative import graph. A
 *    loader reaching the React page put a Next client import into the compiled
 *    artifact, which plain Node ESM cannot resolve, so every `yarn mercato`
 *    command failed to bootstrap.
 *  - A `null` disable would not have helped either: `applyPageOverridesToManifests`
 *    drops *every* manifest entry matching the pattern, so core's page and an
 *    app page under `offer_automation/backend/**` would both disappear.
 *
 * `scanModuleDir` keys discovered module files by logical path and writes the
 * app copy last, so the overlay replaces core's page and the URL keeps exactly
 * one manifest entry.
 */
describe('inbox_ops proposal detail page overlay', () => {
  it('declares no page-route override on the inbox_ops entry', () => {
    const entry = enabledModules.find((module) => module.id === 'inbox_ops')
    expect(entry).toBeDefined()
    expect(entry?.from).toBe('@open-mercato/core')
    expect(entry?.overrides?.routes?.pages?.[OVERRIDE_KEY]).toBeUndefined()
  })

  it('keeps src/modules.ts free of React and Next imports', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/modules.ts'), 'utf8')
    // The compiled CLI artifact inlines everything reachable from here, and
    // Node ESM cannot resolve Next's subpath exports.
    expect(source).not.toMatch(/from\s+['"]next\//)
    expect(source).not.toMatch(/import\(['"][^'"]*components\//)
  })

  it('ships the overlay as exactly two files that hold no logic', () => {
    const dir = path.join(process.cwd(), OVERLAY_DIR)
    expect(fs.readdirSync(dir).sort()).toEqual(['page.meta.ts', 'page.tsx'])
    const page = fs.readFileSync(path.join(dir, 'page.tsx'), 'utf8')
    expect(page).toContain("export { default } from '@/modules/offer_automation/components/inbox-ops/ProposalDetailPage'")
  })

  it('reproduces core page metadata, including the ACL gate', async () => {
    const overlay = (await import('@/modules/inbox_ops/backend/inbox-ops/proposals/[id]/page.meta')) as {
      metadata: Record<string, unknown>
    }
    // Read core's authored values straight from the installed package so a
    // future core change to the gate or breadcrumb shows up as a failure here
    // rather than as a silently diverging page.
    const core = (await import(CORE_META_MODULE)) as { metadata: Record<string, unknown> }
    expect(overlay.metadata).toEqual(core.metadata)
    expect(overlay.metadata.requireFeatures).toEqual(['inbox_ops.proposals.view'])
    expect(overlay.metadata.navHidden).toBe(true)
  })

  it('serves the URL from this app component through a single manifest entry', async () => {
    for (const fileName of ['backend-routes.generated.ts', 'backend-route-metadata.generated.ts']) {
      const generated = readGenerated(fileName)
      const occurrences = generated.split(`resolvePageRouteMetadata("${ROUTE_PATH}"`).length - 1
      expect([fileName, occurrences]).toEqual([fileName, 1])
    }

    const routes = readGenerated('backend-routes.generated.ts')
    expect(routes).toContain(`@/modules/inbox_ops/backend/inbox-ops/proposals/[id]/page`)
    expect(routes).not.toContain('@open-mercato/core/modules/inbox_ops/backend/inbox-ops/proposals')

    const overlay = (await import('@/modules/inbox_ops/backend/inbox-ops/proposals/[id]/page')) as {
      default: { name?: string }
    }
    const owned = (await import('@/modules/offer_automation/components/inbox-ops/ProposalDetailPage')) as {
      default: unknown
    }
    expect(overlay.default).toBe(owned.default)
    expect(overlay.default.name).toBe('ProposalDetailPage')
  })
})
