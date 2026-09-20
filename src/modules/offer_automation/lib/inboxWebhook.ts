import { createHmac } from 'node:crypto'
// Knowing exception, and the narrowest one in this module: `parseInboundEmail`
// is READ-ONLY and pure. It is imported so `send-email` can compute the exact
// `content_hash` core will compute from the same payload, which is the only way
// to tell "core deduplicated my email" apart from "core never saw it". Copying
// the hash recipe here instead would drift the moment core changes it. Same
// standing as the note at the top of `freightExtraction.ts`: no entity of ours
// is involved, nothing is persisted, and no relation is declared.
import { parseInboundEmail } from '@open-mercato/core/modules/inbox_ops/lib/emailParser'

/** Env var the inbound webhook reads its HMAC secret from. Never printed. */
export const WEBHOOK_SECRET_ENV = 'INBOX_OPS_WEBHOOK_SECRET'

/** Path of core's inbound-email webhook, served by the catch-all API route. */
export const INBOUND_WEBHOOK_PATH = '/api/inbox_ops/webhook/inbound'

/**
 * The payload core's custom-provider webhook accepts.
 *
 * Mirrors the zod document at the bottom of
 * `inbox_ops/api/webhook/inbound.ts`. Every field is optional there; `to` is
 * the one that matters, because it is the only thing that selects a tenant.
 */
export type InboundWebhookPayload = {
  from?: string
  to?: string
  subject?: string
  text?: string
  html?: string
  messageId?: string
  replyTo?: string
  inReplyTo?: string
  references?: string[]
}

export type SignedWebhookRequest = {
  body: string
  headers: Record<string, string>
}

/**
 * The HMAC core verifies: `hmac_sha256(secret, "<timestamp>.<rawBody>")`, hex.
 *
 * Kept as a one-line pure function so a unit test can pin it against a known
 * secret, timestamp and body. Every other part of the POST is I/O.
 */
export function buildWebhookSignature(input: {
  secret: string
  timestamp: string
  rawBody: string
}): string {
  return createHmac('sha256', input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest('hex')
}

/**
 * Serialises and signs one payload.
 *
 * The body is serialised ONCE and both signed and sent, because the signature
 * covers the raw bytes: re-serialising before the POST would be a different
 * string the moment key order or number formatting changed.
 *
 * The timestamp is unix SECONDS. Core rejects anything more than five minutes
 * from its own clock, so a machine with a badly skewed clock gets a 400 rather
 * than a silent drop.
 */
export function signWebhookRequest(input: {
  payload: InboundWebhookPayload
  secret: string
  now?: Date
}): SignedWebhookRequest {
  const body = JSON.stringify(input.payload)
  const timestamp = String(Math.floor((input.now ?? new Date()).getTime() / 1000))
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-webhook-timestamp': timestamp,
      'x-webhook-signature': buildWebhookSignature({ secret: input.secret, timestamp, rawBody: body }),
    },
  }
}

export type WebhookPostResult =
  | { ok: true; status: number; body: string }
  | { ok: false; kind: 'http'; status: number; body: string }
  | { ok: false; kind: 'unreachable'; detail: string }

/**
 * POSTs the signed payload and reports what came back, verbatim.
 *
 * A refused connection is reported as its own kind, because it has a different
 * cause (no server) and a different fix (start one, or use the offline `demo`
 * command) from every HTTP status core can return.
 */
export async function postInboundWebhook(input: {
  url: string
  signed: SignedWebhookRequest
  timeoutMs?: number
}): Promise<WebhookPostResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000)
  try {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: input.signed.headers,
      body: input.signed.body,
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok) return { ok: false, kind: 'http', status: response.status, body }
    return { ok: true, status: response.status, body }
  } catch (err) {
    return { ok: false, kind: 'unreachable', detail: (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The `content_hash` core will store for this payload.
 *
 * Core dedupes on `message_id` OR `content_hash`, per tenant+organization, with
 * NO time window. So the same subject, sender and body can only ever be
 * accepted once in a given organization, and the second attempt is answered
 * with the same `{"ok":true}` as the first. Computing the hash here is what
 * lets the command say so instead of reporting a mystery.
 */
export function webhookContentHash(payload: InboundWebhookPayload): string {
  return parseInboundEmail({
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    messageId: payload.messageId,
    replyTo: payload.replyTo,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
  }).contentHash
}

/**
 * What a `200 {"ok":true}` actually meant.
 *
 * Core answers 200 for a stored email, for an unknown recipient address and for
 * a duplicate. The only way to tell them apart is to read the database back, so
 * this function turns those three reads into one verdict. Pure on purpose: the
 * reads are the caller's, the decision is testable.
 */
export type WebhookOutcome =
  | { kind: 'stored'; inboxEmailId: string }
  | { kind: 'duplicate'; existingInboxEmailId: string }
  | { kind: 'unknown-inbox' }
  | { kind: 'unexplained' }

export function decideWebhookOutcome(input: {
  /** Id of the row carrying the `messageId` we sent, or null if none appeared. */
  storedInboxEmailId: string | null
  /** Id of a pre-existing row carrying the same `contentHash`, or null. */
  duplicateInboxEmailId: string | null
  /** Whether an active `inbox_settings` row still owns the address we sent to. */
  inboxSettingsPresent: boolean
}): WebhookOutcome {
  if (input.storedInboxEmailId) return { kind: 'stored', inboxEmailId: input.storedInboxEmailId }
  if (input.duplicateInboxEmailId) {
    return { kind: 'duplicate', existingInboxEmailId: input.duplicateInboxEmailId }
  }
  if (!input.inboxSettingsPresent) return { kind: 'unknown-inbox' }
  return { kind: 'unexplained' }
}

/**
 * The operator-facing explanation of a non-`stored` outcome.
 *
 * Returned as lines rather than printed so the wording can be pinned by a test:
 * these three paragraphs are the whole difference between a demo that can be
 * fixed in ten seconds and one that looks broken.
 */
export function describeWebhookOutcome(
  outcome: WebhookOutcome,
  context: { toAddress: string; tenantId: string; organizationId: string; messageId: string },
): string[] {
  switch (outcome.kind) {
    case 'stored':
      return []
    case 'duplicate':
      return [
        'Core DEDUPLICATED this email. It answered 200 and wrote nothing.',
        `  existing inboxEmailId: ${outcome.existingInboxEmailId}`,
        'Deduplication matches on subject + sender + the first 500 characters of the',
        'body, per organization, with no time window at all. So the built-in enquiry',
        'can only ever be accepted once here.',
        'Vary the body and it goes through:',
        '  --note "Collection is now Friday."',
        '  --body "..."  /  --body-file ./enquiry.txt',
      ]
    case 'unknown-inbox':
      return [
        `No active inbox_settings row owns ${context.toAddress} any more.`,
        'Core answers 200 for an unknown recipient and writes nothing, on purpose:',
        'the endpoint is public, so it must not tell a caller which addresses exist.',
        'Recreate the demo inbox (idempotent):',
        '  yarn mercato offer_automation seed-demo',
      ]
    case 'unexplained':
      return [
        'Core answered 200 but no inbox email carries the message id we sent, and',
        'nothing here explains why. This is what was sent:',
        `  to:              ${context.toAddress}`,
        `  messageId:       ${context.messageId}`,
        `  tenantId:        ${context.tenantId}`,
        `  organizationId:  ${context.organizationId}`,
        'Check the dev-server log for the inbox_ops webhook. A row that the server was',
        'still flushing when the poll window closed looks the same from here, so read',
        'the list once more before assuming it was lost:',
        `  yarn mercato offer_automation origins --tenant ${context.tenantId} --org ${context.organizationId}`,
      ]
  }
}
