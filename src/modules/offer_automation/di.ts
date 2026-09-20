import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { applyCoreRequiredFeatureShim } from './lib/coreRequiredFeatureShim'

/**
 * This module registers no services. The registrar exists only as the
 * deterministic call site for the required-feature shim: every request builds
 * a container before any inbox action executes, so calling it here is ordered,
 * unlike relying on module import side effects.
 *
 * See `./lib/coreRequiredFeatureShim.ts` for why the shim exists and the exact
 * condition under which it must be deleted.
 */
export function register(_container: AppContainer) {
  applyCoreRequiredFeatureShim()
}
