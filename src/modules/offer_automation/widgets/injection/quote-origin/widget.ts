import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import QuoteOriginWidget from './widget.client'

/**
 * Backward leg of the trail: sales quote -> the inbox request that produced it.
 *
 * Mounted on the quote detail page rather than the quotes grid on purpose. The
 * grid's API deliberately drops `metadata` from its projection
 * (node_modules/@open-mercato/core/src/modules/sales/api/documents/factory.ts,
 * `detailOnlyProjectionFields`) and does not run response enrichers for quotes
 * (same file, `enrichers: binding.kind === 'order' ? ... : undefined`), so a
 * `data-table:sales.quotes:columns` widget would have no proposal id to read.
 * The detail page fetches the full projection, so the id is already there.
 *
 * Gated on `inbox_ops.proposals.view`: a user who cannot open the proposal page
 * should not be shown a link into it.
 */
const widget: InjectionWidgetModule = {
  metadata: {
    id: 'offer_automation.injection.quote-origin',
    title: 'Inbox request origin',
    description: 'Links a sales quote back to the inbox proposal it was created from.',
    features: ['inbox_ops.proposals.view'],
    requiredModules: ['sales', 'inbox_ops'],
    priority: 20,
  },
  Widget: QuoteOriginWidget,
}

export default widget
