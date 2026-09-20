import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * One statically foldable object literal, no env branching: the fact extractor
 * can only read a statically known value, and a table built by a ternary
 * publishes zero contributions.
 *
 * The spot id below is the `sales.document.detail.{kind}:{surface}` pattern
 * from the sales module's FROZEN host declaration
 * (`.ai/guides/modules/sales/umes-hosts.md`), resolved with kind=quote and
 * surface=details. It is inert when `sales` is absent, because only that module
 * renders the spot, and the widget also declares `requiredModules`.
 */
export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.quote:details': {
    widgetId: 'offer_automation.injection.quote-origin',
    priority: 20,
  },
}

export default injectionTable
