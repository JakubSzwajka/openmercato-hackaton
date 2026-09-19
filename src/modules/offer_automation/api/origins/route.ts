import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listOfferOrigins } from '../../lib/offerOrigins'

const logger = createLogger('offer_automation').child({ component: 'api/origins' })

/**
 * Both legs of the trail in one payload, for the app-owned page that lists them.
 *
 * It exists because `inbox_ops` publishes no UI injection host on its proposal
 * page (`.ai/guides/modules/inbox_ops/umes-hosts.md` lists entity, event and
 * query-lifecycle hosts only), so the forward link cannot be added to core's
 * accepted-action card without replacing the whole page.
 */
export const metadata = {
  GET: {
    requireAuth: true,
    // Both, deliberately: a row shows a request and the quote it produced, so a
    // caller who may not see one of the two may not see the row.
    requireFeatures: ['inbox_ops.proposals.view', 'sales.quotes.view'],
  },
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type { OfferOriginRow } from '../../lib/offerOrigins'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthFromCookies()
    // Fail closed. A missing tenant or organization is never "show everything".
    if (!auth?.tenantId || !auth?.orgId) return json({ error: 'Unauthorized' }, 401)

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return json({ error: 'Invalid query parameters' }, 400)

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const result = await listOfferOrigins(
      em,
      { tenantId: auth.tenantId, organizationId: auth.orgId },
      parsed.data.page,
      parsed.data.pageSize,
    )
    return json(result)
  } catch (err) {
    logger.error('offer_automation.origins.list', { err })
    return json({ error: 'Failed to list offer origins' }, 500)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'OfferAutomation',
  summary: 'Offer origins',
  methods: {
    GET: {
      summary: 'List draft_offer actions with the request and the quote they link',
      description:
        'Read-only join between inbox_ops proposal actions of type draft_offer and the sales quotes they created. Scoped to the caller tenant and organization.',
      responses: [
        { status: 200, description: 'A page of origin rows' },
        { status: 400, description: 'Invalid query parameters' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
