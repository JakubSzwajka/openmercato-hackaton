// Explicit imports rather than ambient globals, matching the other suites in
// this folder: `@types/jest` is not wired into this app's tsconfig typeRoots.
import { describe, expect, it } from '@jest/globals'
import {
  deriveSenderIdentity,
  MAX_BODY_CHARS,
  MAX_SUBJECT_CHARS,
  previewBody,
  resolveEmailOverrides,
  type BodyFileReadResult,
} from '../lib/customEmailInput'
import { buildEnquiryEmail, DEFAULT_ENQUIRY_SUBJECT } from '../lib/inboundEnquiry'
import { messageThreadUrl, describeWhoCanSeeThread } from '../lib/messageThreadReport'

const NOW = new Date('2026-03-04T09:00:00.000Z')

function fileReader(files: Record<string, string>) {
  return (path: string): BodyFileReadResult =>
    path in files ? { ok: true, text: files[path]! } : { ok: false, reason: `${path} does not exist.` }
}

function expectRejection(result: ReturnType<typeof resolveEmailOverrides>): {
  message: string
  hints: string[]
} {
  if (result.ok) throw new Error('expected the arguments to be rejected')
  return { message: result.message, hints: result.hints }
}

describe('resolveEmailOverrides', () => {
  it('keeps the built-in enquiry when nothing is given', () => {
    const result = resolveEmailOverrides({})
    if (!result.ok) throw new Error(result.message)
    expect(result.overrides).toEqual({
      body: null,
      bodySource: 'built-in',
      bodyPath: null,
      subject: null,
      from: null,
    })
  })

  it('refuses --body and --body-file together', () => {
    const { message } = expectRejection(
      resolveEmailOverrides({ body: 'hello', bodyFile: './enquiry.txt' }, fileReader({})),
    )
    expect(message).toContain('mutually exclusive')
  })

  it('refuses an empty --body', () => {
    expect(expectRejection(resolveEmailOverrides({ body: '   ' })).message).toContain(
      '--body was given with no text',
    )
  })

  it('refuses a valueless --body flag', () => {
    // `--body` with nothing after it parses as the boolean `true`.
    expect(expectRejection(resolveEmailOverrides({ body: true })).message).toContain(
      '--body was given with no text',
    )
  })

  it('refuses a body file that does not exist, and says which path it tried', () => {
    const { message, hints } = expectRejection(
      resolveEmailOverrides({ bodyFile: './missing.txt' }, fileReader({})),
    )
    expect(message).toContain('./missing.txt does not exist')
    expect(hints.join(' ')).toContain('Check the path')
  })

  it('refuses a body file that holds only whitespace', () => {
    const { message } = expectRejection(
      resolveEmailOverrides({ bodyFile: './empty.txt' }, fileReader({ './empty.txt': '\n\n  \n' })),
    )
    expect(message).toContain('is empty')
  })

  it('reads a body file and records where it came from', () => {
    const result = resolveEmailOverrides(
      { bodyFile: './enquiry.txt' },
      fileReader({ './enquiry.txt': '  Two pallets to Hamburg.\n' }),
    )
    if (!result.ok) throw new Error(result.message)
    expect(result.overrides.body).toBe('Two pallets to Hamburg.')
    expect(result.overrides.bodySource).toBe('--body-file')
    expect(result.overrides.bodyPath).toBe('./enquiry.txt')
  })

  it('refuses a body longer than the prompt budget', () => {
    const { message } = expectRejection(
      resolveEmailOverrides({ body: 'x'.repeat(MAX_BODY_CHARS + 1) }),
    )
    expect(message).toContain(`the limit is ${MAX_BODY_CHARS}`)
  })

  it('accepts a body exactly at the limit', () => {
    const result = resolveEmailOverrides({ body: 'x'.repeat(MAX_BODY_CHARS) })
    expect(result.ok).toBe(true)
  })

  it('refuses a valueless or overlong --subject', () => {
    expect(expectRejection(resolveEmailOverrides({ subject: true })).message).toContain(
      '--subject was given with no text',
    )
    expect(
      expectRejection(resolveEmailOverrides({ subject: 's'.repeat(MAX_SUBJECT_CHARS + 1) })).message,
    ).toContain(`the limit is ${MAX_SUBJECT_CHARS}`)
  })

  it('lower-cases a sender and refuses one that is not an address', () => {
    const ok = resolveEmailOverrides({ from: 'Marta.Nowak@Example.COM' })
    if (!ok.ok) throw new Error(ok.message)
    expect(ok.overrides.from).toBe('marta.nowak@example.com')

    for (const bad of ['marta', 'a@b', 'two@at@example.com', 'has space@example.com']) {
      expect(expectRejection(resolveEmailOverrides({ from: bad })).message).toContain(
        'is not an email address',
      )
    }
  })
})

describe('deriveSenderIdentity', () => {
  it('reads a company and a person off the address', () => {
    expect(deriveSenderIdentity('procurement@unknown-shipper.example')).toEqual({
      customerName: 'Unknown Shipper',
      contactName: 'Procurement',
    })
    expect(deriveSenderIdentity('anna.kowalczyk@vistula.co.uk').contactName).toBe('Anna Kowalczyk')
  })

  it('falls back to the address when there is nothing to read', () => {
    expect(deriveSenderIdentity('nobody')).toEqual({
      customerName: 'nobody',
      contactName: 'Nobody',
    })
  })
})

describe('previewBody', () => {
  it('shows the first lines and counts the rest', () => {
    const lines = previewBody('one\n\ntwo\nthree\nfour')
    expect(lines[0]).toBe('one')
    expect(lines[1]).toBe('two')
    expect(lines[2]).toContain('2 more line(s)')
  })

  it('reports the length when the whole body fits', () => {
    expect(previewBody('only line').at(-1)).toBe('(9 characters)')
  })
})

describe('buildEnquiryEmail with operator-written content', () => {
  const base = {
    emailId: '11111111-1111-4111-8111-111111111111',
    messageIdPrefix: '<offer-automation-send-',
    customerEmail: 'marta@example.com',
    customerName: 'Nordwind',
    contactName: 'Marta Nowak',
    tenantId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
    status: 'received' as const,
    seededBy: 'test',
    now: NOW,
  }

  it('is unchanged when no body or subject is given', () => {
    const email = buildEnquiryEmail(base)
    expect(email.subject).toBe(DEFAULT_ENQUIRY_SUBJECT)
    expect(email.rawText).toContain('8 EUR pallets')
    expect(email.cleanedText).toContain('Poznań to Rotterdam')
  })

  it('replaces the built-in body rather than appending to it', () => {
    const email = buildEnquiryEmail({ ...base, body: 'Two crates to Hamburg, dock available.' })
    expect(email.rawText).toBe('Two crates to Hamburg, dock available.')
    expect(email.rawText).not.toContain('Rotterdam')
    expect(email.cleanedText).toBe('Two crates to Hamburg, dock available.')
  })

  it('appends --note to a custom body and collapses the cleaned text', () => {
    const email = buildEnquiryEmail({
      ...base,
      body: 'Line one.\n\nLine two.',
      extraNote: 'Please quote in USD.',
    })
    expect(email.rawText).toBe('Line one.\n\nLine two.\nPlease quote in USD.')
    expect(email.cleanedText).toBe('Line one. Line two. Please quote in USD.')
  })

  it('still appends --note to the built-in body', () => {
    const email = buildEnquiryEmail({ ...base, extraNote: 'Please quote in USD.' })
    expect(email.rawText).toContain('Please quote in USD.')
    expect(email.rawText).toContain('8 EUR pallets')
  })

  it('takes a custom subject', () => {
    expect(buildEnquiryEmail({ ...base, subject: 'Quote please' }).subject).toBe('Quote please')
  })
})

describe('thread reporting', () => {
  it('builds the /backend/messages/[id] link without doubling the slash', () => {
    expect(messageThreadUrl('http://localhost:3000/', 'abc')).toBe(
      'http://localhost:3000/backend/messages/abc',
    )
  })

  it('names a login and the tenant', () => {
    const lines = describeWhoCanSeeThread({
      messageId: 'm',
      threadId: 't',
      tenantName: 'Nordwind Logistics',
      senderEmail: 'sales@nordwind-logistics.example',
      recipients: [
        { userId: 'u1', email: 'sales@nordwind-logistics.example' },
        { userId: 'u2', email: 'admin@nordwind-logistics.example' },
      ],
    })
    expect(lines[0]).toBe(
      'Sign in as sales@nordwind-logistics.example in tenant "Nordwind Logistics" to see it.',
    )
    expect(lines[1]).toContain('admin@nordwind-logistics.example')
  })
})
