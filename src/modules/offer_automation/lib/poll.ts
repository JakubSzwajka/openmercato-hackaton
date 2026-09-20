/**
 * Polling primitives shared by the two places that wait for another runner.
 *
 * Both the CLI's live-extraction watcher and the inbound-email subscriber wait
 * for a row someone else writes: the events worker in one case, whichever
 * extraction handler won the claim in the other. They had their own copies of
 * the same interval and the same `sleep`, which is exactly the kind of pair
 * that drifts silently once one side is tuned.
 */

/** How long to wait between reads while polling for another runner's write. */
export const POLL_INTERVAL_MS = 750

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
