import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Grants the app-owned `offer_automation.offers.draft` feature to the same
 * built-in roles that `inbox_ops` grants its proposal features to, so an
 * operator already able to open the proposal review page can also accept a
 * `draft_offer` action without hand-editing any role in the admin UI.
 *
 * Applied by `mercato init` and re-applied idempotently by
 * `mercato auth sync-role-acls --tenant <id>`.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['offer_automation.*'],
    admin: ['offer_automation.offers.draft'],
    employee: ['offer_automation.offers.draft'],
  },
}

export default setup
