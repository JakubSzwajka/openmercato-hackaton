export const metadata = {
  requireAuth: true,
  // The page shows a request and the quote it produced side by side, so it
  // needs both view rights. The API behind it requires the same pair.
  requireFeatures: ['inbox_ops.proposals.view', 'sales.quotes.view'],
  pageTitle: 'Offer origins',
  pageTitleKey: 'offer_automation.origins.page.title',
  pageGroup: 'Sales',
  pageGroupKey: 'offer_automation.origins.nav.group',
  pageOrder: 250,
  icon: 'link',
  breadcrumb: [{ label: 'Offer origins', labelKey: 'offer_automation.origins.page.title' }],
}
