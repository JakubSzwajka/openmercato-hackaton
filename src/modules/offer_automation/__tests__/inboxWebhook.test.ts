// Explicit imports rather than ambient globals, matching the other suites in
// this folder: `@types/jest` is not wired into this app's tsconfig typeRoots.
import { describe, expect, it } from '@jest/globals'
import {
  buildWebhookSignature,
  decideWebhookOutcome,
  describeWebhookOutcome,
  INBOUND_WEBHOOK_PATH,
  signWebhookRequest,
  webhookContentHash,
  WEBHOOK_SECRET_ENV,
  type InboundWebhookPayload,
} from '../lib/inboxWebhook'

const PAYLOAD: InboundWebhookPayload = {
  from: 'Marta Nowak <marta.nowak@nordwind-spedition.example>',
  to: 'quotes@nordwind-logistics.example',
  subject: 'Request for a transport quote',
  text: 'Eight pallets, Poznan to Rotterdam.',
  messageId: '<offer-automation-send-1772200000000@localhost>',
}

/** 2026-02-27T14:26:40Z, the instant the fixtures below were computed at. */
const NOW = new Date(1772200000000)

const CONTEXT = {
  toAddress: 'quotes@nordwind-logistics.example',
  tenantId: '6f7edd48-febc-485b-9e45-ea64773d62a5',
  organizationId: 'd8792480-8990-4b84-b533-4d9182d800b0',
  messageId: PAYLOAD.messageId!,
}

describe('buildWebhookSignature', () => {
  it('matches the HMAC core verifies, for a known secret, timestamp and body', () => {
    // The fixture is `openssl`-reproducible:
    //   printf '1772200000.<body>' | openssl dgst -sha256 -hmac test-secret-value
    // Pinned rather than recomputed in the test, because a test that rebuilds
    // the expected value the same way the code does proves only that the code
    // is self-consistent.
    expect(
      buildWebhookSignature({
        secret: 'test-secret-value',
        timestamp: '1772200000',
        rawBody: '{"hello":"world"}',
      }),
    ).toBe('5b7076534b608951ad42b9880f9135976bd1b0a762f09cc2fde2c55372783e5e')
  })

  it('is lowercase hex of the documented length', () => {
    const signature = buildWebhookSignature({
      secret: 'test-secret-value',
      timestamp: '1772200000',
      rawBody: '{}',
    })
    expect(signature).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the timestamp changes, so a replayed body cannot be reused', () => {
    const body = '{"hello":"world"}'
    expect(buildWebhookSignature({ secret: 's', timestamp: '1772200000', rawBody: body })).not.toBe(
      buildWebhookSignature({ secret: 's', timestamp: '1772200001', rawBody: body }),
    )
  })
})

describe('signWebhookRequest', () => {
  it('signs the exact bytes it returns', () => {
    const signed = signWebhookRequest({ payload: PAYLOAD, secret: 'test-secret-value', now: NOW })
    expect(signed.headers['x-webhook-signature']).toBe(
      buildWebhookSignature({
        secret: 'test-secret-value',
        timestamp: signed.headers['x-webhook-timestamp']!,
        rawBody: signed.body,
      }),
    )
    expect(JSON.parse(signed.body)).toEqual(PAYLOAD)
  })

  it('stamps unix SECONDS, which is what core parses', () => {
    const signed = signWebhookRequest({ payload: PAYLOAD, secret: 's', now: NOW })
    expect(signed.headers['x-webhook-timestamp']).toBe('1772200000')
  })

  it('sends JSON', () => {
    const signed = signWebhookRequest({ payload: PAYLOAD, secret: 's', now: NOW })
    expect(signed.headers['content-type']).toBe('application/json')
  })

  it('never puts the secret in a header', () => {
    const signed = signWebhookRequest({ payload: PAYLOAD, secret: 'test-secret-value', now: NOW })
    expect(JSON.stringify(signed)).not.toContain('test-secret-value')
  })
})

describe('webhookContentHash', () => {
  it('ignores the message id, because core hashes subject, sender and body only', () => {
    // This is what makes a second send of the same enquiry a silent no-op: a
    // fresh message id does NOT make the email new.
    expect(webhookContentHash(PAYLOAD)).toBe(
      webhookContentHash({ ...PAYLOAD, messageId: '<something-else@localhost>' }),
    )
  })

  it('changes when the body changes, which is how --note rescues a duplicate', () => {
    expect(webhookContentHash(PAYLOAD)).not.toBe(
      webhookContentHash({ ...PAYLOAD, text: `${PAYLOAD.text} Collection is now Friday.` }),
    )
  })

  it('is a sha256 digest', () => {
    expect(webhookContentHash(PAYLOAD)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('decideWebhookOutcome', () => {
  it('reports the stored row when one carries our message id', () => {
    expect(
      decideWebhookOutcome({
        storedInboxEmailId: 'row-1',
        duplicateInboxEmailId: 'row-0',
        inboxSettingsPresent: true,
      }),
    ).toEqual({ kind: 'stored', inboxEmailId: 'row-1' })
  })

  it('reports a duplicate when an older row holds the same content hash', () => {
    expect(
      decideWebhookOutcome({
        storedInboxEmailId: null,
        duplicateInboxEmailId: 'row-0',
        inboxSettingsPresent: true,
      }),
    ).toEqual({ kind: 'duplicate', existingInboxEmailId: 'row-0' })
  })

  it('reports an unknown inbox when no active settings row owns the address', () => {
    expect(
      decideWebhookOutcome({
        storedInboxEmailId: null,
        duplicateInboxEmailId: null,
        inboxSettingsPresent: false,
      }),
    ).toEqual({ kind: 'unknown-inbox' })
  })

  it('prefers the duplicate explanation over the missing-inbox one', () => {
    // Both reads can come back empty-handed at once. A duplicate is the far
    // commoner cause and names a fix the operator can type, so it wins.
    expect(
      decideWebhookOutcome({
        storedInboxEmailId: null,
        duplicateInboxEmailId: 'row-0',
        inboxSettingsPresent: false,
      }).kind,
    ).toBe('duplicate')
  })

  it('admits it does not know when nothing explains the empty result', () => {
    expect(
      decideWebhookOutcome({
        storedInboxEmailId: null,
        duplicateInboxEmailId: null,
        inboxSettingsPresent: true,
      }),
    ).toEqual({ kind: 'unexplained' })
  })
})

describe('describeWebhookOutcome', () => {
  it('says nothing about a stored email', () => {
    expect(
      describeWebhookOutcome({ kind: 'stored', inboxEmailId: 'row-1' }, CONTEXT),
    ).toEqual([])
  })

  it('names the surviving row and the flags that vary the body', () => {
    const lines = describeWebhookOutcome(
      { kind: 'duplicate', existingInboxEmailId: 'row-0' },
      CONTEXT,
    ).join('\n')
    expect(lines).toContain('row-0')
    expect(lines).toContain('--note')
    expect(lines).toContain('--body-file')
  })

  it('points an unknown inbox at seed-demo', () => {
    const lines = describeWebhookOutcome({ kind: 'unknown-inbox' }, CONTEXT).join('\n')
    expect(lines).toContain(CONTEXT.toAddress)
    expect(lines).toContain('yarn mercato offer_automation seed-demo')
  })

  it('reports the address, the tenant and the org when it cannot explain itself', () => {
    const lines = describeWebhookOutcome({ kind: 'unexplained' }, CONTEXT).join('\n')
    expect(lines).toContain(CONTEXT.toAddress)
    expect(lines).toContain(CONTEXT.tenantId)
    expect(lines).toContain(CONTEXT.organizationId)
    expect(lines).toContain(CONTEXT.messageId)
  })
})

describe('published constants', () => {
  it('addresses core\'s inbound webhook route', () => {
    expect(INBOUND_WEBHOOK_PATH).toBe('/api/inbox_ops/webhook/inbound')
  })

  it('names the env var core reads its signing secret from', () => {
    expect(WEBHOOK_SECRET_ENV).toBe('INBOX_OPS_WEBHOOK_SECRET')
  })
})
