// Explicit imports rather than ambient globals, for the same reason as
// `coreRequiredFeatureShim.test.ts`: `@types/jest` is not in the tsconfig
// typeRoots resolution for this app.
import { describe, expect, it } from '@jest/globals'
import { z } from 'zod'
import {
  buildFreightSystemPrompt,
  freightExtractionSchema,
  toDraftOfferPayload,
} from '../lib/freightExtraction'

const SENDER = { email: 'marta.nowak@nordwind-spedition.example', name: 'Nordwind Spedition' }

function validExtraction(overrides: Partial<z.infer<typeof freightExtractionSchema>> = {}) {
  return {
    summary: 'Nordwind asks for groupage from Poznan to Rotterdam.',
    isFreightEnquiry: true,
    customerName: 'Nordwind Spedition',
    currencyCode: 'EUR',
    notes: 'No dock at delivery.',
    requestedDeliveryDate: '2026-09-30T12:00:00.000Z',
    lineItems: [
      {
        sku: 'FRT-LTL-PALLET',
        productName: 'Groupage (LTL) road freight, per pallet',
        quantity: 8,
        description: 'Poznan to Rotterdam, 8 EUR pallets',
      },
    ],
    confidence: 0.9,
    ...overrides,
  }
}

/**
 * The invariant this whole file exists for. OpenAI strict structured outputs
 * rejects any schema whose properties are not all `required`, which is exactly
 * how core's own extraction schema is broken. If someone adds an `.optional()`
 * here, the live path dies the same way and this test says so before a demo
 * does.
 */
describe('freightExtractionSchema stays strict-safe', () => {
  function assertNoOptionals(schema: z.ZodTypeAny, path: string): void {
    const def = schema as unknown as { def?: { type?: string; shape?: Record<string, z.ZodTypeAny>; element?: z.ZodTypeAny } }
    const type = def.def?.type

    if (type === 'object') {
      for (const [key, value] of Object.entries(def.def?.shape ?? {})) {
        const child = `${path}.${key}`
        expect({ field: child, optional: value.safeParse(undefined).success }).toEqual({
          field: child,
          optional: false,
        })
        assertNoOptionals(value, child)
      }
      return
    }
    if (type === 'array' && def.def?.element) {
      assertNoOptionals(def.def.element, `${path}[]`)
    }
  }

  it('has no optional or nullish property at any depth', () => {
    assertNoOptionals(freightExtractionSchema, 'root')
  })

  it('has no field a model could put a price in', () => {
    const json = JSON.stringify(z.toJSONSchema(freightExtractionSchema)).toLowerCase()
    for (const forbidden of ['price', 'amount', 'cost', 'total', 'rate']) {
      expect({ forbidden, present: json.includes(`"${forbidden}`) }).toEqual({
        forbidden,
        present: false,
      })
    }
  })
})

describe('toDraftOfferPayload', () => {
  it('maps a model answer onto core\'s payload contract', () => {
    const payload = toDraftOfferPayload(validExtraction(), SENDER) as Record<string, unknown>

    expect(payload).toMatchObject({
      customerName: 'Nordwind Spedition',
      customerEmail: SENDER.email,
      currencyCode: 'EUR',
      notes: 'No dock at delivery.',
    })
    expect(payload.lineItems).toEqual([
      expect.objectContaining({
        sku: 'FRT-LTL-PALLET',
        quantity: '8',
        kind: 'service',
        productName: 'Groupage (LTL) road freight, per pallet',
      }),
    ])
  })

  it('never writes a unitPrice, because there is nowhere for one to come from', () => {
    const payload = toDraftOfferPayload(validExtraction(), SENDER) as {
      lineItems: Record<string, unknown>[]
    }
    for (const line of payload.lineItems) {
      expect(line.unitPrice).toBeUndefined()
    }
  })

  it('falls back to the sender when the model leaves the customer blank', () => {
    const payload = toDraftOfferPayload(
      validExtraction({ customerName: '   ' }),
      SENDER,
    ) as Record<string, unknown>

    expect(payload.customerName).toBe('Nordwind Spedition')
  })

  it('uppercases a lower-cased currency and defaults an empty one to EUR', () => {
    expect(
      (toDraftOfferPayload(validExtraction({ currencyCode: 'eur' }), SENDER) as Record<string, unknown>)
        .currencyCode,
    ).toBe('EUR')
    expect(
      (toDraftOfferPayload(validExtraction({ currencyCode: '' }), SENDER) as Record<string, unknown>)
        .currencyCode,
    ).toBe('EUR')
  })

  it('drops the empty strings the schema forces the model to send', () => {
    const payload = toDraftOfferPayload(
      validExtraction({ notes: '', requestedDeliveryDate: '' }),
      SENDER,
    ) as Record<string, unknown>

    expect(payload.notes).toBeUndefined()
    expect(payload.requestedDeliveryDate).toBeUndefined()
  })

  it('rejects a line the payload contract cannot accept', () => {
    expect(() =>
      toDraftOfferPayload(
        validExtraction({
          lineItems: [{ sku: '', productName: '', quantity: 1, description: '' }],
        }),
        SENDER,
      ),
    ).toThrow()
  })
})

describe('buildFreightSystemPrompt', () => {
  const catalogue = [
    { id: 'p-1', name: 'Groupage (LTL) road freight, per pallet', sku: 'FRT-LTL-PALLET', price: '68.00' },
  ]

  it('carries the SKUs the model is allowed to use', () => {
    const prompt = buildFreightSystemPrompt(catalogue)
    expect(prompt).toContain('FRT-LTL-PALLET')
    expect(prompt).toContain('Every sku you may use, and nothing else')
  })

  it('reuses the action definition\'s own rules instead of a second copy', () => {
    const prompt = buildFreightSystemPrompt(catalogue)
    expect(prompt).toContain('NEVER supply unitPrice')
    expect(prompt).toContain('copied verbatim')
  })

  it('tells the model to stand down when the seller has no catalogue', () => {
    expect(buildFreightSystemPrompt([])).toContain('propose no lineItems')
  })
})
