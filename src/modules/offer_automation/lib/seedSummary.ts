/**
 * The closing block `seed-demo` prints.
 *
 * Kept as a pure function, away from the database and the container, for one
 * reason: this block is the only place the operator learns what the seed did
 * and what to type next, and two of its properties are worth pinning in a test
 * rather than re-reading by eye after every edit.
 *
 *  1. It never prints a password. The seeded logins exist, the caller knows
 *     which password it passed, and a credential echoed into a terminal ends up
 *     in shell history and in pasted logs. So no password reaches this builder
 *     at all — `SeedSummaryUser` has no field for one.
 *  2. It says the organization holds no activity, because after this change
 *     that is true and it is the point: the seed builds standing data only, and
 *     the first enquiry is the one the operator sends by hand.
 */

/** One seeded account, described without its credential. */
export type SeedSummaryUser = {
  email: string
  /** Empty for the automation account, which holds features and no role. */
  roles: string[]
  userId: string
  created: boolean
  /**
   * Features worth naming next to the account. Printed for the automation user,
   * whose whole point is that it holds exactly one.
   */
  features?: string[]
  /** False for the automation account: its password is not knowable by design. */
  canLogIn: boolean
}

export type SeedSummaryInput = {
  companyName: string
  orgSlug: string
  /** True when the slug is the built-in one, which is what makes `send-email` work with no arguments. */
  slugIsDefault: boolean
  tenantId: string
  organizationId: string
  /** Base URL with no trailing slash. */
  baseUrl: string
  /** Address `send-email` posts its signed webhook to. Picks this tenant. */
  inboxAddress: string
  users: SeedSummaryUser[]
  /** The sales employee the deterministic `demo` path runs as. */
  salesUserId: string
  demoContact: {
    email: string
    companyName: string
    personName: string
  }
}

/** The exact `send-email` line to copy, with flags only when they are needed. */
export function buildSendEmailCommand(input: {
  slugIsDefault: boolean
  tenantId: string
  organizationId: string
}): string {
  const base = 'yarn mercato offer_automation send-email'
  // `send-email` with no flags finds the organization by the built-in slug. A
  // company seeded under another slug is invisible to that lookup, so the line
  // printed for it carries the ids instead of pretending the short form works.
  return input.slugIsDefault
    ? base
    : `${base} --tenant ${input.tenantId} --org ${input.organizationId}`
}

function userRows(users: SeedSummaryUser[]): string[] {
  return users.map((user) => {
    const access = user.canLogIn ? user.roles.join(',') : '<no login>'
    const trailing = user.features?.length ? `  features ${user.features.join(',')}` : ''
    const state = user.created ? 'created' : 'already present'
    return `  ${user.email.padEnd(34)} ${access.padEnd(14)} ${user.userId}  ${state}${trailing}`
  })
}

/**
 * Builds the whole closing block, one array entry per printed line.
 */
export function buildSeedClosingLines(input: SeedSummaryInput): string[] {
  const rule = '============================================================================='
  const sendEmail = buildSendEmailCommand(input)
  const contact = input.demoContact

  return [
    '',
    rule,
    `${input.companyName} is seeded. This organization holds no activity, on purpose.`,
    rule,
    `tenantId         ${input.tenantId}`,
    `organizationId   ${input.organizationId}`,
    `organization     ${input.orgSlug}`,
    `inbox address    ${input.inboxAddress}`,
    '',
    'Accounts (no password is printed: use the one you passed, or see `seed-demo --help`):',
    `  ${'email'.padEnd(34)} ${'access'.padEnd(14)} userId`,
    ...userRows(input.users),
    '',
    `Login            ${input.baseUrl}/login`,
    `Origins report   ${input.baseUrl}/backend/offer-automation/origins`,
    '',
    'No inbox email, no message thread, no proposal, no action, no quote and no',
    'notification exist here. The seed creates standing data only: the company, the',
    'users, the freight catalogue, the CRM customers and the inbox address above.',
    'The first enquiry in this system is the one you send yourself.',
    '',
    'Send that first email (nothing else to fill in):',
    `  ${sendEmail}`,
    '',
    'It POSTs a signed webhook to core, the way a mail provider would. Core parses',
    'the email, writes the row and emits `inbox_ops.email.received`. What follows is',
    'the subscribers reacting: extraction -> proposal -> priced draft quote ->',
    'notification. That path needs the dev server (the webhook is an HTTP endpoint),',
    'an events worker (`yarn dev` spawns one) and a model (`check-ai` says whether',
    'one is reachable).',
    '',
    'No key, no worker, no server, or you want the same result every time? `demo` is',
    'the deterministic path and still there. It writes the email itself, stubs the',
    'extraction and accepts the action:',
    '  yarn mercato offer_automation demo \\',
    `    --tenant ${input.tenantId} \\`,
    `    --org ${input.organizationId} \\`,
    `    --customer-email ${contact.email} \\`,
    `    --customer-name "${contact.companyName}" \\`,
    `    --contact-name "${contact.personName}" \\`,
    `    --auto-accept --user ${input.salesUserId}`,
    '',
    'Note: rbacService caches role ACLs for 5 minutes in .mercato/cache/cache.db.',
    '      A feature granted just now can take that long to reach an open session.',
    'Note: `send-email` signs its POST with INBOX_OPS_WEBHOOK_SECRET. Set that in',
    '      .env and restart the dev server, or core answers the webhook with 503.',
    'Note: core deduplicates on subject + sender + body, per organization, forever.',
    '      Sending the built-in enquiry twice is a silent no-op; vary it with --note.',
    rule,
    '',
  ]
}
