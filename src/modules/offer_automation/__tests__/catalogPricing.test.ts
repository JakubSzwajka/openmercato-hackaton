// Explicit imports rather than ambient globals, for the same reason as
// `coreRequiredFeatureShim.test.ts`: `@types/jest` is not in the tsconfig
// typeRoots resolution for this app.
import { describe, expect, it } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogPricingError,
  LIST_PRICE_KIND_CODE,
  priceLinesFromCatalog,
} from '../lib/catalogPricing'

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const VARIANT_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const CHANNEL_ID = '55555555-5555-4555-8555-555555555555'

type Row = Record<string, unknown>

/**
 * Stands in for the EntityManager so the pricing rules can be pinned without a
 * database. `findWithDecryption` calls `em.find` and then a decryption pass that
 * is a no-op for plain rows, so returning arrays from `find` is enough.
 */
function matchesVariantWhere(row: Row, where: Record<string, unknown>): boolean {
  if (where.id && row.id !== where.id) return false
  if (where.sku !== undefined) {
    const wanted = where.sku as string | { $in: string[] }
    if (typeof wanted === 'string') {
      if (row.sku !== wanted) return false
    } else if (!wanted.$in.includes(row.sku as string)) {
      return false
    }
  }
  if (where.product) {
    const productId =
      typeof row.product === 'string' ? row.product : (row.product as { id: string }).id
    if (productId !== where.product) return false
  }
  // The resolver always filters on these two; a stub that ignored them would
  // let a test pass against a row the real query would never return.
  if (where.isActive === true && row.isActive === false) return false
  if (where.deletedAt === null && row.deletedAt != null) return false
  return true
}

function stubEm(byEntity: { variants: Row[]; prices: Row[] }): EntityManager {
  return {
    find: async (entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string }).name ?? String(entity)
      if (name.includes('Variant')) {
        return byEntity.variants.filter((row) => matchesVariantWhere(row, where))
      }
      return byEntity.prices.filter((row) => !where.variant || row.variant === where.variant)
    },
    getMetadata: () => ({ find: () => undefined }),
  } as unknown as EntityManager
}

function variant(overrides: Row = {}): Row {
  return {
    id: VARIANT_ID,
    sku: 'FRT-LTL-PALLET',
    product: { id: PRODUCT_ID },
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

function price(overrides: Row = {}): Row {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    currencyCode: 'EUR',
    kind: LIST_PRICE_KIND_CODE,
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: '68.0000',
    channelId: null,
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    variant: VARIANT_ID,
    ...overrides,
  }
}

describe('priceLinesFromCatalog', () => {
  it('reads the unit price from the catalogue and never from the caller', async () => {
    const em = stubEm({ variants: [variant()], prices: [price()] })

    const [line] = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'eur',
      channelId: CHANNEL_ID,
      lines: [{ variantId: VARIANT_ID, quantity: 8, label: 'Groupage' }],
    })

    expect(line).toMatchObject({
      variantId: VARIANT_ID,
      productId: PRODUCT_ID,
      unitPriceNet: '68.0000',
      currencyCode: 'EUR',
      lineTotalNet: '544.00',
    })
  })

  it('ignores a promotional price: this build quotes at list', async () => {
    const em = stubEm({
      variants: [variant()],
      prices: [
        price(),
        price({ id: '77777777-7777-4777-8777-777777777777', kind: 'sale', unitPriceNet: '48.0000' }),
      ],
    })

    const [line] = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ variantId: VARIANT_ID, quantity: 1, label: 'Groupage' }],
    })

    expect(line!.unitPriceNet).toBe('68.0000')
  })

  it('prefers a price bound to the quote channel over the global one', async () => {
    const em = stubEm({
      variants: [variant()],
      prices: [
        price(),
        price({
          id: '88888888-8888-4888-8888-888888888888',
          channelId: CHANNEL_ID,
          unitPriceNet: '62.0000',
        }),
      ],
    })

    const [line] = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      channelId: CHANNEL_ID,
      lines: [{ variantId: VARIANT_ID, quantity: 4, label: 'Groupage' }],
    })

    expect(line!.unitPriceNet).toBe('62.0000')
  })

  it('takes the best quantity break the requested quantity reaches', async () => {
    const em = stubEm({
      variants: [variant()],
      prices: [
        price(),
        price({ id: '99999999-9999-4999-8999-999999999999', minQuantity: 10, unitPriceNet: '59.0000' }),
      ],
    })

    const cheap = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ variantId: VARIANT_ID, quantity: 12, label: 'Groupage' }],
    })
    const listed = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ variantId: VARIANT_ID, quantity: 9, label: 'Groupage' }],
    })

    expect(cheap[0]!.unitPriceNet).toBe('59.0000')
    expect(listed[0]!.unitPriceNet).toBe('68.0000')
  })

  it('throws instead of returning a zero when the variant does not resolve', async () => {
    const em = stubEm({ variants: [], prices: [] })

    await expect(
      priceLinesFromCatalog(em, SCOPE, {
        currencyCode: 'EUR',
        lines: [{ variantId: VARIANT_ID, quantity: 1, label: 'Ghost service' }],
      }),
    ).rejects.toMatchObject({
      name: 'CatalogPricingError',
      failures: [{ index: 0, label: 'Ghost service', reason: 'variant_not_resolved' }],
    })
  })

  it('throws instead of returning a zero when no price exists in the quote currency', async () => {
    const em = stubEm({ variants: [variant()], prices: [price({ currencyCode: 'USD' })] })

    const error = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ variantId: VARIANT_ID, quantity: 1, label: 'Groupage' }],
    }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(CatalogPricingError)
    expect((error as CatalogPricingError).failures[0]!.reason).toBe('no_price_in_currency')
  })

  it('reports every unpriceable line at once, not just the first', async () => {
    const em = stubEm({ variants: [], prices: [] })

    const error = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [
        { variantId: VARIANT_ID, quantity: 1, label: 'First' },
        { sku: 'NOPE', quantity: 2, label: 'Second' },
        { quantity: 3, label: 'Third' },
      ],
    }).catch((err: unknown) => err as CatalogPricingError)

    expect((error as CatalogPricingError).failures).toHaveLength(3)
    expect((error as CatalogPricingError).failures[2]!.detail).toContain(
      'no variantId, sku or productId',
    )
  })
})

/**
 * The adapter between what an extraction model can say and what pricing needs.
 * Core shows the model PRODUCT rows; the price hangs off a VARIANT.
 */
describe('priceLinesFromCatalog, identifiers a model can actually produce', () => {
  it('prices a line that carries only the SKU the model was shown', async () => {
    const em = stubEm({ variants: [variant()], prices: [price()] })

    const [line] = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ sku: 'FRT-LTL-PALLET', quantity: 8, label: 'Groupage' }],
    })

    expect(line).toMatchObject({ variantId: VARIANT_ID, unitPriceNet: '68.0000', resolvedBy: 'sku' })
  })

  it('accepts a SKU the model lower-cased or padded, and says so', async () => {
    const em = stubEm({ variants: [variant()], prices: [price()] })

    const [line] = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ sku: '  frt-ltl-pallet ', quantity: 2, label: 'Groupage' }],
    })

    expect(line).toMatchObject({ variantId: VARIANT_ID, resolvedBy: 'sku_normalized' })
  })

  it('resolves a product id to that product\'s only variant', async () => {
    const em = stubEm({ variants: [variant()], prices: [price()] })

    const [line] = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ productId: PRODUCT_ID, quantity: 1, label: 'Groupage' }],
    })

    expect(line).toMatchObject({ variantId: VARIANT_ID, resolvedBy: 'product_id' })
  })

  it('rescues a product id the model labelled variantId', async () => {
    // The likeliest model mistake: the prompt lists product ids, the schema
    // field is called variantId.
    const em = stubEm({ variants: [variant()], prices: [price()] })

    const [line] = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ variantId: PRODUCT_ID, quantity: 3, label: 'Groupage' }],
    })

    expect(line).toMatchObject({
      variantId: VARIANT_ID,
      resolvedBy: 'variant_id_was_product_id',
    })
  })

  it('picks the default variant when a product has several', async () => {
    const second = variant({ id: '12121212-1212-4121-8121-121212121212', sku: 'FRT-LTL-PALLET-XL' })
    const em = stubEm({
      variants: [variant({ isDefault: true }), second],
      prices: [price()],
    })

    const [line] = await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ productId: PRODUCT_ID, quantity: 1, label: 'Groupage' }],
    })

    expect(line!.variantId).toBe(VARIANT_ID)
  })

  it('refuses rather than guessing when a product has several variants and no default', async () => {
    const second = variant({ id: '12121212-1212-4121-8121-121212121212', sku: 'FRT-LTL-PALLET-XL' })
    const em = stubEm({ variants: [variant(), second], prices: [price()] })

    await expect(
      priceLinesFromCatalog(em, SCOPE, {
        currencyCode: 'EUR',
        lines: [{ productId: PRODUCT_ID, quantity: 1, label: 'Groupage' }],
      }),
    ).rejects.toMatchObject({ failures: [{ reason: 'variant_not_resolved' }] })
  })

  it('never resolves an inactive variant, whichever identifier was used', async () => {
    const em = stubEm({ variants: [variant({ isActive: false })], prices: [price()] })

    await expect(
      priceLinesFromCatalog(em, SCOPE, {
        currencyCode: 'EUR',
        lines: [{ sku: 'FRT-LTL-PALLET', quantity: 1, label: 'Groupage' }],
      }),
    ).rejects.toMatchObject({ failures: [{ reason: 'variant_not_resolved' }] })
  })

  it('names every identifier the line carried when nothing matches', async () => {
    const em = stubEm({ variants: [], prices: [] })

    const error = (await priceLinesFromCatalog(em, SCOPE, {
      currencyCode: 'EUR',
      lines: [{ sku: 'FRT-SEA-CONTAINER', quantity: 1, label: 'Ocean freight' }],
    }).catch((err: unknown) => err)) as CatalogPricingError

    expect(error.failures[0]!.detail).toContain('FRT-SEA-CONTAINER')
  })
})
