// Explicit imports rather than ambient globals, matching the other suites in
// this folder: `@types/jest` is not wired into this app's tsconfig typeRoots.
import { describe, expect, it } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  FREIGHT_CURRENCY,
  FREIGHT_SERVICES,
  ensureListPrice,
  listPriceLockKey,
} from '../lib/freightCatalog'
import { LIST_PRICE_KIND_CODE } from '../lib/catalogPricing'

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  actorUserId: '99999999-9999-4999-8999-999999999999',
}
const VARIANT_ID = '33333333-3333-4333-8333-333333333333'
const PRICE_KIND_ID = '44444444-4444-4444-8444-444444444444'
const EXISTING_PRICE_ID = '55555555-5555-4555-8555-555555555555'
const SERVICE = FREIGHT_SERVICES[1]!

type Call = { id: string; input: Record<string, unknown> }

/**
 * Records the order of everything that matters for the race fix: whether the
 * re-read happened inside the transaction, whether the lock was taken before
 * it, and whether the create ran at all.
 */
type Trace = {
  steps: string[]
  commands: Call[]
  lockSql?: string
  lockParams?: unknown[]
}

function stubEm(
  trace: Trace,
  existingPrice: Record<string, unknown> | null,
  lockFails = false,
): EntityManager {
  const transactionalEm = {
    findOne: async () => {
      trace.steps.push('recheck')
      return existingPrice
    },
    execute: async (query: string, params: unknown[]) => {
      trace.steps.push(lockFails ? 'lock-unavailable' : 'lock')
      trace.lockSql = query
      trace.lockParams = params
      if (lockFails) throw new Error('advisory locks are not available here')
      return []
    },
    getMetadata: () => ({ find: () => undefined }),
  }

  return {
    // The outer manager must never be the one that reads: a read outside the
    // transaction is the bug this replaced.
    findOne: async () => {
      trace.steps.push('read-outside-transaction')
      return existingPrice
    },
    getMetadata: () => ({ find: () => undefined }),
    transactional: async <T>(cb: (tem: unknown) => Promise<T>): Promise<T> => {
      trace.steps.push('begin')
      const result = await cb(transactionalEm)
      trace.steps.push('commit')
      return result
    },
  } as unknown as EntityManager
}

function stubContainer(trace: Trace, priceId: string): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (name !== 'commandBus') throw new Error(`Unexpected resolve(${name})`)
      return {
        execute: async (id: string, payload: { input: Record<string, unknown> }) => {
          trace.steps.push('create')
          trace.commands.push({ id, input: payload.input })
          return { result: { priceId } }
        },
      }
    },
  } as unknown as AwilixContainer
}

describe('ensureListPrice', () => {
  it('takes the lock and re-reads inside the transaction before creating', async () => {
    const trace: Trace = { steps: [], commands: [] }
    const created = await ensureListPrice(
      stubEm(trace, null),
      stubContainer(trace, 'new-price-id'),
      SCOPE,
      VARIANT_ID,
      PRICE_KIND_ID,
      SERVICE,
    )

    expect(trace.steps).toEqual(['begin', 'lock', 'recheck', 'create', 'commit'])
    expect(trace.lockSql).toContain('pg_advisory_xact_lock')
    expect(trace.lockParams).toEqual([listPriceLockKey(SCOPE, VARIANT_ID)])
    expect(created).toEqual({
      priceId: 'new-price-id',
      unitPriceNet: SERVICE.unitPriceNet,
      created: true,
    })
    expect(trace.commands).toHaveLength(1)
    expect(trace.commands[0]!.id).toBe('catalog.prices.create')
    expect(trace.commands[0]!.input).toMatchObject({
      variantId: VARIANT_ID,
      priceKindId: PRICE_KIND_ID,
      currencyCode: FREIGHT_CURRENCY,
      minQuantity: 1,
      unitPriceNet: SERVICE.unitPriceNet,
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })
  })

  it('creates nothing when the re-read inside the lock finds a price', async () => {
    const trace: Trace = { steps: [], commands: [] }
    const reused = await ensureListPrice(
      stubEm(trace, { id: EXISTING_PRICE_ID, unitPriceNet: '68.0000' }),
      stubContainer(trace, 'must-not-be-used'),
      SCOPE,
      VARIANT_ID,
      PRICE_KIND_ID,
      SERVICE,
    )

    expect(trace.steps).toEqual(['begin', 'lock', 'recheck', 'commit'])
    expect(trace.commands).toEqual([])
    expect(reused).toEqual({
      priceId: EXISTING_PRICE_ID,
      unitPriceNet: '68.0000',
      created: false,
    })
  })

  it('never reads the price outside the transaction', async () => {
    const trace: Trace = { steps: [], commands: [] }
    await ensureListPrice(
      stubEm(trace, { id: EXISTING_PRICE_ID, unitPriceNet: '68.0000' }),
      stubContainer(trace, 'must-not-be-used'),
      SCOPE,
      VARIANT_ID,
      PRICE_KIND_ID,
      SERVICE,
    )
    expect(trace.steps).not.toContain('read-outside-transaction')
  })

  it('still seeds when the database offers no advisory lock', async () => {
    // Best-effort, as core's own dedupe paths are: losing the lock puts the
    // original race back, and refusing to seed at all would be worse.
    const trace: Trace = { steps: [], commands: [] }
    const created = await ensureListPrice(
      stubEm(trace, null, true),
      stubContainer(trace, 'new-price-id'),
      SCOPE,
      VARIANT_ID,
      PRICE_KIND_ID,
      SERVICE,
    )
    expect(trace.steps).toEqual(['begin', 'lock-unavailable', 'recheck', 'create', 'commit'])
    expect(created.created).toBe(true)
  })

  it('locks on the row identity, so unrelated variants do not serialise', () => {
    const key = listPriceLockKey(SCOPE, VARIANT_ID)
    expect(key).toContain(SCOPE.tenantId)
    expect(key).toContain(SCOPE.organizationId)
    expect(key).toContain(VARIANT_ID)
    expect(key).toContain(FREIGHT_CURRENCY)
    expect(key).toContain(LIST_PRICE_KIND_CODE)
    expect(listPriceLockKey(SCOPE, 'another-variant')).not.toBe(key)
  })
})
