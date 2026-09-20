/**
 * UNSUPPORTED RUNTIME PATCH of an installed module's exported object.
 *
 * Why it exists
 * -------------
 * `inbox_ops` discovers app-owned actions from a module-root `inbox-actions.ts`
 * and each definition carries its own `requiredFeature`. The execution engine
 * does NOT read that field. It resolves the RBAC feature from a hand-written
 * map instead:
 *
 *   node_modules/@open-mercato/core/src/modules/inbox_ops/lib/executionEngine.ts:454
 *     -> getRequiredFeatureForAction()            (same file, :571-579)
 *     -> REQUIRED_FEATURES_MAP[action.actionType]
 *   node_modules/@open-mercato/core/src/modules/inbox_ops/lib/constants.ts:12-22
 *     -> Record<InboxActionType, string>, closed union, nine built-in keys
 *
 * An app-owned action type is absent from that map, so `executionEngine.ts:456`
 * throws 403 "No required feature is mapped for action type ..." before the
 * generated registry is ever loaded and before the RBAC check runs. Super-admin
 * does not bypass it, because the throw happens first.
 *
 * Upstream already knows: `constants.ts:4-10` documents the duplication and
 * carries a TODO to consolidate with the generated registry.
 *
 * This file adds our key to that map so the engine can reach our `execute`.
 * It adds NOTHING else. The RBAC check at `executionEngine.ts:474-482` still
 * runs against the feature we register, and still denies a user who lacks it.
 *
 * Removal condition
 * -----------------
 * Delete this file and the single `applyCoreRequiredFeatureShim()` call in
 * `../di.ts` as soon as core either reads `definition.requiredFeature` from the
 * generated inbox-action registry, or exposes a registration API for the map.
 * The assertions below are designed to make that moment loud: a core version
 * that freezes or pre-fills the map fails boot with a readable error rather
 * than degrading into an unexplainable 403.
 */
import { REQUIRED_FEATURES_MAP } from '@open-mercato/core/modules/inbox_ops/lib/constants'
import { DRAFT_OFFER_ACTION_TYPE, DRAFT_OFFER_REQUIRED_FEATURE } from '../inbox-actions'

const SELF = 'src/modules/offer_automation/lib/coreRequiredFeatureShim.ts'
const UPSTREAM = '@open-mercato/core/modules/inbox_ops/lib/constants.ts:12-22'

function fail(what: string): never {
  throw new Error(
    `[offer_automation] ${SELF} cannot patch the inbox_ops required-feature map: ${what}. ` +
      `Upstream shape at ${UPSTREAM} changed. Either core now resolves requiredFeature from the ` +
      `generated inbox-action registry (delete this shim and its call in src/modules/offer_automation/di.ts), ` +
      `or it claims "${DRAFT_OFFER_ACTION_TYPE}" for something else (rename our action type).`,
  )
}

/**
 * Registers `draft_offer -> offer_automation.offers.draft` in the core map.
 *
 * Idempotent: a second call is a no-op. Throws rather than degrading when the
 * upstream map is missing, frozen, or already holds a conflicting value.
 */
export function applyCoreRequiredFeatureShim(): void {
  const map: unknown = REQUIRED_FEATURES_MAP

  if (map === null || typeof map !== 'object') {
    fail('REQUIRED_FEATURES_MAP is not an object')
  }
  if (Object.isFrozen(map)) {
    fail('REQUIRED_FEATURES_MAP is frozen')
  }

  const writable = map as Record<string, string>
  const existing = writable[DRAFT_OFFER_ACTION_TYPE]

  if (existing === DRAFT_OFFER_REQUIRED_FEATURE) return
  if (existing !== undefined) {
    fail(`"${DRAFT_OFFER_ACTION_TYPE}" is already mapped to "${existing}"`)
  }

  writable[DRAFT_OFFER_ACTION_TYPE] = DRAFT_OFFER_REQUIRED_FEATURE
}
