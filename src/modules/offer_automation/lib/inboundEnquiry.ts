/**
 * The customer email the demo is built around, in one place.
 *
 * Both entry points fabricate the same enquiry: `demo` (which then either stubs
 * or runs the extraction itself) and `send-email` (which hands it to the event
 * bus and walks away). Keeping the prose here means the two can never drift,
 * and that the messages thread at `/backend/messages` always says exactly what
 * the Inbox Ops email says.
 *
 * The two entry points differ in what they do with it. `demo` writes the row
 * below straight into `inbox_emails`. `send-email` sends the same fields to
 * core's inbound webhook as a signed JSON payload and lets core build the row,
 * so there the `id` and `messageId` fields below are only what this module
 * proposed: the stored row is core's.
 */
export type EnquiryInput = {
  emailId: string
  messageIdPrefix: string
  customerEmail: string
  customerName: string
  contactName: string
  tenantId: string
  organizationId: string
  /**
   * `received` is what the inbound webhook writes and what every extractor's
   * optimistic claim looks for. `processed` is used only by the stubbed demo
   * path, where this command writes the proposal itself and no extractor may
   * touch the email.
   */
  status: 'received' | 'processed'
  /** Free-text provenance written to `inbox_emails.metadata.seededBy`. */
  seededBy: string
  /**
   * One extra sentence from the customer, appended to the body.
   *
   * This is how an operator changes what the enquiry ASKS for without editing
   * this file: "please quote in USD" produces a real, unforced pricing failure,
   * because the catalogue holds EUR prices only. The demo's own
   * `--force-unpriced` cannot be used on this path, since here the payload is
   * the model's and there is nothing for a flag to break.
   */
  extraNote?: string | null
  /**
   * The whole body, written by the operator (`send-email --body` /
   * `--body-file`).
   *
   * It REPLACES the built-in enquiry rather than being appended to it, because
   * an operator describing a different freight job must not have the Poznań to
   * Rotterdam story still sitting above their text: the extraction would read
   * both and quote the wrong shipment. `extraNote` still appends, to whichever
   * body is in play.
   */
  body?: string | null
  /** Subject line, written by the operator. Falls back to the built-in one. */
  subject?: string | null
  /**
   * Recipient address. On the `send-email` path this is the value that picks a
   * tenant inside core's webhook, so it is the organization's configured inbox
   * address; the default is only used by the offline `demo` path, which writes
   * the row itself and resolves no inbox.
   */
  toAddress?: string | null
  now: Date
}

export type SeededEnquiry = {
  id: string
  messageId: string
  forwardedByAddress: string
  forwardedByName: string
  toAddress: string
  subject: string
  replyTo: string
  rawText: string
  cleanedText: string
  detectedLanguage: string
  receivedAt: Date
  status: 'received' | 'processed'
  organizationId: string
  tenantId: string
  metadata: Record<string, unknown>
}

/** The subject used when the operator writes none. */
export const DEFAULT_ENQUIRY_SUBJECT =
  'Request for a transport quote: 8 pallets Poznań to Rotterdam'

/** `cleaned_text` is core's one-paragraph form of the body; this makes one. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function buildDefaultRawText(input: EnquiryInput): string {
  return (
    `Hello,\n\nCould you quote us for a groupage shipment of 8 EUR pallets from our Poznań warehouse to Rotterdam?\nEach pallet is about 1.6 m high and 420 kg. The delivery site has no loading dock, so we need a tail-lift.\nWe need it collected before the end of the month.${
      input.extraNote ? `\n${input.extraNote}` : ''
    }\n\nThanks,\n${input.contactName}\n${input.customerName}`
  )
}

function buildDefaultCleanedText(input: EnquiryInput): string {
  return `Could you quote us for a groupage shipment of 8 EUR pallets from Poznań to Rotterdam? Each pallet is about 1.6 m high and 420 kg. The delivery site has no loading dock, so we need a tail-lift. We need it collected before the end of the month.${
    input.extraNote ? ` ${input.extraNote}` : ''
  }`
}

export function buildEnquiryEmail(input: EnquiryInput): SeededEnquiry {
  const customBody = input.body?.trim() ? input.body.trim() : null
  const note = input.extraNote?.trim() ? input.extraNote.trim() : null
  const customSubject = input.subject?.trim() ? input.subject.trim() : null

  // The operator's text is used verbatim, including its blank lines, with the
  // signature they wrote. `--note` still appends, on its own line, so the flag
  // keeps meaning "one more sentence from the customer" on both paths.
  const rawText = customBody
    ? note
      ? `${customBody}\n${note}`
      : customBody
    : buildDefaultRawText(input)

  const cleanedText = customBody
    ? collapseWhitespace(note ? `${customBody} ${note}` : customBody)
    : buildDefaultCleanedText(input)

  return {
    id: input.emailId,
    messageId: `${input.messageIdPrefix}${input.now.getTime()}@localhost>`,
    forwardedByAddress: input.customerEmail,
    forwardedByName: input.customerName,
    toAddress: input.toAddress?.trim() || 'ops@offer-automation.local',
    subject: customSubject ?? DEFAULT_ENQUIRY_SUBJECT,
    replyTo: input.customerEmail,
    rawText,
    cleanedText,
    detectedLanguage: 'en',
    receivedAt: input.now,
    status: input.status,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    metadata: { seededBy: input.seededBy },
  }
}
