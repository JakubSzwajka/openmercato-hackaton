import { readFileSync, statSync } from 'node:fs'

/**
 * Argument checking for the operator-written email, kept away from the CLI so
 * every rule can be tested without a database, a container or a process exit.
 *
 * Everything here runs BEFORE the first write. A body that is empty, unreadable
 * or too long has to be refused while the only cost is a re-typed command: once
 * the `inbox_emails` row exists the event is emitted, a worker picks it up and
 * the operator is chasing a half-finished chain.
 */

/**
 * Longest body this command will accept, in characters.
 *
 * The body is pasted whole into the extraction prompt
 * (`inbox_ops/lib/extractionPrompt.ts` builds it from the email text), so a
 * runaway paste is spent as model context. 16000 characters is roughly 4000
 * tokens, which leaves room for the catalogue listing and the action schemas in
 * every model this app is configured against. It is a guard rail, not a
 * measured provider limit: raise it here if a real enquiry is ever longer.
 */
export const MAX_BODY_CHARS = 16_000

/** Longest subject accepted. RFC 5322 recommends wrapping well before this. */
export const MAX_SUBJECT_CHARS = 300

/** What `parseArgs` produces: a string, `true` for a valueless flag, or nothing. */
export type FlagValue = string | boolean | null | undefined

export type EmailOverrideArgs = {
  body?: FlagValue
  bodyFile?: FlagValue
  subject?: FlagValue
  from?: FlagValue
}

/** Where the body text came from, for the echo block. */
export type BodySource = 'built-in' | '--body' | '--body-file'

export type EmailOverrides = {
  /** `null` means "keep the built-in freight enquiry". */
  body: string | null
  bodySource: BodySource
  /** Absolute or operator-typed path, only for `--body-file`. */
  bodyPath: string | null
  /** `null` means "keep the built-in subject". */
  subject: string | null
  /** `null` means "keep the default sender". */
  from: string | null
}

export type EmailOverrideResult =
  | { ok: true; overrides: EmailOverrides }
  | { ok: false; message: string; hints: string[] }

export type BodyFileReadResult = { ok: true; text: string } | { ok: false; reason: string }

/** Reads a body file from disk. Injected so the rules can be tested with a stub. */
export function readBodyFileFromDisk(path: string): BodyFileReadResult {
  try {
    const stat = statSync(path)
    if (stat.isDirectory()) return { ok: false, reason: `${path} is a directory, not a file.` }
  } catch {
    return { ok: false, reason: `${path} does not exist or cannot be read.` }
  }
  try {
    return { ok: true, text: readFileSync(path, 'utf8') }
  } catch (err) {
    return { ok: false, reason: `${path} could not be read: ${(err as Error).message}` }
  }
}

function reject(message: string, ...hints: string[]): EmailOverrideResult {
  return { ok: false, message, hints }
}

/**
 * A flag the operator typed but left empty is an error, never a silent default.
 *
 * `--subject` with nothing after it parses as `true`, and `--body ""` parses as
 * an empty string. Both mean the operator meant to say something; falling back
 * to the built-in text there would send an email they did not write.
 */
function readValueFlag(
  value: FlagValue,
  name: string,
): { present: false } | { present: true; value: string } | { present: true; empty: true } {
  if (value === undefined || value === null || value === false) return { present: false }
  if (value === true) return { present: true, empty: true }
  const trimmed = value.trim()
  if (!trimmed) return { present: true, empty: true }
  void name
  return { present: true, value: trimmed }
}

/** A sender has to look like a mailbox; core lower-cases it before every lookup. */
function looksLikeEmail(value: string): boolean {
  if (/\s/.test(value)) return false
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return false
  const domain = value.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

export function resolveEmailOverrides(
  args: EmailOverrideArgs,
  readBodyFile: (path: string) => BodyFileReadResult = readBodyFileFromDisk,
): EmailOverrideResult {
  const bodyFlag = readValueFlag(args.body, '--body')
  const bodyFileFlag = readValueFlag(args.bodyFile, '--body-file')
  const subjectFlag = readValueFlag(args.subject, '--subject')
  const fromFlag = readValueFlag(args.from, '--from')

  if (bodyFlag.present && bodyFileFlag.present) {
    return reject(
      '--body and --body-file are mutually exclusive; give one of them.',
      'Use --body "short text" for a line or two.',
      'Use --body-file ./enquiry.txt when the email is long or has blank lines,',
      'so the shell never has to survive the quoting.',
    )
  }

  let body: string | null = null
  let bodySource: BodySource = 'built-in'
  let bodyPath: string | null = null

  if (bodyFlag.present) {
    if ('empty' in bodyFlag) {
      return reject(
        '--body was given with no text.',
        'Write the email: --body "Could you quote 3 pallets Poznan to Hamburg?"',
        'Or drop the flag to send the built-in enquiry.',
      )
    }
    body = bodyFlag.value
    bodySource = '--body'
  } else if (bodyFileFlag.present) {
    if ('empty' in bodyFileFlag) {
      return reject('--body-file was given with no path.', 'Give one: --body-file ./enquiry.txt')
    }
    const read = readBodyFile(bodyFileFlag.value)
    if (!read.ok) {
      return reject(
        `--body-file could not be used: ${read.reason}`,
        'Check the path from the directory you are running the command in.',
      )
    }
    const text = read.text.trim()
    if (!text) {
      return reject(
        `--body-file ${bodyFileFlag.value} is empty.`,
        'An email with no body gives the extraction nothing to read.',
      )
    }
    body = text
    bodySource = '--body-file'
    bodyPath = bodyFileFlag.value
  }

  if (body !== null && body.length > MAX_BODY_CHARS) {
    return reject(
      `The body is ${body.length} characters; the limit is ${MAX_BODY_CHARS}.`,
      'The whole body is pasted into the extraction prompt, so a body this long is',
      'spent as model context and can push the catalogue listing out of it.',
      'Send the part that states the job, or raise MAX_BODY_CHARS in',
      'src/modules/offer_automation/lib/customEmailInput.ts and say why.',
    )
  }

  let subject: string | null = null
  if (subjectFlag.present) {
    if ('empty' in subjectFlag) {
      return reject('--subject was given with no text.', 'Give one: --subject "Quote request"')
    }
    if (subjectFlag.value.length > MAX_SUBJECT_CHARS) {
      return reject(
        `The subject is ${subjectFlag.value.length} characters; the limit is ${MAX_SUBJECT_CHARS}.`,
      )
    }
    subject = subjectFlag.value
  }

  let from: string | null = null
  if (fromFlag.present) {
    if ('empty' in fromFlag) {
      return reject(
        '--from was given with no address.',
        'Give one: --from marta.nowak@nordwind-spedition.example',
      )
    }
    if (!looksLikeEmail(fromFlag.value)) {
      return reject(
        `--from "${fromFlag.value}" is not an email address.`,
        'It is written onto the inbox email and is what links the quote to a CRM',
        'customer, so a malformed one would silently unlink every quote.',
      )
    }
    from = fromFlag.value.toLowerCase()
  }

  return { ok: true, overrides: { body, bodySource, bodyPath, subject, from } }
}

/** Title-cases one word group: `unknown-shipper` becomes `Unknown Shipper`. */
function titleCase(value: string): string {
  return value
    .split(/[-_.+]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * A company and a contact name for a sender the operator named themselves.
 *
 * Without this, `--from stranger@acme-freight.example` keeps the seeded
 * contact's company on the email, and the quote's customer snapshot then claims
 * a different company than the address it was sent from. Guessing from the
 * address is not accurate, but it is honest: it says only what the address
 * says. `--customer-name` and `--contact-name` still override it.
 */
export function deriveSenderIdentity(email: string): {
  customerName: string
  contactName: string
} {
  const at = email.indexOf('@')
  const local = at > 0 ? email.slice(0, at) : email
  const domain = at > 0 ? email.slice(at + 1) : ''
  const firstLabel = domain.split('.')[0] ?? ''
  return {
    customerName: titleCase(firstLabel) || email,
    contactName: titleCase(local) || email,
  }
}

/**
 * The first lines of the body, for the echo block.
 *
 * Echoing matters more than it looks: the operator typed this text through a
 * shell, and a swallowed quote or a mangled newline is invisible until the
 * model reads something the operator never wrote.
 */
export function previewBody(body: string, maxLines = 2, maxLineChars = 96): string[] {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const shown = lines.slice(0, maxLines).map((line) =>
    line.length > maxLineChars ? `${line.slice(0, maxLineChars - 1)}…` : line,
  )
  const hiddenLines = lines.length - shown.length
  if (hiddenLines > 0) shown.push(`… ${hiddenLines} more line(s), ${body.length} characters in total`)
  else shown.push(`(${body.length} characters)`)
  return shown
}
