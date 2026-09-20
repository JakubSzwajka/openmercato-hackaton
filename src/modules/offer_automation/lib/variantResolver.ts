import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// Knowing exception, read-only. Same reason as `catalogPricing.ts`: the
// inbox_ops execution context exposes no catalog entity, so the variant a line
// refers to has to be read from the installed catalog entities directly. Scoped
// SELECTs only; nothing here writes and no entity of ours points at catalog.
import { CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'

/**
 * Bridges what an extraction model can say to what pricing needs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Core builds the extraction prompt from PRODUCT rows: `catalogLookup.ts`
 * (`fetchCatalogProductsForExtraction`) hands the model `{ id, name, sku,
 * price }` where `id` is a `catalog_products` id. Our pricing reads
 * `catalog_product_variant_prices`, which hangs off a VARIANT. So the two
 * honest things a model can return — a SKU it was shown, or the product id it
 * was shown — are both one hop away from the row that carries the money.
 *
 * This module is that hop, and nothing else. It never invents an identifier,
 * never falls back to matching on a product name, and never returns a variant
 * when the answer is ambiguous. Give it garbage and it answers `null`, which
 * the caller turns into a refusal.
 *
 * THE SKU PATH RESTS ON OUR OWN SEED, NOT ON A CATALOG GUARANTEE
 * --------------------------------------------------------------
 * The model is shown a PRODUCT's `sku`. This resolver looks that string up as a
 * VARIANT sku. Those are two different columns, and the catalog does not
 * require them to agree. They agree here because `lib/freightCatalog.ts` writes
 * the same `service.sku` to the product and to its default variant.
 *
 * A real catalog whose product SKUs differ from its variant SKUs would miss
 * every line. It would miss LOUDLY, not quietly: an unmatched line fails the
 * whole action with no quote created (`priceLinesFromCatalog`), so the failure
 * mode is a refusal a reviewer reads, not a wrong price on a document.
 *
 * The product-id paths below exist for exactly that catalog. A model that
 * returns the `id` it was shown, rather than the `sku`, resolves through the
 * product's variants and needs no SKU agreement at all.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not widen what a model can influence. A model still names a thing; it
 * still cannot name a price, because there is no price parameter anywhere in
 * this file or in `priceLinesFromCatalog`.
 */

export type VariantScope = {
  tenantId: string
  organizationId: string
}

/** What a model may have put on a line, before any of it is trusted. */
export type VariantIdentifiers = {
  /** A UUID the model called a variant id. Often a PRODUCT id in practice. */
  variantId?: string | null
  /** A SKU. The identifier the prompt asks for, because the model is shown it. */
  sku?: string | null
  /** A UUID the model called a product id. */
  productId?: string | null
}

export type ResolvedVariant = {
  id: string
  sku: string | null
  productId: string
}

/**
 * Which identifier actually produced the answer.
 *
 * Reported so an operator can tell a clean SKU match apart from a rescue: a run
 * full of `variant_id_was_product_id` means the prompt is misleading the model,
 * which is a prompt bug, not a data bug.
 */
export type VariantResolutionSource =
  | 'variant_id'
  | 'sku'
  | 'sku_normalized'
  | 'product_id'
  | 'variant_id_was_product_id'

export type VariantResolution = {
  variant: ResolvedVariant
  source: VariantResolutionSource
}

type VariantRow = {
  id: string
  sku?: string | null
  product: { id: string } | string
  isDefault?: boolean
}

function productIdOf(row: VariantRow): string {
  return typeof row.product === 'string' ? row.product : row.product.id
}

function toResolved(row: VariantRow): ResolvedVariant {
  return { id: row.id, sku: row.sku ?? null, productId: productIdOf(row) }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * SKU spellings worth trying, in order of how much they trust the model.
 *
 * A model asked for `FRT-LTL-PALLET` returns `frt-ltl-pallet` or a padded copy
 * often enough to matter, and none of those spellings changes which row is
 * meant. Anything beyond case and whitespace would be guessing, so the list
 * stops there.
 */
function skuCandidates(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of [raw, raw.trim(), raw.trim().toUpperCase(), raw.trim().toLowerCase()]) {
    if (candidate.length === 0 || seen.has(candidate)) continue
    seen.add(candidate)
    out.push(candidate)
  }
  return out
}

async function findVariants(
  em: EntityManager,
  scope: VariantScope,
  where: Record<string, unknown>,
  limit = 2,
): Promise<VariantRow[]> {
  const rows = (await findWithDecryption(
    em,
    CatalogProductVariant,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
      deletedAt: null,
      ...where,
    } as never,
    { limit, orderBy: { id: 'ASC' } } as never,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )) as unknown as VariantRow[]
  return rows
}

/** Exactly one match, or nothing. Two matches is ambiguity, and a guess there
 * puts one service's price on another service's line. */
function only(rows: VariantRow[]): VariantRow | null {
  return rows.length === 1 ? rows[0]! : null
}

/**
 * Picks the variant that represents a product.
 *
 * A product with one active variant resolves to it. A product with several
 * resolves to the one flagged `isDefault`, because that is the row the catalog
 * UI treats as the product's own. Several variants and no default is ambiguous
 * and returns nothing.
 */
async function resolveByProductId(
  em: EntityManager,
  scope: VariantScope,
  productId: string,
): Promise<VariantRow | null> {
  // `limit: 10` rather than 2: with several variants the default has to be
  // found among them, and a service catalog product does not have hundreds.
  const rows = await findVariants(em, scope, { product: productId }, 10)
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]!
  const defaults = rows.filter((row) => row.isDefault === true)
  return defaults.length === 1 ? defaults[0]! : null
}

/**
 * Resolves one extracted line to the catalog variant that carries its price.
 *
 * Order, most trusted first:
 *   1. `variantId` as a real variant id,
 *   2. `sku` exactly as written, then with case and whitespace normalised,
 *   3. `productId` as a product, through its single or default variant,
 *   4. `variantId` as a PRODUCT id. This is the rescue: the model was shown
 *      product ids and asked for a variant id, so confusing the two is the
 *      likeliest mistake it can make, and the answer is unambiguous when the
 *      id really is a product in this organization.
 *
 * Returns `null` when nothing matches or when a match is ambiguous. Every query
 * is filtered by tenant and organization and by `isActive`.
 */
export async function resolveVariantForLine(
  em: EntityManager,
  scope: VariantScope,
  identifiers: VariantIdentifiers,
): Promise<VariantResolution | null> {
  const variantId = cleanText(identifiers.variantId)
  const sku = cleanText(identifiers.sku)
  const productId = cleanText(identifiers.productId)

  if (isUuid(variantId)) {
    const byId = only(await findVariants(em, scope, { id: variantId }))
    if (byId) return { variant: toResolved(byId), source: 'variant_id' }
  }

  if (sku) {
    const candidates = skuCandidates(sku)
    const exact = only(await findVariants(em, scope, { sku: candidates[0] }))
    if (exact) return { variant: toResolved(exact), source: 'sku' }

    const rest = candidates.slice(1)
    if (rest.length > 0) {
      const normalized = only(await findVariants(em, scope, { sku: { $in: rest } }))
      if (normalized) return { variant: toResolved(normalized), source: 'sku_normalized' }
    }
  }

  if (isUuid(productId)) {
    const byProduct = await resolveByProductId(em, scope, productId)
    if (byProduct) return { variant: toResolved(byProduct), source: 'product_id' }
  }

  if (isUuid(variantId)) {
    const rescued = await resolveByProductId(em, scope, variantId)
    if (rescued) return { variant: toResolved(rescued), source: 'variant_id_was_product_id' }
  }

  return null
}
