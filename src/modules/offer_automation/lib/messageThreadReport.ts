import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
// Read-only. `Message` is imported for its `thread_id` column and nothing else;
// the row itself was written by core through `messages.messages.compose`, never
// by this module. Subjects and bodies are encrypted at rest, so nothing here
// reads them.
import { Message } from '@open-mercato/core/modules/messages/data/entities'

/**
 * Turns the ids a seeded message leaves behind into something an operator can
 * act on: a URL, a login and a tenant name.
 *
 * It exists because the demo's most common "bug" is not a bug. The thread is
 * written, the rows are in the database, and the operator is signed in as a
 * user of a different tenant whose inbox is legitimately empty. The Messages
 * list only shows threads you are a recipient of
 * (`messages/api/route.ts:181-189`, folder `inbox` joins `message_recipients`
 * on your own user id), so the only useful answer is "sign in as this person,
 * in this tenant".
 */

/**
 * Direct link to one message thread.
 *
 * Route: `/backend/messages/[id]`, from
 * `.ai/guides/modules/messages/backend-pages.md`, source
 * `node_modules/@open-mercato/core/src/modules/messages/backend/messages/[id]/page.tsx`.
 * The `[id]` segment is the MESSAGE id: the page passes `params.id` straight
 * into `MessageDetailPageClient`, which loads that message and then renders its
 * whole thread.
 */
export function messageThreadUrl(baseUrl: string, messageId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/backend/messages/${messageId}`
}

export type ThreadRecipient = { userId: string; email: string }

export type MessageThreadReport = {
  messageId: string
  /** `null` when core gave the message no thread; the URL still resolves. */
  threadId: string | null
  /** Display name of the tenant that owns the thread, for the login hint. */
  tenantName: string | null
  /** Recipients by address, resolved from `auth.users`, never hardcoded. */
  recipients: ThreadRecipient[]
  /** Address of the user core recorded as the sender. */
  senderEmail: string | null
}

/**
 * Reads back what core wrote, so the command can name it.
 *
 * Every value is resolved: the recipient ids come from the outcome of the
 * message creation, their addresses from `auth.users`, the tenant name from
 * `directory.tenants`. Nothing is a literal.
 */
export async function describeMessageThread(
  em: EntityManager,
  input: {
    messageId: string
    recipientUserIds: string[]
    senderUserId: string | null
    tenantId: string
  },
): Promise<MessageThreadReport> {
  const message = (await em.findOne(Message, { id: input.messageId } as never)) as {
    threadId?: string | null
  } | null

  const tenant = (await em.findOne(Tenant, { id: input.tenantId } as never)) as {
    name?: string | null
  } | null

  const userIds = Array.from(
    new Set([...input.recipientUserIds, ...(input.senderUserId ? [input.senderUserId] : [])]),
  )
  const users = userIds.length
    ? ((await em.find(User, { id: { $in: userIds } } as never)) as unknown as Array<{
        id: string
        email: string
      }>)
    : []
  const emailById = new Map(users.map((user) => [user.id, user.email]))

  return {
    messageId: input.messageId,
    threadId: message?.threadId ?? null,
    tenantName: tenant?.name ?? null,
    recipients: input.recipientUserIds.map((userId) => ({
      userId,
      email: emailById.get(userId) ?? '<user not found>',
    })),
    senderEmail: input.senderUserId ? emailById.get(input.senderUserId) ?? null : null,
  }
}

/**
 * The "why is my inbox empty" block, in words an operator can act on.
 *
 * Deliberately names one login rather than listing options first: the operator
 * reading this has already opened an empty list and wants the next click, not a
 * lesson about recipient scoping.
 */
export function describeWhoCanSeeThread(report: MessageThreadReport): string[] {
  const lines: string[] = []
  const first = report.recipients[0]
  const tenant = report.tenantName ? `"${report.tenantName}"` : '<tenant name unknown>'

  if (first && first.email !== '<user not found>') {
    lines.push(`Sign in as ${first.email} in tenant ${tenant} to see it.`)
  } else {
    lines.push(`Sign in as a user of tenant ${tenant} who is a recipient below.`)
  }
  if (report.recipients.length > 1) {
    const others = report.recipients.slice(1).map((r) => r.email)
    lines.push(`Also visible to: ${others.join(', ')}.`)
  }
  lines.push(
    'The Messages inbox lists only threads you are a recipient of, so a user of any',
    'other tenant sees an empty list here and nothing is wrong.',
  )
  return lines
}
