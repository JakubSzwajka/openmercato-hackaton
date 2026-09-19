import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// Knowing exception, read-only: `inbox_ops` hands an execution context whose
// `CrossModuleEntities` map (executionEngine.ts:26-33) covers customers, sales
// and dictionaries, and stops there. There is no catalog entry, and catalog
// prices are not in the query index, so the list price has to be read from the
// installed catalog entities directly.
//
// This is a scoped SELECT, not a cross-module ORM relation: no entity of ours
// declares a foreign key against catalog, nothing here writes, and every query
// below is filtered by tenant and organization.
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import {
  resolveVariantForLine,
  type VariantResolutionSource,
} from './variantResolver'

/**
 * Price kind this app quotes at.
 *
 * `regular` is the list price. The `sale` kind exists in the same table and is
 * deliberately ignored: this build applies no discounts of any kind, so a quote
 * drafted from an email is always priced at list. Anything cheaper is a
 * salesperson's decision, taken in the sales UI, on the record.
 */
export const LIST_PRICE_KIND_CODE = 'regular'

export type PricingScope = {
  tenantId: string
  organizationId: string
}

/** One thing a customer asked for, reduced to an identifier and an amount. */
export type PriceableLine = {
  /** Catalog variant id. Preferred identifier. */
  variantId?: string | null
  /** Catalog variant SKU. Used only when no variant id is known. */
  sku?: string | null
  /**
   * Catalog PRODUCT id. Present because the extraction prompt shows the model
   * product rows, so a product id is a thing it can honestly return.
   * `resolveVariantForLine` turns it into the variant that carries the price.
   */
  productId?: string | null
  /** How many units. Already parsed; never a string from a model. */
  quantity: number
  /** Human label, used in messages only. Never used to look anything up. */
  label: string
}

export type PricedLine = {
  label: string
  quantity: number
  variantId: string
  productId: string
  sku: string | null
  /** The `catalog_product_variant_prices` row this money came from. */
  priceId: string
  /** Net unit price, verbatim from the catalog row. */
  unitPriceNet: string
  currencyCode: string
  /** Display only. Core recomputes the authoritative total from the unit price. */
  lineTotalNet: string
  /** Which identifier actually found the variant. Reported so a run full of
   * rescues is visible as a prompt problem rather than passing silently. */
  resolvedBy: VariantResolutionSource
}

export type PricingFailure = {
  index: number
  label: string
  reason: 'variant_not_resolved' | 'no_price_in_currency'
  detail: string
}

/**
 * Raised when at least one line could not be priced from the catalog.
 *
 * Carries every failure, not just the first, so an operator fixes the catalog
 * once instead of re-running to discover the next missing price.
 */
export class CatalogPricingError extends Error {
  readonly failures: PricingFailure[]

  constructor(failures: PricingFailure[]) {
    super(
      `Could not price ${failures.length} line(s) from the catalog:\n` +
        failures.map((f) => `  - line ${f.index + 1} "${f.label}": ${f.detail}`).join('\n'),
    )
    this.name = 'CatalogPricingError'
    this.failures = failures
  }
}

type PriceRow = {
  id: string
  currencyCode: string
  kind: string
  minQuantity: number
  maxQuantity?: number | null
  unitPriceNet?: string | null
  channelId?: string | null
  startsAt?: Date | null
  endsAt?: Date | null
  createdAt: Date
}

/**
 * Multiplies a 4-decimal catalog amount by a quantity without float drift.
 *
 * Display only. The stored line total is whatever `salesCalculationService`
 * computes inside `sales.quotes.create`; this exists so the CLI can print a
 * total next to the unit price it just resolved.
 */
function multiplyAmount(unitPriceNet: string, quantity: number): string {
  const units = Math.round(Number(unitPriceNet) * 10_000)
  const qty = Math.round(quantity * 10_000)
  const product = (units * qty) / 10_000
  return (product / 10_000).toFixed(2)
}

/**
 * Picks the one price row that applies, deterministically.
 *
 * Ordering, in the order it is applied:
 *   1. a price bound to the quote's channel beats a global one,
 *   2. the highest `minQuantity` the requested quantity reaches (quantity
 *      breaks are a property of the table, so they are honoured),
 *   3. the newest row, then the lowest id, so two equal candidates never
 *      resolve differently between runs.
 */
function selectApplicablePrice(
  rows: PriceRow[],
  params: { currencyCode: string; channelId: string | null; quantity: number; now: Date },
): PriceRow | null {
  const applicable = rows.filter((row) => {
    if (row.currencyCode.toUpperCase() !== params.currencyCode) return false
    if (row.kind !== LIST_PRICE_KIND_CODE) return false
    if (row.unitPriceNet == null) return false
    if (row.channelId != null && row.channelId !== params.channelId) return false
    if (row.minQuantity > params.quantity) return false
    if (row.maxQuantity != null && row.maxQuantity < params.quantity) return false
    if (row.startsAt && row.startsAt.getTime() > params.now.getTime()) return false
    if (row.endsAt && row.endsAt.getTime() <= params.now.getTime()) return false
    return true
  })

  applicable.sort((a, b) => {
    const channelRank = Number(b.channelId != null) - Number(a.channelId != null)
    if (channelRank !== 0) return channelRank
    if (a.minQuantity !== b.minQuantity) return b.minQuantity - a.minQuantity
    const created = b.createdAt.getTime() - a.createdAt.getTime()
    if (created !== 0) return created
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return applicable[0] ?? null
}

/**
 * THE function that turns identifiers into money.
 *
 * A model may propose WHAT the customer asked for. It may never decide WHAT IT
 * COSTS. It is not kept ignorant of prices, and it could not be: core puts a
 * `price` on every catalogue product it shows the model
 * (`inbox_ops/lib/catalogLookup.ts:91-96`). The guarantee is structural
 * instead. This function takes identifiers and quantities and nothing else:
 * no prices, no names to match on, no free text. Every amount it returns was
 * read from `catalog_product_variant_prices` inside the caller's tenant and
 * organization. Give it an identifier and a quantity and it answers with money;
 * give it a price and it has no parameter to put it in.
 *
 * That is the whole seam, and a live extraction model now sits in front of it.
 * `resolveVariantForLine` widens which IDENTIFIERS are accepted (SKU, product
 * id, a product id the model labelled `variantId`) because those are what core
 * shows the model. It does not widen what a model can influence: there is still
 * no price parameter anywhere on this path.
 *
 * Throws `CatalogPricingError` when any line cannot be priced. It never returns
 * a partial list and never falls back to zero: a silently zero-priced line is a
 * quote a person can send.
 */
export async function priceLinesFromCatalog(
  em: EntityManager,
  scope: PricingScope,
  request: {
    currencyCode: string
    channelId?: string | null
    lines: PriceableLine[]
  },
): Promise<PricedLine[]> {
  const currencyCode = request.currencyCode.trim().toUpperCase()
  const channelId = request.channelId ?? null
  const now = new Date()

  const priced: PricedLine[] = []
  const failures: PricingFailure[] = []

  for (const [index, line] of request.lines.entries()) {
    const resolution = await resolveVariantForLine(em, scope, line)
    if (!resolution) {
      failures.push({
        index,
        label: line.label,
        reason: 'variant_not_resolved',
        detail: describeUnresolved(line),
      })
      continue
    }
    const variant = resolution.variant

    const rows = (await findWithDecryption(
      em,
      CatalogProductPrice,
      {
        variant: variant.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as never,
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )) as unknown as PriceRow[]

    const row = selectApplicablePrice(rows, {
      currencyCode,
      channelId,
      quantity: line.quantity,
      now,
    })

    if (!row) {
      failures.push({
        index,
        label: line.label,
        reason: 'no_price_in_currency',
        detail:
          `variant ${variant.id}${variant.sku ? ` (${variant.sku})` : ''} has no active ` +
          `${LIST_PRICE_KIND_CODE} price in ${currencyCode} for quantity ${line.quantity}`,
      })
      continue
    }

    priced.push({
      label: line.label,
      quantity: line.quantity,
      variantId: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      priceId: row.id,
      unitPriceNet: row.unitPriceNet!,
      currencyCode,
      lineTotalNet: multiplyAmount(row.unitPriceNet!, line.quantity),
      resolvedBy: resolution.source,
    })
  }

  if (failures.length > 0) throw new CatalogPricingError(failures)
  return priced
}

/**
 * Names every identifier the line carried, so the reviewer can tell "the model
 * gave us nothing" apart from "the model gave us a SKU this catalogue does not
 * sell". Those need different fixes.
 */
function describeUnresolved(line: PriceableLine): string {
  const given: string[] = []
  if (line.variantId) given.push(`variantId ${line.variantId}`)
  if (line.sku) given.push(`SKU "${line.sku}"`)
  if (line.productId) given.push(`productId ${line.productId}`)
  if (given.length === 0) {
    return 'the line carries no variantId, sku or productId, so no catalog price can be read'
  }
  return `no single active catalog variant in this organization matches ${given.join(' / ')}`
}
