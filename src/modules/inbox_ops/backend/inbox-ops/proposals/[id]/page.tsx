// App overlay of core's proposal detail page.
//
// `scanModuleDir` (@open-mercato/cli/src/lib/generators/scanner.ts:179-186)
// keys every discovered module file by its logical path and writes the app copy
// last, so this file replaces core's page rather than adding a second
// route-manifest entry for `/backend/inbox-ops/proposals/[id]`.
//
// The component and all of its helpers stay in `offer_automation`. This file is
// a re-export only, so the overlay owns no logic.
export { default } from '@/modules/offer_automation/components/inbox-ops/ProposalDetailPage'
