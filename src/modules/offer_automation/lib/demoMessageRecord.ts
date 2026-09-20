import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
// Core owns the messages leg of an inbound email. `createMessageRecordForEmail`
// is the exact function the installed extraction worker calls
// (node_modules/@open-mercato/core/src/modules/inbox_ops/subscribers/extractionWorker.ts:20),
// so the demo seed produces the same `messages` row a real inbound email would,
// including its recipients, its thread and its `inbox_ops:inbox_email` object
// link. Nothing here writes a messages table directly.
import {
  createMessageRecordForEmail,
  resolveMessageSenderUserId,
} from '@open-mercato/core/modules/inbox_ops/lib/messagesIntegration'
import { getRecipientUserIdsForFeature } from '@open-mercato/core/modules/notifications/lib/notificationRecipients'
import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import {
  getMessageObjectType,
  registerMessageObjectTypes,
} from '@open-mercato/core/modules/messages/lib/message-objects-registry'

/**
 * Audience of an inbox_ops email message. Core hard-codes this feature inside
 * `createMessageRecordForEmail`; it is repeated here only so the preflight can
 * name it in a failure message.
 */
export const MESSAGE_AUDIENCE_FEATURE = 'inbox_ops.proposals.view'

/** Core's last-resort sender when no real user can be found. */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const SELF = 'src/modules/offer_automation/lib/demoMessageRecord.ts'

/**
 * CLI-ONLY COMPATIBILITY SHIM #2. See also `./cliInboxActionRegistry.ts` and
 * `./coreRequiredFeatureShim.ts`.
 *
 * Why it exists
 * -------------
 * `createMessageRecordForEmail` always attaches an `inbox_ops:inbox_email`
 * object, and `messages.messages.compose` rejects an object type the registry
 * does not know (`messages/lib/object-validation.ts:19`). Under Next.js the
 * type is there because `src/bootstrap-common.ts:37` registers the generated
 * set. A CLI process never runs that file: `bootstrapFromAppRoot`
 * (@open-mercato/shared/dist/lib/bootstrap/dynamicLoader.js:435-463) loads
 * modules, entities, DI, search, command loaders, command interceptors and
 * workflows, and no message, message-object or notification registry. Core's
 * registry then self-seeds from the `messages` module's own defaults, which do
 * not include `inbox_ops`, and the compose fails with:
 *
 *   Unsupported message object type: inbox_ops:inbox_email
 *
 * Why the generated registry cannot be imported instead
 * ----------------------------------------------------
 * `@/.mercato/generated/message-objects.generated` pulls every module's
 * `message-objects`, and
 * `@open-mercato/core/src/modules/inbox_ops/message-objects.ts:2` statically
 * imports the React component `InboxEmailPreview`, which reaches
 * `@open-mercato/ui` -> `next/link`. Plain Node cannot resolve that, so the
 * import takes the whole CLI down before any command runs.
 *
 * What this registers
 * -------------------
 * The validation-only half of core's own definition, read from
 * `@open-mercato/core/src/modules/inbox_ops/message-objects.ts:4-20`: the same
 * `module`, `entityType`, `messageTypes`, `labelKey` and `icon`. No
 * `PreviewComponent` and no `actions`, because a CLI renders nothing. The
 * registry is per-process, so every browser path keeps core's real definition,
 * previews and actions included.
 *
 * Removal condition
 * -----------------
 * Delete this function and its one call below as soon as either the CLI
 * bootstrap registers message object types the way `bootstrap-common.ts` does,
 * or core moves `InboxEmailPreview` out of `inbox_ops/message-objects.ts` so
 * that module imports in plain Node and the generated registry can be used
 * directly.
 *
 * @throws if the lookup still fails after registering. A registration that
 * silently does nothing is exactly how this seam was missed once already.
 */
function ensureInboxEmailObjectTypeRegistered(): void {
  // No-op anywhere the real registry already ran, which is every browser path.
  if (getMessageObjectType('inbox_ops', 'inbox_email')) return

  const headlessInboxEmail: MessageObjectTypeDefinition = {
    module: 'inbox_ops',
    entityType: 'inbox_email',
    messageTypes: ['inbox_ops.email', 'inbox_ops.reply'],
    labelKey: 'inbox_ops.title',
    icon: 'mail-open',
    actions: [],
  }
  registerMessageObjectTypes([headlessInboxEmail])

  if (!getMessageObjectType('inbox_ops', 'inbox_email')) {
    throw new Error(
      `[offer_automation] ${SELF} registered inbox_ops:inbox_email with `
        + '`registerMessageObjectTypes` and the registry still does not resolve it. '
        + 'The upstream registry at '
        + '@open-mercato/core/modules/messages/lib/message-objects-registry.ts changed shape; '
        + 'the seeded message cannot be created until this shim is updated or removed.',
    )
  }
}

/** The subset of `InboxEmail` core's helper reads. */
export type SeededEmailForMessage = {
  id: string
  subject: string
  cleanedText?: string | null
  rawText?: string | null
  forwardedByAddress: string
  forwardedByName?: string | null
  status: string
}

export type DemoMessageOutcome =
  | {
      ok: true
      messageId: string
      senderUserId: string
      recipientCount: number
      /**
       * The users core addressed the message to. Returned so the caller can
       * print their addresses: an operator whose inbox looks empty needs to be
       * told WHICH login sees the thread, and a hardcoded answer would go stale
       * the moment the audience feature moves to another role.
       */
      recipientUserIds: string[]
    }
  | { ok: false; reason: string; hints: string[] }

/**
 * Creates the `messages` record for a seeded demo email, the way the extraction
 * worker would have.
 *
 * Why the preflight exists
 * -----------------------
 * `createMessageRecordForEmail` degrades gracefully: it logs and returns `null`
 * when anything is missing, and when no recipient holds the audience feature it
 * still writes a message whose sender is the zero UUID. That is right for a
 * worker handling live mail, and wrong for a seed command, where a silently
 * half-written demo is worse than a refusal. So the two inputs core resolves
 * internally are resolved first, with core's own exported helpers, and a missing
 * one is named instead of guessed.
 *
 * The call itself still goes through core. This function never invents a user
 * id and never writes `messages`, `message_recipients` or `message_objects`.
 */
export async function createDemoMessageRecord(
  container: AwilixContainer,
  email: SeededEmailForMessage,
  scope: { tenantId: string; organizationId: string },
): Promise<DemoMessageOutcome> {
  ensureInboxEmailObjectTypeRegistered()

  const em = container.resolve('em') as EntityManager

  const recipientUserIds = await getRecipientUserIdsForFeature(
    em.getKysely(),
    scope.tenantId,
    MESSAGE_AUDIENCE_FEATURE,
  )
  if (recipientUserIds.length === 0) {
    return {
      ok: false,
      reason: `No user in tenant ${scope.tenantId} holds ${MESSAGE_AUDIENCE_FEATURE}, so the message would have no recipient and no real sender.`,
      hints: [
        `Grant ${MESSAGE_AUDIENCE_FEATURE} to a role held by a user in this tenant, then re-run:`,
        `  yarn mercato auth sync-role-acls --tenant ${scope.tenantId}`,
        'Or skip the messages leg for this run with --no-message.',
      ],
    }
  }

  // Same resolution core performs inside the helper: the forwarding user if the
  // address matches a login, otherwise the first user who can see proposals.
  const senderUserId = await resolveMessageSenderUserId(
    em,
    email.forwardedByAddress,
    recipientUserIds,
    scope,
  )
  if (!senderUserId || senderUserId === SYSTEM_USER_ID) {
    return {
      ok: false,
      reason: `Could not resolve a real sender user for ${email.forwardedByAddress}; core would have fallen back to the system user ${SYSTEM_USER_ID}.`,
      hints: [
        `Ensure at least one non-deleted user in tenant ${scope.tenantId} holds ${MESSAGE_AUDIENCE_FEATURE}.`,
        'Or skip the messages leg for this run with --no-message.',
      ],
    }
  }

  const messageId = await createMessageRecordForEmail(email, {
    container,
    // `userId` is unused on the email path (core re-resolves the sender itself),
    // and the worker passes its system constant here. The already-verified
    // sender is passed instead so no zero UUID ever leaves this command.
    scope: { ...scope, userId: senderUserId },
  })

  if (!messageId) {
    return {
      ok: false,
      reason: 'Core refused to create the message record and returned null.',
      hints: [
        'Core logs the cause under logger "inbox_ops" / component "messages"; the usual reason is an unavailable command bus.',
        'Re-run with --no-message to seed the proposal without the messages leg.',
      ],
    }
  }

  return {
    ok: true,
    messageId,
    senderUserId,
    recipientCount: recipientUserIds.length,
    recipientUserIds,
  }
}
