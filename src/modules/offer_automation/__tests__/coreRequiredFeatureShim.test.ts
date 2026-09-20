// Explicit imports rather than ambient globals: this app ships no test files
// yet, so `@types/jest` is not wired into the tsconfig `typeRoots` resolution
// and `yarn typecheck` would otherwise fail on `describe`/`it`/`expect`.
import { afterEach, describe, expect, it } from '@jest/globals'
import { REQUIRED_FEATURES_MAP } from '@open-mercato/core/modules/inbox_ops/lib/constants'
import { applyCoreRequiredFeatureShim } from '../lib/coreRequiredFeatureShim'
import { DRAFT_OFFER_ACTION_TYPE, DRAFT_OFFER_REQUIRED_FEATURE } from '../inbox-actions'

/**
 * Pins the shim's contract. If core ever freezes or pre-fills
 * `REQUIRED_FEATURES_MAP`, the "throws rather than degrades" case below is the
 * one that should start failing, which is the signal to delete the shim.
 */
describe('applyCoreRequiredFeatureShim', () => {
  const map = REQUIRED_FEATURES_MAP as unknown as Record<string, string | undefined>

  afterEach(() => {
    delete map[DRAFT_OFFER_ACTION_TYPE]
  })

  it('starts from a core map that does not know the app-owned action type', () => {
    expect(map[DRAFT_OFFER_ACTION_TYPE]).toBeUndefined()
    // The built-in keys the execution engine relies on are untouched.
    expect(map.create_quote).toBe('sales.quotes.manage')
  })

  it('registers the app-owned feature for the app-owned action type', () => {
    applyCoreRequiredFeatureShim()
    expect(map[DRAFT_OFFER_ACTION_TYPE]).toBe(DRAFT_OFFER_REQUIRED_FEATURE)
  })

  it('is idempotent', () => {
    applyCoreRequiredFeatureShim()
    expect(() => applyCoreRequiredFeatureShim()).not.toThrow()
    expect(map[DRAFT_OFFER_ACTION_TYPE]).toBe(DRAFT_OFFER_REQUIRED_FEATURE)
  })

  it('throws rather than degrades when the key is already claimed by something else', () => {
    map[DRAFT_OFFER_ACTION_TYPE] = 'someone.else.feature'
    expect(() => applyCoreRequiredFeatureShim()).toThrow(/already mapped to "someone\.else\.feature"/)
  })

  it('does not invent a feature the module has not declared', async () => {
    const { features } = await import('../acl')
    expect(features.map((f) => f.id)).toContain(DRAFT_OFFER_REQUIRED_FEATURE)
  })
})
