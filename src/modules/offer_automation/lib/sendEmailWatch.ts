import { EXTRACTION_FAILURE_PREFIX } from './freightExtraction'

/** Everything `send-email` reads back while it watches. Written by nobody here. */
export type WatchState = {
  proposalId: string | null
  actionId: string | null
  actionStatus: string | null
  executionError: string | null
  emailStatus: string
  processingError: string | null
  quoteId: string | null
  quoteNumber: string | null
  quoteTotal: string | null
  quoteCurrency: string | null
  customerEntityId: string | null
  executedByUserId: string | null
  notificationCount: number
}

/**
 * True once nothing more is going to change without a human.
 *
 * A `failed` email is NOT the end of the road. Core's extraction subscriber
 * fails first on this install and this module's own extraction then takes the
 * email over, so the watch keeps looking until the failure is OURS — which is
 * exactly what `EXTRACTION_FAILURE_PREFIX` marks. Stopping on the first
 * `failed` made the command report "no quote" about eight seconds before the
 * quote appeared.
 */
export function watchSettled(state: WatchState): boolean {
  if (state.quoteId) return true
  if (state.actionStatus === 'failed' || state.actionStatus === 'rejected') return true
  if (state.emailStatus !== 'failed') return false
  return (state.processingError ?? '').startsWith(EXTRACTION_FAILURE_PREFIX)
}

/**
 * Why the watch window closed with nothing to show.
 *
 * The two causes need different advice and look identical from the outside
 * unless the email row is read: an email nobody has touched is still exactly as
 * `send-email` wrote it, while an email somebody IS working on has already been
 * claimed into `processing` or failed once. Telling an operator to start a
 * worker they already have running wastes the minute they have on stage.
 */
export function describeUnsettled(state: WatchState): 'nothing-reacted' | 'still-working' {
  const untouched = state.emailStatus === 'received' && !state.processingError && !state.proposalId
  return untouched ? 'nothing-reacted' : 'still-working'
}
