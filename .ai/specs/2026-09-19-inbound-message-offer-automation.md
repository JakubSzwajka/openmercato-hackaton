# Inbound message to priced offer

**Date**: 2026-09-19
**Status**: Draft
**Shape**: hackathon vision. Deliberately short and not template-complete; see `.ai/guides/spec-delivery.md` for the full template this waives.

## The vision

A logistics customer emails asking for transport. A salesperson opens the system and sees three things already done: the email, a priced draft quote, and the trail between them. Their job is to judge the offer, not to retype it.

Nothing is sent to a customer automatically. Nothing is written before a human accepts.

## Two gates, different questions

```
customer email
      |
  extraction                       (AI later; stubbed today)
      |
  proposal action  ── gate 1 ──>   "did we read the email right?"   Inbox Ops
      |                            human accepts, edits or rejects
      v
  sales quote (draft, priced) ── gate 2 ──>  "is this offer right?"  Sales
      |                                      human adjusts and sends
      v
  customer
```

## What is built

| Piece | Where |
|---|---|
| App module | `src/modules/offer_automation/` |
| Custom inbox action `draft_offer` | `inbox-actions.ts`, payload = core's `orderPayloadSchema` |
| Creates the quote | `execute` calls `sales.quotes.create` via the command bus |
| Demo command | `cli.ts`, seeds email + message + proposal, `--auto-accept` runs the chain |
| Trace command | `cli.ts origins`, reports `linksBack` per action (quote metadata is encrypted) |
| Quote to request link | widget on host `sales.document.detail.quote:details` |
| Request to quote link | our page `/backend/offer-automation/origins` |
| Visual explainer | `docs/offer-automation.html` |

Run it:

```bash
yarn mercato offer_automation demo \
  --tenant <tenantId> --org <orgId> \
  --auto-accept --user <userIdWith inbox_ops.proposals.view>
```

## Platform mechanisms this exercises

1. Discovery by convention: a module-root `inbox-actions.ts` is folded into `.mercato/generated/inbox-actions.generated.ts` by `yarn generate`.
2. One declaration feeds two sides: its `promptSchema` enters the extraction prompt, its `execute` runs after a human accepts. They cannot drift.
3. Writes go through the command bus, so `sales` keeps its own validation, locking and events.
4. UMES widget hosts for the backward link; an app-owned page where no host exists.
5. Scope and RBAC come from the runtime context and fail closed.

## Three shims, one pattern: core assumes a browser

| Shim | Works around | Deleted when |
|---|---|---|
| `lib/coreRequiredFeatureShim.ts` | `executionEngine.ts:454` resolves RBAC from the closed map `constants.ts:12-22`, not from `definition.requiredFeature`, so any third-party action 403s | core reads `requiredFeature` from the registry (its own TODO, `constants.ts:10`) |
| `lib/cliInboxActionRegistry.ts` | the registry loads via a Next-only `@/` alias (`executionEngine.js:252`) | core's CLI bootstrap loads it |
| registration in `lib/demoMessageRecord.ts` | message objects are registered only by `src/bootstrap-common.ts:37`, and `inbox_ops/message-objects.ts:2` imports React | core loads message objects in CLI, or splits that preview out |

Only the first blocks product code. The other two exist so a demo can run headless.

## Upstream status of the first gap

Known issue, half-landed. Repo `open-mercato/open-mercato`, `main == v0.8.0` at `ab23d45`.

- [#703](https://github.com/open-mercato/open-mercato/issues/703) asked for extensible inbox actions
- [#760](https://github.com/open-mercato/open-mercato/pull/760) shipped the discovery half, never wired execution RBAC to `requiredFeature`
- [#2700](https://github.com/open-mercato/open-mercato/issues/2700) / [#2798](https://github.com/open-mercato/open-mercato/pull/2798) hardened empty features only

A bug report is drafted and NOT posted.

## Pricing: the model never touches a number

```
AI          { variantId, quantity }          identifiers and counts only
  |
pricing fn  catalog_product_variant_prices   the only source of money
  |
sales.quotes.create
```

Identical emails must produce identical prices, and a persuasive email must not argue its way to a discount. No discounts in this build: core stores them, it never computes them (`sales/commands/documents.ts:136`).

Logistics means services, not goods. Catalog rows are transport services with explicit units (per shipment, per pallet, per km, per hour), and lines use `kind: 'service'`. Real freight pricing is lane-based with weight bands; this models the simple version on purpose.

## Not built, in likely order

1. AI matcher: email text to `{ variantId, quantity }`, using `search_catalog` and `get_price` tools. Needs `OM_AI_PROVIDER`.
2. Customer-level discounts, as one explicit step with the reason recorded on the line.
3. `create_contact` for unknown senders, as a second card on the same proposal.
4. Sales pipeline deal via `customers.deals.create`, only on human accept, to keep the funnel clean.
5. Real inbound mail: signed POST to `/api/inbox_ops/webhook/inbound`, then the real extraction worker.

## Open questions

- Does `accept-all` thread a created entity id into the next action's payload? If not, contact-then-quote needs two passes.
- Is an events worker running for `persistent: true` events under `yarn dev`?
- Past-quote pricing needs accepted-quote history this database does not have.

## Links

- Inbox Ops, user guide: https://docs.openmercato.com/user-guide/inbox-ops
- Modules overview: https://docs.openmercato.com/framework/modules/overview
- Workflows: https://docs.openmercato.com/framework/workflows/
- AI assistant: https://docs.openmercato.com/framework/ai-assistant/overview
- Local: `.ai/guides/extensions.md`, `.ai/guides/contracts.md`, `.ai/guides/backend-ui.md`, `.ai/guides/ai-workflows.md`
- Facts: `.ai/guides/modules/{inbox_ops,sales,customers,catalog,messages}/index.md`
- The `inbox-actions.ts` pattern is undocumented publicly; the contract is `node_modules/@open-mercato/shared/src/modules/inbox-actions.ts`
