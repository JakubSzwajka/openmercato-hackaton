// Explicit imports rather than ambient globals, for the same reason as
// `coreRequiredFeatureShim.test.ts`: `@types/jest` is not in the tsconfig
// typeRoots resolution for this app.
import { describe, expect, it } from '@jest/globals'
import enTranslations from '../i18n/en.json'
import { EXTRACTION_FAILURE_PREFIX } from '../lib/freightExtraction'
import { decideTakeover } from '../subscribers/inbound-email-extraction'
import { describeUnsettled, watchSettled } from '../lib/sendEmailWatch'
import { needsInboxActionRegistryShim } from '../lib/inboxActionRegistry'
import { buildEnquiryEmail } from '../lib/inboundEnquiry'
import { AUTOMATION_USER_FEATURES } from '../lib/automationUser'
import { DRAFT_OFFER_REQUIRED_FEATURE } from '../inbox-actions'
import {
  notificationTypes,
  QUOTE_DRAFTED_NOTIFICATION_TYPE,
  QUOTE_DRAFT_FAILED_NOTIFICATION_TYPE,
} from '../notifications'

/**
 * These four decisions are the only ones in the hands-off chain that are pure,
 * and each of them is a decision that costs money or silence when it is wrong:
 * a takeover that loops calls the model forever, a takeover that never fires
 * loses the quote, and a notification whose key is missing renders as a raw
 * i18n key to the sales desk.
 */
describe('decideTakeover', () => {
  it('waits while another extractor still holds the email', () => {
    expect(decideTakeover({ status: 'processing' })).toEqual({ action: 'wait' })
    expect(decideTakeover({ status: 'received' })).toEqual({ action: 'wait' })
  })

  it('takes over after another extraction failed', () => {
    expect(
      decideTakeover({
        status: 'failed',
        processingError: 'LLM extraction failed: Invalid schema for response_format',
      }),
    ).toEqual({ action: 'extract' })
  })

  it('never takes over its own refusal twice', () => {
    const decision = decideTakeover({
      status: 'failed',
      processingError: `${EXTRACTION_FAILURE_PREFIX}The model judged this email not to be a freight enquiry`,
    })
    expect(decision.action).toBe('skip')
  })

  it('leaves a finished extraction alone', () => {
    expect(decideTakeover({ status: 'processed' }).action).toBe('skip')
    expect(decideTakeover({ status: 'needs_review' }).action).toBe('skip')
  })
})

describe('inbox-action registry shim', () => {
  it('is skipped under Next and installed in a plain Node worker', () => {
    expect(
      needsInboxActionRegistryShim({ NEXT_RUNTIME: 'nodejs' } as unknown as NodeJS.ProcessEnv),
    ).toBe(false)
    expect(needsInboxActionRegistryShim({} as unknown as NodeJS.ProcessEnv)).toBe(true)
  })
})

describe('the fabricated enquiry', () => {
  const email = buildEnquiryEmail({
    emailId: 'e1',
    messageIdPrefix: '<offer-automation-send-',
    customerEmail: 'marta.nowak@nordwind-spedition.example',
    customerName: 'Nordwind Spedition GmbH',
    contactName: 'Marta Nowak',
    tenantId: 't1',
    organizationId: 'o1',
    status: 'received',
    seededBy: 'offer_automation send-email',
    now: new Date('2026-01-02T03:04:05.000Z'),
  })

  it('arrives in the status every extractor claims from', () => {
    expect(email.status).toBe('received')
  })

  it('carries the sender the pricing and CRM link depend on', () => {
    expect(email.forwardedByAddress).toBe('marta.nowak@nordwind-spedition.example')
    expect(email.replyTo).toBe(email.forwardedByAddress)
  })

  it('names no sku and no price, because the model has to work that out', () => {
    expect(email.rawText).not.toMatch(/FRT-/)
    expect(email.rawText).not.toMatch(/EUR\s*\d/)
  })

  it('stamps a message id a later run can recognise', () => {
    expect(email.messageId).toBe('<offer-automation-send-1767323045000@localhost>')
  })
})

describe('the automation account', () => {
  it('holds one feature and it is the one the engine checks', () => {
    expect([...AUTOMATION_USER_FEATURES]).toEqual([DRAFT_OFFER_REQUIRED_FEATURE])
  })
})

describe('notification types', () => {
  const strings = enTranslations as Record<string, string>

  it('ships one type per outcome', () => {
    expect(notificationTypes.map((type) => type.type)).toEqual([
      QUOTE_DRAFTED_NOTIFICATION_TYPE,
      QUOTE_DRAFT_FAILED_NOTIFICATION_TYPE,
    ])
  })

  it('translates every key it renders', () => {
    for (const type of notificationTypes) {
      expect(strings[type.titleKey]).toBeTruthy()
      expect(strings[type.bodyKey!]).toBeTruthy()
      for (const action of type.actions ?? []) {
        expect(strings[action.labelKey]).toBeTruthy()
      }
    }
  })

  it('never sends mail from a demo tenant', () => {
    for (const type of notificationTypes) {
      expect(type.channels).toEqual(['in_app'])
    }
  })
})

describe('watchSettled', () => {
  const base = {
    proposalId: null,
    actionId: null,
    actionStatus: null,
    executionError: null,
    emailStatus: 'received',
    processingError: null,
    quoteId: null,
    quoteNumber: null,
    quoteTotal: null,
    quoteCurrency: null,
    customerEntityId: null,
    executedByUserId: null,
    notificationCount: 0,
  }

  it('keeps watching while core has failed but this module has not had its turn', () => {
    expect(
      watchSettled({
        ...base,
        emailStatus: 'failed',
        processingError: 'LLM extraction failed: Invalid schema for response_format',
      }),
    ).toBe(false)
  })

  it('stops once this module itself refused the email', () => {
    expect(
      watchSettled({
        ...base,
        emailStatus: 'failed',
        processingError: `${EXTRACTION_FAILURE_PREFIX}not a freight enquiry`,
      }),
    ).toBe(true)
  })

  it('stops on a quote and on a failed action', () => {
    expect(watchSettled({ ...base, quoteId: 'q1' })).toBe(true)
    expect(watchSettled({ ...base, actionStatus: 'failed' })).toBe(true)
  })
})

describe('describeUnsettled', () => {
  const base = {
    proposalId: null,
    actionId: null,
    actionStatus: null,
    executionError: null,
    emailStatus: 'received',
    processingError: null,
    quoteId: null,
    quoteNumber: null,
    quoteTotal: null,
    quoteCurrency: null,
    customerEntityId: null,
    executedByUserId: null,
    notificationCount: 0,
  }

  it('blames the missing worker only when the email is untouched', () => {
    expect(describeUnsettled(base)).toBe('nothing-reacted')
  })

  it('says work is in flight once anything has claimed the email', () => {
    expect(describeUnsettled({ ...base, emailStatus: 'processing' })).toBe('still-working')
    expect(
      describeUnsettled({ ...base, processingError: 'LLM extraction failed: ...' }),
    ).toBe('still-working')
    expect(describeUnsettled({ ...base, proposalId: 'p1' })).toBe('still-working')
  })
})
