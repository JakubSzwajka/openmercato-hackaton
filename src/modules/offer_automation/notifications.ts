import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * What the sales desk hears when the machine has been working.
 *
 * TWO TYPES, BECAUSE THERE ARE TWO OUTCOMES. A drafted quote is the happy end
 * of the flow and goes to whoever may read quotes. A refused draft — a line the
 * catalogue cannot price — is the failure the operator specifically must not
 * miss, so it is a separate type, at `error` severity, addressed to the people
 * who can fix it and pointing at the proposal where the action is retryable.
 *
 * AUDIENCE IS A FEATURE, NEVER A USER. Both are delivered with
 * `createForFeature`, which fans out to every user in the tenant whose ACL
 * holds that feature (`notificationRecipients.ts:78`). Nothing here names a
 * person, a role or a seeded id, so the same code is correct in a tenant this
 * demo never saw. See `QUOTE_AUDIENCE_FEATURE` and `DRAFT_AUDIENCE_FEATURE` in
 * `subscribers/draft-offer-executor.ts` for which feature each one uses.
 *
 * `in_app` only. Core's `inbox_ops.proposal.created` also ships `email`, and an
 * app-owned demo that could send mail to a real address is not a thing to
 * enable by default.
 */
export const QUOTE_DRAFTED_NOTIFICATION_TYPE = 'offer_automation.quote.drafted'
export const QUOTE_DRAFT_FAILED_NOTIFICATION_TYPE = 'offer_automation.quote.draft_failed'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: QUOTE_DRAFTED_NOTIFICATION_TYPE,
    module: 'offer_automation',
    channels: ['in_app'],
    titleKey: 'offer_automation.notifications.quoteDrafted.title',
    bodyKey: 'offer_automation.notifications.quoteDrafted.body',
    icon: 'file-text',
    severity: 'info',
    actions: [
      {
        id: 'review',
        labelKey: 'offer_automation.notifications.quoteDrafted.action.review',
        variant: 'outline',
        href: '/backend/sales/quotes/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/sales/quotes/{sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: QUOTE_DRAFT_FAILED_NOTIFICATION_TYPE,
    module: 'offer_automation',
    channels: ['in_app'],
    titleKey: 'offer_automation.notifications.quoteDraftFailed.title',
    bodyKey: 'offer_automation.notifications.quoteDraftFailed.body',
    icon: 'alert-triangle',
    severity: 'error',
    actions: [
      {
        id: 'open-proposal',
        labelKey: 'offer_automation.notifications.quoteDraftFailed.action.open',
        variant: 'outline',
        href: '/backend/inbox-ops/proposals/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/inbox-ops/proposals/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
