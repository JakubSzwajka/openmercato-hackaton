// Explicit imports rather than ambient globals, matching the other suites in
// this folder: `@types/jest` is not wired into this app's tsconfig typeRoots.
import { describe, expect, it } from '@jest/globals'
import {
  DEFAULT_DEMO_PASSWORD,
  DEMO_SEED_OVERRIDE_ENV,
  DEMO_SEED_OVERRIDE_VALUE,
  assertDisposableSeedTarget,
  isProductionLikeEnvironment,
} from '../lib/demoCompany'

/**
 * The refusal is a pure function of the environment, so it is pinned without a
 * database, a container or a tenant. Every case passes an explicit env object
 * rather than mutating `process.env`, so the suite cannot leak state into
 * another test file.
 */
describe('assertDisposableSeedTarget', () => {
  const productionEnv = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

  it('allows a development or unset environment', () => {
    expect(() => assertDisposableSeedTarget({} as NodeJS.ProcessEnv)).not.toThrow()
    expect(() =>
      assertDisposableSeedTarget({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).not.toThrow()
    expect(() => assertDisposableSeedTarget({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow()
  })

  it('refuses in production and names the variable that unblocks it', () => {
    expect(() => assertDisposableSeedTarget(productionEnv)).toThrow(DEMO_SEED_OVERRIDE_ENV)
    expect(() => assertDisposableSeedTarget(productionEnv)).toThrow(DEMO_SEED_OVERRIDE_VALUE)
  })

  it('never prints the seed password in the refusal', () => {
    let message = ''
    try {
      assertDisposableSeedTarget(productionEnv)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).not.toEqual('')
    expect(message).not.toContain(DEFAULT_DEMO_PASSWORD)
  })

  it('is not lifted by a custom password', () => {
    // The signature is the real enforcement — there is no password parameter to
    // pass — but pin the behaviour too: a run that overrides the credential is
    // still a run writing demo data into a production database.
    expect(() =>
      assertDisposableSeedTarget({
        NODE_ENV: 'production',
        OM_DEMO_ADMIN_PASSWORD: 'SomethingElse!1',
      } as NodeJS.ProcessEnv),
    ).toThrow()
  })

  it('accepts only the exact override value, not a truthy one', () => {
    for (const value of ['1', 'true', 'yes', '', ' ', 'I-UNDERSTAND-THIS-SEEDS-A-KNOWN-PASSWORD']) {
      expect(() =>
        assertDisposableSeedTarget({
          NODE_ENV: 'production',
          [DEMO_SEED_OVERRIDE_ENV]: value,
        } as NodeJS.ProcessEnv),
      ).toThrow()
    }
  })

  it('passes when the operator sets the exact override value', () => {
    expect(() =>
      assertDisposableSeedTarget({
        NODE_ENV: 'production',
        [DEMO_SEED_OVERRIDE_ENV]: DEMO_SEED_OVERRIDE_VALUE,
      } as NodeJS.ProcessEnv),
    ).not.toThrow()
    // Surrounding whitespace is a copy/paste artefact, not a different answer.
    expect(() =>
      assertDisposableSeedTarget({
        NODE_ENV: 'production',
        [DEMO_SEED_OVERRIDE_ENV]: `  ${DEMO_SEED_OVERRIDE_VALUE}  `,
      } as NodeJS.ProcessEnv),
    ).not.toThrow()
  })

  it('treats NODE_ENV case-insensitively', () => {
    // `as unknown as` because Node's own type for NODE_ENV is the three-value
    // union, and the point of these two cases is what arrives when it is not.
    const env = (value: string) => ({ NODE_ENV: value }) as unknown as NodeJS.ProcessEnv
    expect(isProductionLikeEnvironment(env(' Production '))).toBe(true)
    expect(isProductionLikeEnvironment(env('productions'))).toBe(false)
  })
})
