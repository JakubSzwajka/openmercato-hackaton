import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { buildSeedCommandContext } from './seedCommandContext'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// Knowing exception, read-only: the seed reads the installed catalog entities to
// find out what already exists, so a second run is a no-op. Every write below
// goes through core's own commands (`catalog.priceKinds.create`,
// `catalog.products.create`, `catalog.variants.create`, `catalog.prices.create`),
// never through `em.persist`.
import {
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import { LIST_PRICE_KIND_CODE } from './catalogPricing'

/**
 * The transport services this app sells.
 *
 * DELIBERATELY THE SIMPLE MODEL. Real road freight is priced per lane, per
 * weight band, with fuel, toll and currency surcharges that move week to week.
 * A catalog price is one number per variant per currency, and that is exactly
 * what this seeds. Nothing here is a rate engine, and it must not be mistaken
 * for one: the unit is stated in the product title and in the description so a
 * salesperson reading the quote can see what the number is per.
 */
export const FREIGHT_CURRENCY = 'EUR'

export type FreightServiceDefinition = {
  /** Stable identifier. Also the lookup key that makes the seed idempotent. */
  sku: string
  title: string
  /** What one unit of this service is. Appears in the title and description. */
  unitLabel: string
  description: string
  /** Net list price in `FREIGHT_CURRENCY`, per `unitLabel`. */
  unitPriceNet: string
}

export const FREIGHT_SERVICES: readonly FreightServiceDefinition[] = [
  {
    sku: 'FRT-FTL-SHIPMENT',
    title: 'Full truckload road freight, per shipment',
    unitLabel: 'shipment',
    description:
      'Dedicated 13.6 m curtainsider, exclusive use, door to door. Priced per shipment on a named route, one loading and one unloading point.',
    unitPriceNet: '1450.00',
  },
  {
    sku: 'FRT-LTL-PALLET',
    title: 'Groupage (LTL) road freight, per pallet',
    unitLabel: 'pallet',
    description:
      'Shared-load groupage for standard EUR pallets up to 1.8 m high and 800 kg. Priced per pallet.',
    unitPriceNet: '68.00',
  },
  {
    sku: 'FRT-ROAD-KM',
    title: 'Long-distance road transport, per kilometre',
    unitLabel: 'km',
    description:
      'Distance-based line haul for non-standard loads, billed on the routed distance. Priced per kilometre.',
    unitPriceNet: '1.35',
  },
  {
    sku: 'FRT-ACC-TAILLIFT',
    title: 'Tail-lift delivery, per stop',
    unitLabel: 'stop',
    description:
      'Accessorial for sites with no loading dock: tail-lift vehicle and ground-level handover. Priced per delivery stop.',
    unitPriceNet: '45.00',
  },
]

export type SeededServiceRow = {
  sku: string
  title: string
  productId: string
  variantId: string
  priceId: string
  unitPriceNet: string
  /** What this run actually had to create. Everything false means a no-op. */
  created: { product: boolean; variant: boolean; price: boolean }
}

export type FreightCatalogSeedResult = {
  priceKindId: string
  priceKindCreated: boolean
  rows: SeededServiceRow[]
  createdCount: number
}

export type SeedScope = {
  tenantId: string
  organizationId: string
  /** Acting user. Recorded as the operation-log actor for every command below. */
  actorUserId: string
}

async function run<TResult>(
  container: AwilixContainer,
  scope: SeedScope,
  commandId: string,
  input: Record<string, unknown>,
): Promise<TResult> {
  const commandBus = container.resolve('commandBus') as CommandBus
  if (!commandBus || typeof commandBus.execute !== 'function') {
    throw new Error('Command bus is not available; cannot seed the catalog through core commands.')
  }
  const { result } = await commandBus.execute<Record<string, unknown>, TResult>(commandId, {
    input,
    ctx: buildSeedCommandContext(container, scope),
  })
  return result
}

/**
 * Resolves the tenant's list price kind, creating it only if the tenant has none.
 *
 * `regular` is what a stock install seeds, so on this machine the create branch
 * never runs. It exists so a bare tenant can still be demoed.
 */
async function ensureListPriceKind(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope,
): Promise<{ priceKindId: string; created: boolean }> {
  const existing = (await findOneWithDecryption(
    em,
    CatalogPriceKind,
    { code: LIST_PRICE_KIND_CODE, tenantId: scope.tenantId, deletedAt: null } as never,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )) as { id: string } | null
  if (existing) return { priceKindId: existing.id, created: false }

  const result = await run<{ priceKindId: string }>(
    container,
    scope,
    'catalog.priceKinds.create',
    {
      tenantId: scope.tenantId,
      code: LIST_PRICE_KIND_CODE,
      title: 'Regular',
      displayMode: 'excluding-tax',
      isPromotion: false,
      isActive: true,
    },
  )
  return { priceKindId: result.priceKindId, created: true }
}

/**
 * Puts the four transport services in the catalog, once.
 *
 * Idempotent by SKU at all three levels: product, variant, price. A second run
 * finds each row, reuses it and creates nothing, so the demo can be re-run as
 * often as an operator likes.
 *
 * An existing price is left exactly as it is. If someone edited a price in the
 * backend, the seed is not entitled to overwrite that; it only guarantees that
 * SOME active list price exists in `FREIGHT_CURRENCY`.
 */
export async function seedFreightServices(
  container: AwilixContainer,
  scope: SeedScope,
): Promise<FreightCatalogSeedResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  const { priceKindId, created: priceKindCreated } = await ensureListPriceKind(em, container, scope)

  const rows: SeededServiceRow[] = []

  for (const service of FREIGHT_SERVICES) {
    const created = { product: false, variant: false, price: false }

    let productId = await findProductIdBySku(em, scope, service.sku)
    if (!productId) {
      const result = await run<{ productId: string }>(container, scope, 'catalog.products.create', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        title: service.title,
        sku: service.sku,
        description: service.description,
        productType: 'simple',
        primaryCurrencyCode: FREIGHT_CURRENCY,
        // A transport service is not shipped, and it is never physically stocked.
        requiresShipping: false,
        isActive: true,
      })
      productId = result.productId
      created.product = true
    }

    let variantId = await findVariantIdBySku(em, scope, service.sku)
    if (!variantId) {
      const result = await run<{ variantId: string }>(container, scope, 'catalog.variants.create', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        productId,
        name: service.title,
        sku: service.sku,
        isDefault: true,
        isActive: true,
      })
      variantId = result.variantId
      created.variant = true
    }

    const price = await ensureListPrice(em, container, scope, variantId, priceKindId, service)
    const priceId = price.priceId
    const unitPriceNet = price.unitPriceNet
    created.price = price.created

    rows.push({
      sku: service.sku,
      title: service.title,
      productId,
      variantId,
      priceId,
      unitPriceNet,
      created,
    })
  }

  const createdCount = rows.reduce(
    (total, row) => total + Number(row.created.product) + Number(row.created.variant) + Number(row.created.price),
    priceKindCreated ? 1 : 0,
  )

  return { priceKindId, priceKindCreated, rows, createdCount }
}

/**
 * Resolves the variant's list price, creating it at most once across concurrent runs.
 *
 * THE RACE THIS CLOSES. `catalog_product_variant_prices` has NO unique
 * constraint on `(variant, currency, kind, min_quantity, channel_id)` — only
 * two plain lookup indexes (`catalog/data/entities.ts:778-828`). Products and
 * variants are protected by unique SKUs; prices are not. So the plain
 * find-then-create this replaced was a real time-of-check/time-of-use gap: two
 * seeds running at once both read "no price", both created one, and the variant
 * ended up with two active list prices.
 *
 * THE FIX WE ARE ALLOWED TO MAKE. Adding the missing unique index is the right
 * repair and is not ours to make — that is a core table and this app does not
 * migrate installed modules. Logged as an upstream observation instead. What we
 * can own is the critical section: a transaction-scoped Postgres advisory lock
 * keyed on the exact price identity, taken before the re-check, so a second run
 * waits outside until the first has committed and then finds the row instead of
 * adding one. Same mechanism core uses for the same shape of problem
 * (`notifications/lib/notificationService.ts:196-199`,
 * `attachments/lib/quota-service.ts:146`).
 *
 * WHAT IT DOES NOT COVER, stated plainly. The `catalog.prices.create` command
 * resolves its own EntityManager fork, so its INSERT commits on a different
 * connection and is NOT inside this transaction — the lock gives mutual
 * exclusion between callers of this function, not atomicity of the write. A
 * writer that does not take this lock (the backend price editor, core's own
 * seeds, hand-written SQL) can still insert a duplicate, and only the missing
 * database constraint could stop that.
 *
 * A DUPLICATE, IF ONE EVER EXISTS, RESOLVES PREDICTABLY. `selectApplicablePrice`
 * in `catalogPricing.ts:132-158` sorts channel-specific before channel-less,
 * then the highest matching `minQuantity`, then the newest `createdAt`, then
 * the lowest id. That chain is total and its last key is unique, so the quote
 * picks the same row on every run rather than whichever one the database
 * happened to return first. Two identical seed rows differ only in id, so the
 * lower id wins, deterministically.
 *
 * Exported for the unit test only; the seed reaches it through
 * `seedFreightServices`.
 */
export async function ensureListPrice(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope,
  variantId: string,
  priceKindId: string,
  service: FreightServiceDefinition,
): Promise<{ priceId: string; unitPriceNet: string; created: boolean }> {
  const lockKey = listPriceLockKey(scope, variantId)

  return em.transactional(async (tem) => {
    try {
      // `em.execute` runs on the transaction's pinned connection
      // (`@mikro-orm/sql/SqlEntityManager.js:71`), which is what makes this an
      // xact lock on the right session rather than a stray one on a pool
      // connection nobody holds.
      await tem.execute('select pg_advisory_xact_lock(hashtext(?))', [lockKey])
    } catch {
      // Degrade to the old best-effort behaviour rather than failing the seed,
      // exactly as core does: a database without advisory locks leaves the
      // original race, and the re-check below is still worth doing.
    }

    // Re-read INSIDE the lock. At READ COMMITTED this statement takes a fresh
    // snapshot after the lock is granted, so it sees the row a run that went
    // first has just committed.
    const existing = await findListPrice(tem, scope, variantId)
    if (existing) return { priceId: existing.id, unitPriceNet: existing.unitPriceNet, created: false }

    const result = await run<{ priceId: string }>(container, scope, 'catalog.prices.create', {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      variantId,
      currencyCode: FREIGHT_CURRENCY,
      priceKindId,
      minQuantity: 1,
      unitPriceNet: service.unitPriceNet,
      // No channel binding on purpose: this is the list price for every
      // channel. A channel-specific row would win over it if one is ever
      // added, which is what `priceLinesFromCatalog` already implements.
    })
    return { priceId: result.priceId, unitPriceNet: service.unitPriceNet, created: true }
  })
}

/**
 * The advisory-lock key.
 *
 * Names the ROW identity, not the service: the same five columns
 * `findListPrice` filters on. A key any coarser would serialise unrelated
 * variants; any finer would not cover the row two runs are racing for.
 */
export function listPriceLockKey(
  scope: { tenantId: string; organizationId: string },
  variantId: string,
): string {
  return `offer_automation:freight-list-price:${scope.tenantId}:${scope.organizationId}`
    + `:${variantId}:${FREIGHT_CURRENCY}:${LIST_PRICE_KIND_CODE}:1`
}

async function findProductIdBySku(
  em: EntityManager,
  scope: SeedScope,
  sku: string,
): Promise<string | null> {
  const found = (await findOneWithDecryption(
    em,
    CatalogProduct,
    {
      sku,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as never,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )) as { id: string } | null
  return found?.id ?? null
}

async function findVariantIdBySku(
  em: EntityManager,
  scope: SeedScope,
  sku: string,
): Promise<string | null> {
  const found = (await findOneWithDecryption(
    em,
    CatalogProductVariant,
    {
      sku,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as never,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )) as { id: string } | null
  return found?.id ?? null
}

async function findListPrice(
  em: EntityManager,
  scope: SeedScope,
  variantId: string,
): Promise<{ id: string; unitPriceNet: string } | null> {
  const found = (await findOneWithDecryption(
    em,
    CatalogProductPrice,
    {
      variant: variantId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      currencyCode: FREIGHT_CURRENCY,
      kind: LIST_PRICE_KIND_CODE,
      minQuantity: 1,
      channelId: null,
    } as never,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )) as { id: string; unitPriceNet?: string | null } | null
  if (!found || found.unitPriceNet == null) return null
  return { id: found.id, unitPriceNet: found.unitPriceNet }
}
