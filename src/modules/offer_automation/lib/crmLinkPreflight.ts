import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
// The exact function core uses when it prices an accepted `draft_offer`
// (`sales/inbox-actions.ts:76`). Calling it here, read-only, is what makes the
// command's answer the same answer the quote will get; a second lookup written
// by hand could disagree with it.
import { resolveCustomerEntityIdByEmail } from '@open-mercato/core/modules/inbox_ops/lib/executionHelpers'
import type { ExecutionHelperContext } from '@open-mercato/core/modules/inbox_ops/lib/executionHelpers'

export type CrmLinkPreflight = {
  email: string
  /** The CRM customer this quote will be attached to, or `null`. */
  customerEntityId: string | null
  /** Lines the command prints when there is no match. */
  explanation: string[]
}

/**
 * Answers "will the quote link to a CRM customer?" before the chain runs.
 *
 * An unknown sender is a legitimate outcome, not a failure: `executeDraftOffer`
 * falls back to a `customerSnapshot` and the quote is created as normal. It is
 * reported because it is invisible otherwise, and an operator who typed their
 * own `--from` and then found a quote with no customer will read it as a bug.
 *
 * Read-only. Resolution failures are swallowed on purpose: this is a courtesy
 * lookup, and it must never be the reason an email does not get sent.
 */
export async function preflightCrmLink(
  container: AwilixContainer,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  email: string,
): Promise<CrmLinkPreflight> {
  let customerEntityId: string | null = null
  try {
    const ctx = {
      em,
      container,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      // No write happens through this context, so no actor is needed. Core reads
      // `userId` only on the command paths, which are not reached here.
      userId: '',
    } as unknown as ExecutionHelperContext
    customerEntityId = await resolveCustomerEntityIdByEmail(ctx, email)
  } catch {
    return {
      email,
      customerEntityId: null,
      explanation: [
        'Could not check the CRM from here; the acceptance will do its own lookup.',
      ],
    }
  }

  if (customerEntityId) {
    return { email, customerEntityId, explanation: [] }
  }

  return {
    email,
    customerEntityId: null,
    explanation: [
      `No CRM customer in this organization has the primary email ${email}.`,
      'That is not an error: the quote is still created, carrying a customer',
      'snapshot (name + email) instead of a link to a customer record.',
      'Use an address of a seeded contact to see the linked case.',
    ],
  }
}
