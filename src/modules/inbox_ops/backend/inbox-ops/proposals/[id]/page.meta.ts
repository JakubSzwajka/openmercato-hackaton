// App overlay of core's page metadata for `/backend/inbox-ops/proposals/[id]`.
// `processPageFiles` reads the meta file from the same root as the page file
// (`moduleBaseDir = fromApp ? appDir : pkgDir`), so the overlay page needs its
// own copy. Values are copied verbatim from
// `@open-mercato/core/src/modules/inbox_ops/backend/inbox-ops/proposals/[id]/page.meta.ts`
// so the ACL gate, title, group, hidden nav entry and breadcrumb do not drift.
export const metadata = {
  requireAuth: true,
  requireFeatures: ['inbox_ops.proposals.view'],
  pageTitle: 'Proposal',
  pageTitleKey: 'inbox_ops.nav.proposal_detail',
  pageGroup: 'AI Inbox Actions',
  pageGroupKey: 'inbox_ops.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'AI Inbox Actions', labelKey: 'inbox_ops.nav.group', href: '/backend/inbox-ops' },
    { label: 'Proposal', labelKey: 'inbox_ops.nav.proposal_detail' },
  ],
}
