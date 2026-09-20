// Explicit imports rather than ambient globals, matching the other suites in
// this folder: `@types/jest` is not wired into this app's tsconfig typeRoots.
import { describe, expect, it } from '@jest/globals'
import { DEMO_SEED_OVERRIDE_ENV, DEFAULT_DEMO_PASSWORD } from '../lib/demoCompany'
import {
  buildDemoResetPlan,
  formatDemoResetLines,
  isDemoResetRequested,
  runDemoReset,
  type DemoResetResult,
} from '../lib/demoReset'

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

/**
 * A container that refuses to hand anything out.
 *
 * Every test below is about a refusal, so the container is the assertion: if a
 * guard lets a run through, the first thing it does is resolve `em` or
 * `commandBus`, and that throws with a message no production code produces.
 */
function refusingContainer() {
  return {
    resolve: (name: string) => {
      throw new Error(`container.resolve(${name}) must not be reached`)
    },
  } as never
}

describe('isDemoResetRequested', () => {
  it('is off unless the flag is given', () => {
    // The whole opt-in. A seed run that says nothing about resetting deletes
    // nothing, which is the behaviour every existing script depends on.
    expect(isDemoResetRequested({})).toBe(false)
    expect(isDemoResetRequested({ 'org-slug': 'nordwind-logistics' })).toBe(false)
    expect(isDemoResetRequested({ password: 'Nordwind!1' })).toBe(false)
  })

  it('is on for the two shapes the CLI parser produces', () => {
    // `--reset` alone parses to `true`; `--reset=true` parses to the string.
    expect(isDemoResetRequested({ reset: true })).toBe(true)
    expect(isDemoResetRequested({ reset: 'true' })).toBe(true)
  })

  it('is off for a value that merely looks truthy', () => {
    for (const value of ['1', 'yes', 'false', '', 'TRUE']) {
      expect(isDemoResetRequested({ reset: value })).toBe(false)
    }
  })
})

describe('runDemoReset refusals', () => {
  // Every case passes an explicit env object rather than mutating
  // `process.env`, the way `demoSeedGuard.test.ts` does, so this suite cannot
  // leak state into another test file.
  const production = { NODE_ENV: 'production' } as NodeJS.ProcessEnv
  const development = { NODE_ENV: 'development' } as NodeJS.ProcessEnv

  it('refuses in production before it resolves anything', async () => {
    // The message is the seed's own refusal, and the container was never
    // touched, so nothing was read and nothing was deleted.
    await expect(runDemoReset(refusingContainer(), SCOPE, production)).rejects.toThrow(
      DEMO_SEED_OVERRIDE_ENV,
    )
  })

  it('never names the seed password in the production refusal', async () => {
    let message = ''
    try {
      await runDemoReset(refusingContainer(), SCOPE, production)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).not.toEqual('')
    expect(message).not.toContain(DEFAULT_DEMO_PASSWORD)
  })

  it('checks the environment before the scope, so production wins either way', async () => {
    await expect(
      runDemoReset(refusingContainer(), { tenantId: '', organizationId: '' }, production),
    ).rejects.toThrow(DEMO_SEED_OVERRIDE_ENV)
  })

  it('fails closed on a half-resolved scope', async () => {
    await expect(
      runDemoReset(refusingContainer(), { tenantId: SCOPE.tenantId, organizationId: '' }, development),
    ).rejects.toThrow('organizationId')
    await expect(
      runDemoReset(
        refusingContainer(),
        { tenantId: '  ', organizationId: SCOPE.organizationId },
        development,
      ),
    ).rejects.toThrow('tenantId')
    // Same refusal from the plan builder, so no caller can assemble an
    // unscoped plan and hand it somewhere else.
    expect(() => buildDemoResetPlan({ tenantId: SCOPE.tenantId, organizationId: '' })).toThrow(
      'organizationId',
    )
  })
})

describe('buildDemoResetPlan', () => {
  const plan = buildDemoResetPlan(SCOPE)
  const tables = plan.steps.map((step) => step.table)
  const indexOf = (table: string) => tables.indexOf(table)

  it('carries both scope ids on every step that filters rows itself', () => {
    // The rule the whole command rests on. A step that filtered on the tenant
    // alone would reach every organization in that tenant.
    for (const step of plan.steps) {
      if (step.where === null) continue
      expect(step.where.tenantId).toBe(SCOPE.tenantId)
      expect(step.where.organizationId).toBe(SCOPE.organizationId)
    }
  })

  it('reaches a scopeless child only through a parent that carries both ids', () => {
    // `message_recipients`, `message_objects` and `message_access_tokens` hold a
    // message id and nothing else, so the scope has to be enforced one hop
    // away. This pins that the hop exists and lands on a scoped step.
    const scopeless = plan.steps.filter((step) => step.where === null)
    expect(scopeless.map((step) => step.table)).toEqual([
      'message_access_tokens',
      'message_objects',
      'message_recipients',
    ])
    for (const step of scopeless) {
      expect(step.parent).not.toBeNull()
      // The column the `$in` runs on. Unset here would mean deleting by a
      // guessed column name.
      expect(step.parentKey).toBe('messageId')
      const parent = plan.steps.find((candidate) => candidate.table === step.parent)
      expect(parent).toBeDefined()
      expect(parent!.where?.tenantId).toBe(SCOPE.tenantId)
      expect(parent!.where?.organizationId).toBe(SCOPE.organizationId)
    }
  })

  it('deletes children before parents', () => {
    // Order is the plan's only real invariant beyond scope: a parent must be
    // listed after every step that depends on its rows.
    for (const step of plan.steps) {
      if (!step.parent) continue
      const parentIndex = indexOf(step.parent)
      expect(parentIndex).toBeGreaterThan(-1)
      expect(indexOf(step.table)).toBeLessThan(parentIndex)
    }
  })

  it('names every parent as a step of its own', () => {
    for (const step of plan.steps) {
      if (!step.parent) continue
      expect(tables).toContain(step.parent)
    }
  })

  it('covers the activity tables the demo writes', () => {
    expect(tables).toEqual(
      expect.arrayContaining([
        'inbox_emails',
        'inbox_proposals',
        'inbox_proposal_actions',
        'inbox_discrepancies',
        'messages',
        'message_recipients',
        'sales_quotes',
        'notifications',
      ]),
    )
  })

  it('touches nothing the seed has to rebuild', () => {
    // The company. If any of these ever appears here, a reset stops being a
    // reset of activity and starts being a teardown.
    const mustSurvive = [
      'tenants',
      'organizations',
      'users',
      'roles',
      'role_features',
      'inbox_settings',
      'sales_channels',
      'sales_order_statuses',
      'currencies',
      'products',
      'product_variants',
      'customer_entities',
    ]
    for (const table of mustSurvive) {
      expect(tables).not.toContain(table)
    }
  })

  it('hands the quote to the installed cascade rather than deleting its children itself', () => {
    const quotes = plan.steps.find((step) => step.table === 'sales_quotes')!
    expect(quotes.mode).toBe('command-cascade')
    // Exactly the five tables with a real foreign key to `sales_quotes`, which
    // is what `sales.quotes.delete` empties inside one transaction.
    expect([...quotes.cascades].sort()).toEqual([
      'sales_document_addresses',
      'sales_document_tag_assignments',
      'sales_notes',
      'sales_quote_adjustments',
      'sales_quote_lines',
    ])
    for (const table of quotes.cascades) {
      expect(tables).not.toContain(table)
    }
  })

  it('has no step that neither filters nor reaches rows through a parent column', () => {
    for (const step of plan.steps) {
      expect(step.where !== null || (step.parent !== null && Boolean(step.parentKey))).toBe(true)
    }
  })
})

describe('formatDemoResetLines', () => {
  const result: DemoResetResult = {
    scope: SCOPE,
    rows: [
      { table: 'messages', deleted: 2, how: 'hard delete' },
      { table: 'sales_quotes', deleted: 1, how: 'sales.quotes.delete' },
      { table: 'inbox_emails', deleted: 12, how: 'hard delete' },
      { table: 'inbox_discrepancies', deleted: null, how: 'not present in this app' },
    ],
    total: 15,
    absent: ['inbox_discrepancies'],
  }

  it('prints both ids, a count per table and the run total', () => {
    const text = formatDemoResetLines(result).join('\n')
    expect(text).toContain(SCOPE.tenantId)
    expect(text).toContain(SCOPE.organizationId)
    expect(text).toContain('15 row(s) deleted by this run.')
    expect(text).toContain('left alone')
  })

  it('says out loud that an absent table was never looked at', () => {
    const text = formatDemoResetLines(result).join('\n')
    expect(text).toContain('NOT DELETED, entity not registered in this app: inbox_discrepancies.')
    // And says nothing of the sort when every entity was found.
    expect(
      formatDemoResetLines({ ...result, absent: [] }).join('\n'),
    ).not.toContain('NOT DELETED')
  })

  it('reports an absent entity instead of a zero', () => {
    // A module set without `inbox_discrepancies` must read as "not here", not
    // as "nothing to delete". Those are different facts.
    const line = formatDemoResetLines(result).find((l) => l.includes('inbox_discrepancies'))!
    expect(line).toContain('not present in this app')
    expect(line).toContain('n/a')
  })

  it('calls out the inbox email count on its own line', () => {
    // The number that explains why a repeat `send-email` works again.
    const line = formatDemoResetLines(result).find((l) => l.includes('inbox emails deleted'))!
    expect(line).toContain('12')
    expect(line).toContain('sent again')
  })

  it('says nothing was blocking a resend when no email was deleted', () => {
    const lines = formatDemoResetLines({
      ...result,
      rows: [{ table: 'inbox_emails', deleted: 0, how: 'hard delete' }],
      total: 0,
    })
    expect(lines.join('\n')).toContain('nothing was blocking a resend')
  })

  it('indents every body line by two spaces, like the rest of the command', () => {
    for (const line of formatDemoResetLines(result)) {
      if (line === '') continue
      expect(line.startsWith('  ')).toBe(true)
    }
  })
})
