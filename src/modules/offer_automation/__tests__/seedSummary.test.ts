// Explicit imports rather than ambient globals, matching the other suites in
// this folder: `@types/jest` is not wired into this app's tsconfig typeRoots.
import { describe, expect, it } from '@jest/globals'
import { buildSeedClosingLines, buildSendEmailCommand } from '../lib/seedSummary'
import { DEFAULT_DEMO_PASSWORD } from '../lib/demoCompany'

const input = {
  companyName: 'Nordwind Logistics',
  orgSlug: 'nordwind-logistics',
  slugIsDefault: true,
  tenantId: '6f7edd48-febc-485b-9e45-ea64773d62a5',
  organizationId: 'd8792480-8990-4b84-b533-4d9182d800b0',
  baseUrl: 'http://localhost:3000',
  users: [
    {
      email: 'admin@nordwind-logistics.example',
      roles: ['superadmin'],
      userId: 'user-admin',
      created: true,
      canLogIn: true,
    },
    {
      email: 'automation@nordwind-logistics.example',
      roles: [],
      userId: 'user-automation',
      created: true,
      features: ['offer_automation.offers.draft'],
      canLogIn: false,
    },
  ],
  salesUserId: 'user-sales',
  demoContact: {
    email: 'marta.nowak@nordwind-spedition.example',
    companyName: 'Nordwind Spedition GmbH',
    personName: 'Marta Nowak',
  },
}

describe('buildSeedClosingLines', () => {
  const text = () => buildSeedClosingLines(input).join('\n')

  it('never prints a password', () => {
    // Belt and braces. The real enforcement is the type: `SeedSummaryUser` has
    // no password field, so the builder has nothing to leak. This pins the
    // published default too, in case a future edit reaches for the constant.
    expect(text()).not.toContain(DEFAULT_DEMO_PASSWORD)
    expect(text().toLowerCase()).not.toContain('password         ')
  })

  it('states that the organization holds no activity', () => {
    const rendered = text()
    expect(rendered).toContain('holds no activity, on purpose')
    expect(rendered).toContain('No inbox email, no message thread, no proposal, no action, no quote and no')
  })

  it('never claims a proposal or a quote exists', () => {
    const rendered = text()
    expect(rendered).not.toMatch(/^Proposal {2,}/m)
    expect(rendered).not.toMatch(/^Quote number/m)
  })

  it('prints the ids and every seeded account', () => {
    const rendered = text()
    expect(rendered).toContain(input.tenantId)
    expect(rendered).toContain(input.organizationId)
    for (const user of input.users) {
      expect(rendered).toContain(user.email)
      expect(rendered).toContain(user.userId)
    }
    // The machine account is shown as unusable for login and named by feature.
    expect(rendered).toContain('<no login>')
    expect(rendered).toContain('offer_automation.offers.draft')
  })

  it('gives the copy-ready first-email command and keeps `demo` on the page', () => {
    const rendered = text()
    expect(rendered).toContain('  yarn mercato offer_automation send-email\n')
    expect(rendered).toContain('yarn mercato offer_automation demo \\')
    expect(rendered).toContain('--auto-accept --user user-sales')
  })
})

describe('buildSendEmailCommand', () => {
  it('needs no arguments under the default slug', () => {
    expect(
      buildSendEmailCommand({ slugIsDefault: true, tenantId: 't', organizationId: 'o' }),
    ).toBe('yarn mercato offer_automation send-email')
  })

  it('carries the ids when the company was seeded under another slug', () => {
    // `send-email` resolves its scope by the built-in slug, so the short form
    // would silently target the OTHER company. Printing the ids is the fix.
    expect(
      buildSendEmailCommand({ slugIsDefault: false, tenantId: 't', organizationId: 'o' }),
    ).toBe('yarn mercato offer_automation send-email --tenant t --org o')
  })
})
