// Explicit imports rather than ambient globals, for the same reason as
// `coreRequiredFeatureShim.test.ts`: `@types/jest` is not in the tsconfig
// typeRoots resolution for this app.
import { describe, expect, it } from '@jest/globals'
import {
  buildQuoteResultView,
  resolveActionTypeLabel,
  resolveAppActionDescription,
  resolveCreatedRecordHref,
  resolveQuoteStatusVariant,
  readQuoteIdFromAction,
  summarizeQuoteLines,
  DRAFT_OFFER_ACTION_TYPE,
  DRAFT_OFFER_CREATED_ENTITY_TYPE,
} from '../lib/proposalPresentation'
import {
  DRAFT_OFFER_ACTION_TYPE as SERVER_ACTION_TYPE,
  DRAFT_OFFER_CREATED_ENTITY_TYPE as SERVER_CREATED_ENTITY_TYPE,
} from '../inbox-actions'

const QUOTE_ID = '66666666-6666-4666-8666-666666666666'

describe('draft_offer constants', () => {
  // `proposalPresentation.ts` restates both constants so a client component can
  // import it without dragging MikroORM and core's execution engine into the
  // browser bundle. This is the check that keeps the two copies honest.
  it('match the ones the executor writes', () => {
    expect(DRAFT_OFFER_ACTION_TYPE).toBe(SERVER_ACTION_TYPE)
    expect(DRAFT_OFFER_CREATED_ENTITY_TYPE).toBe(SERVER_CREATED_ENTITY_TYPE)
  })
})

describe('resolveCreatedRecordHref', () => {
  it('links a created sales quote for a viewer who can open it', () => {
    expect(
      resolveCreatedRecordHref(
        { createdEntityId: QUOTE_ID, createdEntityType: 'sales_quote' },
        { canOpenTarget: true },
      ),
    ).toBe(`/backend/sales/quotes/${QUOTE_ID}`)
  })

  it('withholds the link from a viewer who cannot open the quote', () => {
    expect(
      resolveCreatedRecordHref(
        { createdEntityId: QUOTE_ID, createdEntityType: 'sales_quote' },
        { canOpenTarget: false },
      ),
    ).toBeNull()
  })

  it('refuses to guess a URL for a created entity type it has no route for', () => {
    expect(
      resolveCreatedRecordHref(
        { createdEntityId: QUOTE_ID, createdEntityType: 'sales_order' },
        { canOpenTarget: true },
      ),
    ).toBeNull()
  })

  it('links nowhere when the action created nothing', () => {
    expect(resolveCreatedRecordHref({ createdEntityType: 'sales_quote' }, { canOpenTarget: true })).toBeNull()
    expect(
      resolveCreatedRecordHref(
        { createdEntityId: '   ', createdEntityType: 'sales_quote' },
        { canOpenTarget: true },
      ),
    ).toBeNull()
  })

  it('percent-encodes an id that is not a bare uuid', () => {
    expect(
      resolveCreatedRecordHref(
        { createdEntityId: 'a/b', createdEntityType: 'sales_quote' },
        { canOpenTarget: true },
      ),
    ).toBe('/backend/sales/quotes/a%2Fb')
  })
})

describe('readQuoteIdFromAction', () => {
  it('reports the quote id only for the app action type', () => {
    expect(readQuoteIdFromAction({ createdEntityId: QUOTE_ID, createdEntityType: 'sales_quote' })).toBe(QUOTE_ID)
    expect(readQuoteIdFromAction({ createdEntityId: QUOTE_ID, createdEntityType: 'contact' })).toBeNull()
    expect(readQuoteIdFromAction({})).toBeNull()
  })
})

describe('resolveActionTypeLabel', () => {
  const labels = {
    create_quote: 'Create Quote',
    draft_offer: 'Draft freight offer',
  }

  it('uses the app label for the app action type', () => {
    expect(resolveActionTypeLabel('draft_offer', labels)).toBe('Draft freight offer')
  })

  it("keeps core's label for a core action type", () => {
    expect(resolveActionTypeLabel('create_quote', labels)).toBe('Create Quote')
  })

  it('falls back to the raw type for an unknown action type', () => {
    expect(resolveActionTypeLabel('some_future_action', labels)).toBe('some_future_action')
  })

  it('treats a blank label as missing rather than rendering an empty line', () => {
    expect(resolveActionTypeLabel('draft_offer', { draft_offer: '   ' })).toBe('draft_offer')
  })
})

describe('resolveAppActionDescription', () => {
  const translate = (key: string, fallback: string) =>
    key === 'offer_automation.action.desc.draft_offer' ? 'Draft a freight offer' : fallback

  it('translates an app-owned description key', () => {
    expect(resolveAppActionDescription('offer_automation.action.desc.draft_offer', translate)).toBe(
      'Draft a freight offer',
    )
  })

  it('leaves a plain LLM description to core', () => {
    expect(resolveAppActionDescription('Draft a freight offer: 8 x FRT-LTL-PALLET', translate)).toBeNull()
  })

  it("leaves core's own description keys to core", () => {
    expect(resolveAppActionDescription('inbox_ops.action.desc.create_contact', translate)).toBeNull()
  })
})

describe('summarizeQuoteLines', () => {
  it('reads quantity and sku off the action payload', () => {
    expect(
      summarizeQuoteLines({
        lineItems: [
          { sku: 'FRT-LTL-PALLET', quantity: '18', productName: 'Groupage pallet' },
          { sku: 'FRT-ACC-TAILLIFT', quantity: 1 },
        ],
      }),
    ).toEqual([
      { quantity: '18', label: 'FRT-LTL-PALLET' },
      { quantity: '1', label: 'FRT-ACC-TAILLIFT' },
    ])
  })

  it('falls back to the product name when a payload predates the sku rule', () => {
    expect(summarizeQuoteLines({ lineItems: [{ productName: 'Line haul', quantity: '2' }] })).toEqual([
      { quantity: '2', label: 'Line haul' },
    ])
  })

  it('returns nothing for a payload it cannot read', () => {
    expect(summarizeQuoteLines(null)).toEqual([])
    expect(summarizeQuoteLines('nope')).toEqual([])
    expect(summarizeQuoteLines({ lineItems: 'nope' })).toEqual([])
    expect(summarizeQuoteLines({ lineItems: [null, {}, { quantity: '3' }] })).toEqual([])
  })
})

describe('buildQuoteResultView', () => {
  const lines = [{ quantity: '18', label: 'FRT-LTL-PALLET' }]

  it('summarises a quote that loaded', () => {
    expect(
      buildQuoteResultView({
        quoteId: QUOTE_ID,
        record: {
          id: QUOTE_ID,
          quoteNumber: 'Q-2026-0042',
          status: 'draft',
          currencyCode: 'EUR',
          grandTotalNetAmount: 1240,
        },
        lines,
      }),
    ).toEqual({
      href: `/backend/sales/quotes/${QUOTE_ID}`,
      title: 'Q-2026-0042',
      isFallbackTitle: false,
      status: 'draft',
      netTotal: 1240,
      currencyCode: 'EUR',
      lines,
      degraded: false,
    })
  })

  it('degrades to the bare link and the id when the quote could not be read', () => {
    const view = buildQuoteResultView({ quoteId: QUOTE_ID, record: null, lines })
    expect(view.degraded).toBe(true)
    expect(view.href).toBe(`/backend/sales/quotes/${QUOTE_ID}`)
    expect(view.title).toBe(QUOTE_ID)
    expect(view.isFallbackTitle).toBe(true)
    expect(view.status).toBeNull()
    expect(view.netTotal).toBeNull()
    expect(view.currencyCode).toBeNull()
    // The lines come from the action payload, so they survive a failed read.
    expect(view.lines).toEqual(lines)
  })

  it('falls back to the subtotal when no grand total came back', () => {
    const view = buildQuoteResultView({
      quoteId: QUOTE_ID,
      record: { quoteNumber: 'Q-1', subtotalNetAmount: 99.5 },
      lines: [],
    })
    expect(view.netTotal).toBe(99.5)
    expect(view.degraded).toBe(false)
  })

  it('keeps the link when the record came back without a number', () => {
    const view = buildQuoteResultView({ quoteId: QUOTE_ID, record: { status: 'draft' }, lines: [] })
    expect(view.title).toBe(QUOTE_ID)
    expect(view.isFallbackTitle).toBe(true)
    expect(view.degraded).toBe(false)
  })
})

describe('resolveQuoteStatusVariant', () => {
  it('maps known quote statuses onto status tokens', () => {
    expect(resolveQuoteStatusVariant('draft')).toBe('neutral')
    expect(resolveQuoteStatusVariant('SENT')).toBe('info')
    expect(resolveQuoteStatusVariant('accepted')).toBe('success')
    expect(resolveQuoteStatusVariant('rejected')).toBe('error')
  })

  it('stays neutral for an unknown or missing status', () => {
    expect(resolveQuoteStatusVariant('something_new')).toBe('neutral')
    expect(resolveQuoteStatusVariant(null)).toBe('neutral')
  })
})
