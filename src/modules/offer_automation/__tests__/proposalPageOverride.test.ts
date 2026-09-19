// Explicit imports rather than ambient globals, for the same reason as
// `coreRequiredFeatureShim.test.ts`: `@types/jest` is not in the tsconfig
// typeRoots resolution for this app.
import { describe, expect, it } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyModuleOverridesFromEnabledModules,
  applyPageOverridesToManifests,
  composePageRouteOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'
import { enabledModules } from '@/modules'

const ROUTE_PATH = '/backend/inbox-ops/proposals/[id]'
const OVERRIDE_KEY = `backend:${ROUTE_PATH}`

/**
 * Proves the page replacement is wired the way the runtime reads it.
 *
 * `yarn generate` does NOT bake the override into the generated registry: the
 * route shards still list core's loader, and the swap happens later, when
 * `registerBackendRouteManifests` (`@open-mercato/shared/modules/registry.ts:432`)
 * runs `applyPageOverridesToManifests` over the composed override store. The
 * app's `bootstrap-common.ts` calls `applyModuleOverridesFromEnabledModules`
 * at import time, before the backend catch-all registers the manifests, so the
 * store is populated by then. This test reproduces exactly that sequence.
 */
describe('inbox_ops proposal detail page override', () => {
  it('is declared on the inbox_ops module entry', () => {
    const entry = enabledModules.find((module) => module.id === 'inbox_ops')
    expect(entry).toBeDefined()
    const override = entry?.overrides?.routes?.pages?.[OVERRIDE_KEY]
    expect(override).toBeTruthy()
    expect(typeof (override as { load?: unknown })?.load).toBe('function')
    // Metadata is intentionally absent: the override must keep core's title,
    // breadcrumb, `navHidden` and `inbox_ops.proposals.view` feature gate.
    expect((override as { metadata?: unknown })?.metadata).toBeUndefined()
  })

  it('replaces the loader on that route and leaves every other route alone', () => {
    resetModuleContractOverridesForTests()
    try {
      applyModuleOverridesFromEnabledModules(enabledModules)
      const composed = composePageRouteOverrides()
      expect(Object.keys(composed)).toContain(OVERRIDE_KEY)

      const coreLoad = async () => (() => null) as unknown as never
      const otherLoad = async () => (() => null) as unknown as never
      const manifests = [
        { moduleId: 'inbox_ops', pattern: ROUTE_PATH, load: coreLoad },
        { moduleId: 'inbox_ops', pattern: '/backend/inbox-ops', load: otherLoad },
      ] as never[]

      const result = applyPageOverridesToManifests(manifests, composed, 'backend') as Array<{
        pattern?: string
        load: unknown
      }>

      const replaced = result.find((route) => route.pattern === ROUTE_PATH)
      expect(replaced).toBeDefined()
      expect(replaced?.load).not.toBe(coreLoad)

      const untouched = result.find((route) => route.pattern === '/backend/inbox-ops')
      expect(untouched?.load).toBe(otherLoad)
    } finally {
      resetModuleContractOverridesForTests()
    }
  })

  it('loads this app module as the page component', async () => {
    const entry = enabledModules.find((module) => module.id === 'inbox_ops')
    const override = entry?.overrides?.routes?.pages?.[OVERRIDE_KEY] as {
      load: () => Promise<unknown>
    }
    const component = await override.load()
    expect(typeof component).toBe('function')
    expect((component as { name?: string }).name).toBe('ProposalDetailPage')
  })

  it('adds no second app route at the same URL', () => {
    // A `page.tsx` under `src/modules/offer_automation/backend/inbox-ops/**`
    // would generate a competing manifest entry for this URL; the override
    // exists precisely so there is only ever one.
    const registry = fs.readFileSync(
      path.join(process.cwd(), '.mercato/generated/backend-route-metadata.generated.ts'),
      'utf8',
    )
    const occurrences = registry.split(`resolvePageRouteMetadata("${ROUTE_PATH}"`).length - 1
    expect(occurrences).toBe(1)
  })
})
