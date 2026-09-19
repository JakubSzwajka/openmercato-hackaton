# Inbound Message to Offer Automation (MVP)

**Date**: 2026-09-19
**Status**: Draft

> Use `om-spec-writing` for every new application, multi-module feature, or other non-trivial business slice. Keep every section below; write `N/A — {reason}` when a section does not apply. Change the status to `Ready for implementation` only after every blocking open question is resolved and the traceability table covers every requirement.

> **Premise correction, recorded before anything else.** This spec was briefed as "build an app module with an Agent Orchestrator agent that drafts an offer from an inbound email". The installed source says that flow already ships in core. `node_modules/@open-mercato/core/src/modules/inbox_ops/subscribers/extractionWorker.ts:29` subscribes to `inbox_ops.email.received` and calls `lib/llmProvider.ts` directly; `node_modules/@open-mercato/core/src/modules/inbox_ops/data/entities.ts:48` already carries the `create_quote` action type; `node_modules/@open-mercato/core/src/modules/sales/inbox-actions.ts:330` registers the `create_quote` executor, and line 137 of that file runs the command `sales.quotes.create`; the pack is live in `.mercato/generated/inbox-actions.generated.ts`; human review already exists at `/backend/inbox-ops/proposals/[id]`. Both modules are enabled in this app (`src/modules.ts:83` for `sales`, `:120` for `inbox_ops`) and neither needs an enterprise flag. This spec therefore describes configuration, a local inbound simulator, and a proven end-to-end journey, not a new agent module. The orchestrator route survives only as a deferred alternative below.

## TLDR

A customer emails the tenant's operations inbox. The installed `inbox_ops` extraction worker reads the mail with the configured LLM and writes an `InboxProposal` carrying a `create_quote` action with line items, customer and currency. A human opens `/backend/inbox-ops/proposals/[id]`, edits the draft if needed, and accepts. Accepting runs the `sales` `create_quote` executor, which calls `sales.quotes.create` and produces a real quote in `/backend/sales/quotes`. The only thing this repository is missing is configuration and a way to inject a signed inbound email without a mail server, so the work is a phase 0 enablement pass, a signed simulation script with fixtures, and evidence that the journey holds. No installed module is edited and no new module ships unless phase 2 proves a named gap.

## Problem Statement

Today an inbound sales request arrives as email and a person retypes it into a quote. The retyping is the cost: reading the mail, matching the customer, finding products, choosing a currency and channel, then filling the quote form. The platform already ships the machinery to remove that step, but this app cannot demonstrate it, for three concrete reasons found in the repository:

1. `INBOX_OPS_WEBHOOK_SECRET` is commented out at `.env:839`, so the public inbound webhook at `POST /api/inbox_ops/webhook/inbound` answers `503` for every custom-provider request (`node_modules/@open-mercato/core/src/modules/inbox_ops/api/webhook/inbound.ts:157-161`).
2. There is no mailbox wired to the tenant inbox address, so nothing ever reaches the webhook, and there is no local way to inject a message.
3. Nobody has walked the accept path on this app, so it is unproven that `create_quote` reaches `sales.quotes.create` with the seed data this repository has (a sales channel, a currency, products).

Affected users are the sales operator who reviews drafts and the administrator who configures the inbox. Existing behavior is insufficient only in the sense that it is switched off and unverified, not missing.

## Overview and Success Measures

- **Primary outcome:** a signed inbound message addressed to the tenant inbox becomes an accepted quote in `/backend/sales/quotes` with no manual data entry, and with exactly one human decision in the middle. Target for the MVP: one scripted fixture run reaches an accepted quote, and one scripted non-offer fixture produces no `create_quote` action.
- **Leading indicators:** an `InboxEmail` row exists with status `received`; the `inbox_ops.email.received` event is consumed; an `InboxProposal` row exists with category `rfq` and at least one `create_quote` action; the action's `createdEntityType` reads `sales_quote` after acceptance.
- **Baseline:** zero. No `InboxEmail` rows have ever been created in this app, because the webhook secret is unset. Measurement plan is the phase exit gates below, which are counted by hand on a single run, not by a metric pipeline.
- **Market / product reference:** the pattern matches inbound-to-CRM tools such as Front rules and HubSpot conversations, which all keep a human accept step for anything that creates a commercial document. Adopted: the review-before-write stance and the per-action accept, which `inbox_ops` already implements. Rejected: auto-send of the reply and confidence-based auto-accept, because a wrong quote reaches a customer and cannot be recalled.

## Goals

- **REQ-001** — A signed inbound email addressed to the tenant's configured inbox produces a reviewable offer draft without any human touching a mailbox.
- **REQ-002** — No sales quote is created without an explicit human decision; accepting the `create_quote` action creates a quote in the reviewer's tenant and organization scope.
- **REQ-003** — A message that is not an offer request produces no `create_quote` action, so the reviewer is not handed a fabricated offer.
- **REQ-004** — The whole flow is demoable on a developer machine with no mail server, from a repository-owned script with at least two fixtures.
- **REQ-005** — An inbound request that is unsigned, stale, signed with the wrong secret, or addressed to an inbox this tenant does not own creates no email, no proposal and no quote, and leaks nothing about which inboxes exist.

## Non-goals

- No auto-approval, including confidence-threshold auto-approval. Every draft is reviewed by a person in the MVP.
- No new inbound channel provider, no IMAP or SMTP wiring, no mail server, no Resend or Svix configuration.
- No edits to any installed module (`inbox_ops`, `sales`, `messages`, `catalog`, `customers`, `agent_orchestrator`).
- No Agent Orchestrator agent, no enterprise module flags, no new workflow-safe command. See the deferred alternative below.
- No customer-facing portal surface and no automatic reply to the customer. `draft_reply` exists in `inbox_ops` and stays out of scope.
- No new backend page. The MVP reviews on the installed proposal page.

## Proposed Solution

The smallest platform-native solution is to switch on what is installed and prove it, then add exactly one thing the platform does not have: a way to inject a signed inbound email locally.

1. **Phase 0 configures the tenant.** `inbox_ops` seeds an `InboxSettings` row per tenant on creation, with address `ops-<first 8 chars of organizationId>@${INBOX_OPS_DOMAIN:-inbox.mercato.local}` (`node_modules/@open-mercato/core/src/modules/inbox_ops/setup.ts:22-41`). Phase 0 reads that address, sets a per-tenant `webhookSecret` through `PATCH /api/inbox_ops/settings`, sets `INBOX_OPS_WEBHOOK_SECRET` in `.env` (still required even when the inbox owns a secret, because the route returns `503` before resolving the inbox when the global one is unset), and confirms the AI provider (`OM_AI_PROVIDER=openai` at `.env:506`, with the matching key, or an `OM_AI_INBOX_OPS_*` override).
2. **Phase 1 adds the simulator.** A repository-owned Node script signs a JSON body with `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` and posts it to `/api/inbox_ops/webhook/inbound` with `x-webhook-signature` and `x-webhook-timestamp`. Two fixtures ship with it: an offer request that must yield a `create_quote` action, and a non-offer message that must not.
3. **Phase 2 proves the journey.** The reviewer opens the proposal, inspects the extracted lines and discrepancies, edits the payload if needed through `PATCH /api/inbox_ops/proposals/[id]/actions/[actionId]`, then accepts, which calls the `sales` executor synchronously and returns the created quote id.
4. **Phase 3 is conditional.** If, and only if, phase 2 records a named observable gap in the built-in extraction, the app contributes one module-root `inbox-actions.ts` with its own action type. If phase 2 records no gap, phase 3 does not ship.

This closes the stated problem because the retyping step disappears while the commercial decision stays with a person, and it is the smallest solution because steps 1, 3 and most of 2 are configuration and verification rather than code.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Use the installed `inbox_ops` extraction worker as the drafting engine | It already subscribes to `inbox_ops.email.received`, calls the configured LLM, and emits proposals with typed actions (`subscribers/extractionWorker.ts:29`) | Build an app module with an Agent Orchestrator agent, `INVOKE_AGENT` and a `USER_TASK` | Rejected for the MVP: core already ships the whole flow, so the module would duplicate drafting, review and write paths and add two enterprise flags for no new user-visible outcome. Kept as the deferred alternative below. |
| Trigger on `inbox_ops.email.received` | It is emitted once per accepted inbound mail, after tenant resolution and dedup (`api/webhook/inbound.ts:392-403`) | Trigger on `messages.message.sent` | Rejected: that event fires whenever the `messages` module creates a message, outbound ones included (`node_modules/@open-mercato/core/src/modules/messages/commands/messages.ts:45`), so an automated reply would re-trigger the drafting loop. |
| Write the quote through the installed `create_quote` inbox action | `sales/inbox-actions.ts:330` already maps the action to `sales.quotes.create` with `requiredFeature: 'sales.quotes.manage'` and returns `createdEntityType: 'sales_quote'` | Call `sales.quotes.create` from a workflow `UPDATE_ENTITY` step | Rejected: `sales/workflows.ts:10` registers only `sales.orders.update` as workflow-safe, and it carries the grandfather flag a new candidate must not copy. Reaching quotes from a workflow would mean registering a new candidate and a per-tenant enablement step that ships silently off. The inbox action path has none of that. |
| Human accepts every action | The operator asked for it, and an unrecalled wrong quote is a customer-visible error | Auto-accept above `INBOX_OPS_CONFIDENCE_THRESHOLD` (`extractionWorker.ts:209`, default `0.5`) | Deferred: the threshold currently only sets `possiblyIncomplete` and a review flag. Auto-accept would need a rollback story for a created quote, which the MVP does not have. |
| Simulate inbound with a signed local script | The custom-provider webhook path is public and HMAC-signed, so a script is a complete client (`api/webhook/inbound.ts:25`, `:51`) | Run a real mailbox or a Resend/Svix tunnel | Rejected for the MVP: it adds an external account and a public tunnel to demonstrate behavior that the signed path already exercises identically from the route's point of view. |
| Reuse `/backend/inbox-ops/proposals/[id]` for review | It already renders the mail thread, action cards, confidence, discrepancies and an edit dialog, with `Page`/`PageBody` and the shared `apiCall` helper | Build an app-owned review page | Rejected: a new page would re-implement an installed surface and would not gain a single reviewer capability the MVP needs. |

#### Deferred alternative: the Agent Orchestrator route

Recorded so it is not re-proposed by accident, and deliberately not designed further.

What it would add: a new app module owning an `ai-agents.ts` that declares a `defineAgent` task agent with a `proposal` result schema, a module-root `ai-tools.ts` of read-only lookups, a process definition with an `{ kind: 'event' }` trigger on `inbox_ops.email.received`, a materialized `START -> INVOKE_AGENT -> END` workflow whose `onResult` disposition parks a `USER_TASK` and resumes on `agent_orchestrator.proposal.ready`, and its own workflow-safe command wrapping `sales.quotes.create`, because agents cannot write and `sales` registers only `sales.orders.update`. It also needs `OM_ENABLE_ENTERPRISE_MODULES=true` and `OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true` (`.env:126`, `.env:146`, gate at `src/modules.ts:185-200`), plus a per-tenant enablement of the new command, which ships off by default.

The concrete conditions that would justify paying for that: the built-in extraction prompt cannot be steered per tenant and a tenant needs different drafting rules; drafting needs durable multi-step state, a timer, or a wait for a human answer mid-draft; or the draft needs tools the extraction worker never calls, such as live stock or a pricing engine lookup. Until one of those is observed, the built-in worker is the cheaper engine.

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Tenant inbox address | The single lowercase address that binds an inbound mail to a tenant and organization. Seeded as `ops-<org id first 8>@${INBOX_OPS_DOMAIN}`; unique across all tenants. | `inbox_ops:inbox_settings.inbox_address` | An unknown `to` returns `200 {ok:true}` and persists nothing, so the endpoint is not a probe oracle. |
| Inbound email | One accepted inbound message, deduplicated by `messageId` and a content hash within the inbox. | `inbox_ops:inbox_email` | A duplicate emits `inbox_ops.email.deduplicated` and stops. |
| Offer draft | An `InboxProposal` whose actions include one of type `create_quote`. It is a proposal, never a commercial document. | `inbox_ops:inbox_proposal` + `inbox_ops:inbox_proposal_action` | A draft with no `create_quote` action is a valid outcome, not an error. |
| Draft payload | The `create_quote` action payload, validated by `orderPayloadSchema`: `customerName` (required), `currencyCode` (exactly 3 chars, required), `lineItems` (1 to 100, each with `productName` and `quantity`), plus optional `customerEmail`, `customerEntityId`, `channelId`, `taxRateId`, `unitPrice`, `sku`, `requestedDeliveryDate`, `notes`, `customerReference`, and billing/shipping addresses. | `node_modules/@open-mercato/core/src/modules/inbox_ops/data/validators.ts:24-49` | An edit that breaks the schema is rejected `400` before the action is saved. |
| Review decision | Exactly one of accept, reject, or edit-then-accept, taken per action by a user holding `inbox_ops.proposals.manage`. | `inbox_ops:inbox_proposal_action.status` | Nothing is written to `sales` until accept. |
| Confidence | A 0 to 1 score per proposal and per action. Below `INBOX_OPS_CONFIDENCE_THRESHOLD` (default `0.5`) the email is flagged for review. | `extractionWorker.ts:209` | It flags. It never blocks and never auto-accepts. |
| Discrepancy | A detected mismatch such as a price or quantity difference, an unknown contact, or a product that is not in the catalogue. | `inbox_ops:inbox_discrepancy` | Shown to the reviewer next to the action; it does not block accept. |
| Created quote | The `sales` quote produced by accepting a `create_quote` action; its id is stored back on the action. | `inbox_ops_proposal_action.created_entity_id` with `created_entity_type = 'sales_quote'` | If `sales.quotes.create` returns no id, the executor throws `500` and the action moves to `failed`. |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Administrator | Read and change the inbox address, working language and per-tenant webhook secret | organization | `inbox_ops.settings.manage` |
| Sales reviewer | List and open proposals, edit an action payload, accept, reject | organization | `inbox_ops.proposals.view`, `inbox_ops.proposals.manage`, and `sales.quotes.manage` for the accept to execute |
| Quote reader | Open the created quote | organization | `sales.quotes.view` |
| Inbound webhook caller | Create one `InboxEmail` in the tenant that owns the addressed inbox | resolved from the inbox row, never from the payload | none; the request is unauthenticated and authorized by HMAC only |

Trusted `tenantId` and `organizationId` are derived from the session for every backend and API actor through the standard route `metadata` guards, for example `POST /api/inbox_ops/proposals/[id]/actions/[actionId]/accept` declares `requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage']`. For the webhook the scope is derived from the resolved `InboxSettings` row, never from the request body: the route looks the inbox up by the lowercased `to` address and copies `settings.tenantId` and `settings.organizationId` onto the created email. A holder of the global secret cannot inject into a tenant that set its own secret, because once `settings.webhookSecret` is present it is the only accepted signing key (`api/webhook/inbound.ts:319-332`). No system-scope (`organizationId: null`) operation is used anywhere in this spec.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Inbound transport and signature check | reuse | `inbox_ops` | `POST /api/inbox_ops/webhook/inbound` | Public signed route already ships with replay window, body limit and rate limits. |
| Tenant binding for an inbound mail | reuse | `inbox_ops` | `InboxSettings.inboxAddress` | Seeded per tenant; unique; the only mapping from address to scope. |
| LLM extraction into an offer draft | reuse | `inbox_ops` | subscriber on `inbox_ops.email.received` | Already prompts with the registered action catalogue and validates payloads. |
| Human review surface | reuse | `inbox_ops` | `/backend/inbox-ops/proposals/[id]` | Renders thread, actions, confidence, discrepancies, edit dialog. |
| Quote creation | reuse | `sales` | `create_quote` inbox action calling command `sales.quotes.create` | `sales` owns quotes and stays the source of truth. |
| Customer matching | reuse | `customers` | `resolveCustomerEntityIdByEmail`, or a `customerSnapshot` fallback | The executor already resolves by email and snapshots the name when there is no match. |
| Local inbound injection | app-own | new script, no module | signed HTTP call to the installed route | The platform has no simulator; this is the only genuinely missing piece. |
| An additional draft action type | app-own, conditional | new app module root `inbox-actions.ts` | discovery file collected into `.mercato/generated/inbox-actions.generated.ts` | Only if phase 2 proves a named gap. |

Installed records stay the source of truth: `sales` owns the quote, `customers` owns the contact, `catalog` owns the product, `inbox_ops` owns the email and the proposal. Nothing in this spec copies them into app-owned entities.

## Architecture and Data Flow

```text
simulate-inbound.mjs -> POST /api/inbox_ops/webhook/inbound (HMAC, unauthenticated)
                          -> resolve InboxSettings by `to`  -> tenantId / organizationId
                          -> InboxEmail(status=received)
                          -> event inbox_ops.email.received (persistent)
                                -> inbox_ops extraction worker (LLM)
                                     -> InboxProposal(+ InboxProposalAction create_quote)
                                     -> InboxDiscrepancy[*]
reviewer -> /backend/inbox-ops/proposals/[id]
              -> PATCH /api/inbox_ops/proposals/[id]/actions/[actionId]   (optional edit)
              -> POST  /api/inbox_ops/proposals/[id]/actions/[actionId]/accept
                    -> sales create_quote executor -> command sales.quotes.create
                          -> sales quote, id written back to the action
              -> POST  /api/inbox_ops/proposals/[id]/actions/[actionId]/reject  (nothing written)
```

- **Module boundaries:** no new module ships in phases 0 to 2. The conditional phase 3 module would own exactly one invariant: the app-specific draft action shape. It would hold no entity, so no transactional consistency argument forces a merge with anything.
- **Extension points:** the only seam this spec would ever use is the module-root `inbox-actions.ts` discovery file defined by `node_modules/@open-mercato/shared/src/modules/inbox-actions.ts` and collected by `yarn generate` into `.mercato/generated/inbox-actions.generated.ts`. Everything else is configuration.
- **Alternatives considered:** the Agent Orchestrator route, covered above; and a UMES mutation guard on `inbox_ops:inbox_proposal_action` to force review, rejected because review is already mandatory and a guard would add a failure mode with no new guarantee.
- **Compatibility:** every installed API, event and page keeps its current behavior. Setting `INBOX_OPS_WEBHOOK_SECRET` changes one thing observably: the custom-provider webhook path stops answering `503`. No public contract changes.

## User Journeys

### Journey J-001 — An offer request becomes a quote

1. The operator runs the simulation script with the `offer-request` fixture against the configured inbox address.
2. The route verifies the timestamp and the HMAC against the inbox's own secret, stores an `InboxEmail`, and emits `inbox_ops.email.received`.
3. The extraction worker writes an `InboxProposal` with category `rfq`, a `create_quote` action carrying customer, currency and line items, and any discrepancies it found.
4. The reviewer opens `/backend/inbox-ops/proposals/[id]`, reads the mail thread next to the draft, and accepts the action.
5. The `sales` executor creates a quote and the action shows `executed` with a link to `/backend/sales/quotes/[id]`.
6. Failure paths: no sales channel exists, so the executor returns `400` with "No sales channel available" and the action moves to `failed` with the message visible; the reviewer lacks `sales.quotes.manage`, so the accept is refused and nothing is written; the action was already accepted in another tab, so the second accept does not create a second quote.

### Journey J-002 — A non-offer message is not turned into an offer

1. The operator runs the script with the `not-an-offer` fixture, for example an invoice question with no products and no quantities.
2. The email is stored and extracted as before.
3. The resulting proposal carries no `create_quote` action. It may carry another category such as `payment` or `inquiry`, or no action at all.
4. The reviewer sees a summary and no offer to accept, and rejects the proposal. Nothing reaches `sales`.

### Journey J-003 — A forged or misaddressed inbound request is refused

1. A caller posts an unsigned body, a body signed with the global secret to an inbox that owns its own secret, a body with a timestamp older than five minutes, or a body addressed to an inbox no tenant owns.
2. The first three receive `400 Invalid signature`. The fourth receives `200 {ok:true}` with nothing persisted, so the response does not reveal which addresses exist.
3. No `InboxEmail`, no proposal and no quote is created in any tenant, and no log line contains the secret.

## UI and Interaction Contracts

No new or changed page ships in this spec. Both surfaces the journeys touch are installed and unmodified, and are listed here as the recorded references required by `.ai/guides/spec-delivery.md`. The MVP's UI work is verification, not authoring, so the design-system rules below are acceptance criteria against the installed pages rather than build instructions. If phase 2 finds a reviewer capability genuinely missing, that is a gap to record in the Open Questions table and re-spec, not to patch into an installed page.

Cross-record references follow the reference display rule and already do so in the installed surfaces: the proposal page shows the matched customer and product display names taken from the extraction payload and the matcher, and raw ids appear only in API payloads and in the deep link to the created quote.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/inbox-ops/proposals/[id]` | Review one offer draft: read the thread, edit the `create_quote` payload, accept, reject, accept all | `GET /api/inbox_ops/proposals/[id]`; `PATCH /api/inbox_ops/proposals/[id]/actions/[actionId]`; `POST .../accept`; `POST .../reject`; `POST /api/inbox_ops/proposals/[id]/accept-all` | itself, `node_modules/@open-mercato/core/src/modules/inbox_ops/backend/inbox-ops/proposals/[id]/page.tsx` | `Page`, `PageBody`, `Button`, `apiCall`, `flash`, `LoadingMessage`, `ErrorMessage`, `RecordNotFoundState`, `useConfirmDialog`, `useGuardedMutation`, `ActionCard`, `EditActionDialog`, `ConfidenceBadge`, `CategoryBadge` | loading, empty, error, conflict, success, permission denied | REQ-002, REQ-003 |
| `/backend/inbox-ops` | List proposals awaiting review and open one | `GET /api/inbox_ops/proposals`, `GET /api/inbox_ops/proposals/counts` | itself, `.../backend/inbox-ops/page.tsx` | installed list shell | loading, empty, error, permission denied | REQ-001 |
| `/backend/inbox-ops/settings` | Read the inbox address, set the working language and the per-tenant webhook secret | `GET` and `PATCH /api/inbox_ops/settings` | itself, `.../backend/inbox-ops/settings/page.tsx` | installed settings form | loading, error, success, permission denied | REQ-004, REQ-005 |
| `/backend/sales/quotes/[id]` | Confirm the created quote and its lines | installed sales quote detail | itself, `node_modules/@open-mercato/core/src/modules/sales/backend/sales/quotes/[id]/page.tsx` | installed detail shell | loading, error, permission denied | REQ-002 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Sales reviewer | Inbox Ops → Proposals; Sales → Quotes | none added by this spec | Login → Inbox Ops → open the pending proposal → accept. Three clicks. |
| Administrator | Inbox Ops → Settings | none added by this spec | Login → Inbox Ops → Settings → set the webhook secret. Three clicks. |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| `/backend/inbox-ops` | Installed empty state. Verify it explains that no proposals are waiting and does not imply a misconfiguration. | installed | installed |
| `/backend/inbox-ops/proposals/[id]` | Not applicable; a proposal always has a summary. Verify the no-actions case reads as a deliberate outcome, which is what J-002 produces. | installed | installed; the edit dialog must trap focus and close on Escape |

### `/backend/inbox-ops/proposals/[id]` — Offer draft review (installed, unchanged)

```text
┌────────────────────────────────────────────────────────────┐
│ ← Proposals   {summary}          [Reject]  [Accept all]    │
│ {category badge} {confidence badge} {language}             │
├────────────────────────────────────────────────────────────┤
│ Email thread            │ Proposed actions                 │
│  from / subject / body  │  ┌ create_quote  {confidence} ┐  │
│                         │  │ customer, currency, lines  │  │
│                         │  │ [Edit] [Reject] [Accept]   │  │
│                         │  └────────────────────────────┘  │
│                         │  Discrepancies: price mismatch…  │
├────────────────────────────────────────────────────────────┤
│ Executed → link to /backend/sales/quotes/[id]              │
└────────────────────────────────────────────────────────────┘
```

- **Behavior:** the reviewer may edit the action payload before accepting; the edit merges into the stored payload and is re-validated against `orderPayloadSchema`, returning `400` on a break. Accept is synchronous and returns the created entity id. Reject is confirmed through the shared confirm dialog. The PATCH honors an expected-version header for optimistic locking and is a no-op on that check when the header is absent, so the conflict state is only reachable when the client sends it.
- **Responsive and accessibility:** installed behavior, verified in phase 2 at narrow width with keyboard-only accept and reject.
- **Localization:** installed `inbox_ops` namespaces through `useT`. The proposal also carries `workingLanguage` and `translations`, so a non-English fixture is a meaningful phase 2 check.
- **Design-system and theming:** installed tokens and primitives. Phase 2 evidence covers light and dark mode. No arbitrary values and no hard-coded palette colors are introduced, because nothing is authored.

## Data Models

No new entity, no new column and no migration. Every record this spec creates belongs to an installed entity. Listed here for the fields the journeys depend on.

### `inbox_ops:inbox_settings` (installed, unchanged)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `inbox_address` | text, required | unique | no | seeded on tenant creation; the only address-to-tenant mapping |
| `webhook_secret` | text, nullable | per row | yes, read through `findOneWithDecryption` | when set it is the only accepted signing key for that inbox |
| `working_language` | text, default `en` | per row | no | drives proposal translation |
| `organization_id` / `tenant_id` | uuid, required | composite index | no | trusted context only |
| `updated_at` | timestamp | optimistic-lock version | no | updated on every edit |

### `inbox_ops:inbox_proposal` (installed, unchanged)

Key fields for this spec: `inbox_email_id`, `summary`, `participants`, `confidence`, `category`, `status` (`pending` | `partial` | `accepted` | `rejected`), `possibly_incomplete`, `reviewed_by_user_id`, `reviewed_at`, `llm_model`, `llm_tokens_used`, `working_language`, `translations`, plus scope and `updated_at`.

### `inbox_ops:inbox_proposal_action` (installed, unchanged)

Key fields: `proposal_id`, `sort_order`, `action_type` (`create_quote` for this spec), `description`, `payload` (validated by `orderPayloadSchema`), `status` (`pending` | `processing` | `accepted` | `rejected` | `executed` | `failed`), `confidence`, `required_feature`, `matched_entity_id`/`type`, `created_entity_id`/`type`, `execution_error`, `executed_at`, `executed_by_user_id`, plus scope and `updated_at`.

Sensitive data: the inbound body is customer free text and is stored in `inbox_emails` by the installed module under its own retention rules; this spec adds no field and no new retention decision. The fixtures committed to the repository must use invented people and invented companies, never a real customer.

## API, Command, and Error Contracts

No new route and no new command. Every row is installed and unchanged; they are recorded because the journeys and tests bind to them.

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST` | `/api/inbox_ops/webhook/inbound` | `requireAuth: false`; HMAC only | `{ from, to, subject, text, html?, messageId?, replyTo?, inReplyTo?, references? }` | `200 {ok:true}` + `inbox_ops.email.received` (persistent) | `400` invalid JSON or signature or stale timestamp; `413` over the body limit; `429` rate limited; `503` when no signing secret is configured. Dedup by `messageId` and content hash emits `inbox_ops.email.deduplicated` and returns `200`. | REQ-001, REQ-004, REQ-005 |
| `GET` | `/api/inbox_ops/proposals` | auth + `inbox_ops.proposals.view` | list filters | proposal list | `401`/`403` | REQ-001 |
| `GET` | `/api/inbox_ops/proposals/[id]` | auth + `inbox_ops.proposals.view` | path id | proposal with actions, discrepancies, email | `401`/`403`/`404` | REQ-002 |
| `PATCH` | `/api/inbox_ops/proposals/[id]/actions/[actionId]` | auth + `inbox_ops.proposals.manage` | `{ payload: partial }`, merged into the stored payload | updated action | `400` when the merged payload fails `orderPayloadSchema`; conflict when the expected-version header is sent and stale | REQ-002 |
| `POST` | `/api/inbox_ops/proposals/[id]/actions/[actionId]/accept` | auth + `inbox_ops.proposals.manage`, and the action's own `required_feature` (`sales.quotes.manage`) at execution | path ids | executed action with `created_entity_id`, `created_entity_type: 'sales_quote'`; `inbox_ops.action.executed` | `400` from the executor, for example no sales channel; `403` on the missing sales feature; `500` when `sales.quotes.create` returns no id, action moves to `failed` | REQ-002 |
| `POST` | `/api/inbox_ops/proposals/[id]/actions/[actionId]/reject` | auth + `inbox_ops.proposals.manage` | path ids | rejected action; `inbox_ops.action.rejected` | `401`/`403`/`404` | REQ-003 |
| `GET`/`PATCH` | `/api/inbox_ops/settings` | auth + `inbox_ops.settings.manage` | `{ workingLanguage?, webhookSecret? }` | settings with `webhookSecretSet: boolean`, never the secret itself | `400`/`401`/`403` | REQ-004, REQ-005 |
| command | `sales.quotes.create` | called by the `sales` executor with the reviewer's context | order payload mapped to lines and snapshots | `{ quoteId }` | executor raises `ExecutionError` when the id is missing | REQ-002 |

Every one of these routes declares per-method `metadata` and an `openApi` block today. The MVP adds none, so there is no new public contract and no new OpenAPI surface to review.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `inbox_ops.email.received` | `inbox_ops` webhook route | `inbox_ops:extraction-worker` | LLM extraction, proposal and actions written | Emitted `persistent: true`, so it runs through the events queue worker. Upstream idempotency is the webhook's dedup on `messageId` plus content hash. |
| `inbox_ops.email.processed` / `.failed` | extraction worker | none in this spec | email status moves | Failure is recorded on the email; the reviewer sees the failed state in the log page. |
| `inbox_ops.proposal.created` | extraction worker | none in this spec | the proposal becomes visible in the list | available as a seam if a notification is ever wanted |
| `inbox_ops.action.executed` / `.failed` / `.rejected` | accept and reject routes | none in this spec | audit trail of the human decision | `executed_by_user_id` and `executed_at` record who decided |
| `messages.message.sent` | `messages` | deliberately not consumed | none | Named here so it is not wired by mistake: it fires on outbound messages too. |

Scheduled work: none. Progress reporting: none. Cache: the webhook uses the shared cache for rate limiting and fails closed to a process-local bucket when the cache is unavailable; this spec changes nothing there. Optional-module behavior: if `customers` or `catalog` cannot resolve a match, the executor falls back to a `customerSnapshot` and a `service`-kind line, which is installed behavior and is what makes a first run work on thin seed data.

## Security, Privacy, and Compliance

- **Authorization:** feature gates only, taken from each route's `metadata`, plus the action's own `required_feature` at execution. No role-name check anywhere.
- **Tenant isolation:** backend actors are scoped from the session. The webhook derives scope from the resolved `InboxSettings` row and never from the body. Once an inbox sets `webhookSecret`, the global secret is no longer accepted for it, so holding the global key does not grant cross-tenant injection. An unknown `to` persists nothing.
- **Sensitive data:** `webhook_secret` is an encrypted column read through `findOneWithDecryption`, and the settings API returns only `webhookSecretSet: boolean`. The simulation script reads its secret from the environment, never from a committed file, and must never print it. `.env` stays out of the spec, out of logs and out of any report.
- **Abuse and failure modes:** replay is bounded to a five minute window on `x-webhook-timestamp`; body size is capped by `INBOX_OPS_WEBHOOK_MAX_BODY_BYTES` with a 2 MiB default and answers `413`; there is a pre-database global rate bucket keyed on a fingerprint of the signing secret and a per-tenant bucket keyed on the resolved tenant; enumeration is blocked by answering `200` for an unknown inbox; signature comparison is constant time. The one residual abuse path is prompt injection inside the mail body, which is why every write stays behind a human accept.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | one tenant with a seeded `InboxSettings`, a per-tenant secret, a sales channel, a currency, one catalogue product | run the script with the `offer-request` fixture, wait for extraction | an `InboxEmail` exists with status `received`; an `InboxProposal` exists with at least one `pending` `create_quote` action; the payload validates against `orderPayloadSchema`; the event `inbox_ops.email.received` was emitted | REQ-001, REQ-004 |
| TEST-002 | security | same tenant, plus a second tenant with its own inbox | post with no signature; post with a timestamp six minutes old; post signed with the global secret to an inbox that owns a per-tenant secret; post to an address no tenant owns | first three return `400`; the fourth returns `200` with no row created; zero `InboxEmail` rows in either tenant; no secret appears in the response or the log | REQ-005 |
| TEST-003 | integration | the proposal from TEST-001 | accept the `create_quote` action as a reviewer holding `inbox_ops.proposals.manage` and `sales.quotes.manage` | the action becomes `executed` with `created_entity_type: 'sales_quote'`; a quote exists in the same tenant and organization with the fixture's line count and currency; `inbox_ops.action.executed` was emitted | REQ-002 |
| TEST-004 | security | the proposal from TEST-001, reviewer without `sales.quotes.manage` | accept the action | the accept is refused; no quote exists; the action is not `executed` | REQ-002 |
| TEST-005 | integration | clean tenant | run the script with the `not-an-offer` fixture | a proposal exists; it carries no action of type `create_quote`; no sales quote exists in the tenant | REQ-003 |
| TEST-006 | UI | the proposal from TEST-001 | open `/backend/inbox-ops/proposals/[id]`, exercise loading and error, edit the payload through the dialog with an invalid currency then a valid one, accept by keyboard only, at narrow width, in light and dark mode | the invalid edit surfaces a validation error and does not save; the valid edit persists; accept succeeds and links to the created quote; focus order is sane and the dialog closes on Escape | REQ-002 |
| TEST-007 | integration | the email from TEST-001 | replay the identical body with the same `messageId` inside the replay window | the second call returns `200`, emits `inbox_ops.email.deduplicated`, and creates no second email and no second proposal | REQ-005 |

Every test is self-contained: it creates its own tenant, inbox, secret and catalogue rows, and asserts on API responses and persisted state rather than on a previous test's leftovers. The runner is the repository's own (`yarn test:integration:ephemeral`); see Q-005 on the exact placement of the fixtures.

## Implementation Phases

### Phase 0 — Enablement and a working inbound endpoint

- **Depends on:** none
- **Outcome:** the inbound webhook is reachable and authenticated, the tenant inbox address is known, and the AI provider answers. No user-visible feature yet, but every later phase is blocked without it.
- **Why this order / value delivered:** the endpoint currently answers `503` for every signed request, so nothing downstream can be observed. Value at completion: an administrator can state the tenant's inbox address and confirm the pipeline is switched on.
- **Deliverables:** `INBOX_OPS_WEBHOOK_SECRET` set in the local `.env`; optionally `INBOX_OPS_DOMAIN`; a per-tenant `webhookSecret` set through `/backend/inbox-ops/settings`; `OM_AI_PROVIDER` plus its key confirmed, or an `OM_AI_INBOX_OPS_PROVIDER`/`_MODEL` override; the events queue worker confirmed running so the persistent event is consumed; a short note in the spec log recording the inbox address in use. No repository file changes except `.env`, which is not committed.
- **Independent slices / estimated commits:** zero commits. This phase is configuration.
- **Requirements closed:** none on its own; it unblocks REQ-001 and REQ-004.
- **Tests:** none automated. The exit gate is manual.
- **Validation:** none of the gate commands apply; nothing is compiled.
- **Exit gate:** `GET /api/inbox_ops/settings` as an administrator returns the inbox address and `webhookSecretSet: true`; a hand-signed `curl` to `/api/inbox_ops/webhook/inbound` returns `200` rather than `503`; an `InboxEmail` row appears; within the LLM timeout an `InboxProposal` row appears for it, proving the worker consumed the persistent event.

### Phase 1 — Signed inbound simulation script and fixtures

- **Depends on:** Phase 0 exit gate
- **Outcome:** anybody on the team can inject a realistic inbound message from the command line, repeatably, with no mail server.
- **Why this order / value delivered:** phase 2 cannot be demonstrated or tested without a reliable way to produce an inbound email. Value at completion: the demo becomes a one-line command.
- **Deliverables:** one Node script, proposed at `scripts/simulate-inbound-email.mjs` (see Q-005), and two JSON fixtures, proposed under `scripts/fixtures/inbound/`. The script takes the target address, the fixture name and the base URL, reads the signing secret from the environment, generates a unique `messageId` per run so dedup does not silently swallow repeat demos, computes `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` as lowercase hex, and sends `x-webhook-signature` and `x-webhook-timestamp` with a JSON body of `{ from, to, subject, text, messageId }`. It prints the HTTP status and never prints the secret. It must support both signing paths: the per-tenant `webhookSecret` when the inbox owns one, which is the default the script targets, and the global `INBOX_OPS_WEBHOOK_SECRET` when it does not. Fixture one, `offer-request.json`: a buyer asking for a price on a named quantity of a product that exists in the catalogue, with a currency and a delivery date. Fixture two, `not-an-offer.json`: a question about an invoice, with no product, no quantity and no price.
- **Independent slices / estimated commits:** two, the script and the fixtures, which may be written in parallel.
- **Requirements closed:** REQ-004
- **Tests:** TEST-001, TEST-005, TEST-007
- **Validation:** `yarn lint`, `yarn typecheck`, then the two fixture runs by hand.
- **Exit gate:** running the script with `offer-request` produces a proposal carrying a `create_quote` action; running it with `not-an-offer` produces a proposal with no such action; running `offer-request` twice with the same `messageId` produces exactly one email; a run with a deliberately wrong secret returns `400`.

### Phase 2 — The review-to-quote journey, proven end to end

- **Depends on:** Phase 1 exit gate
- **Outcome:** a reviewer turns a drafted offer into a real sales quote, and the refusal paths are proven.
- **Why this order / value delivered:** this is the feature. Value at completion: the retyping step is gone for a real inbound request, and the team knows exactly which parts of the draft the extraction gets right.
- **Deliverables:** the integration and UI tests listed below; seed data sufficient for the executor, namely one sales channel, its currency and at least one catalogue product matching the fixture; a written record of every field the extraction filled, left empty, or got wrong, which is the input to the phase 3 decision.
- **Independent slices / estimated commits:** three, the happy-path integration test, the security tests, and the UI test.
- **Requirements closed:** REQ-001, REQ-002, REQ-003, REQ-005
- **Tests:** TEST-001 through TEST-007
- **Validation:** `yarn typecheck`, `yarn lint`, `yarn test`, `yarn test:integration:ephemeral`
- **Exit gate:** a quote exists in `/backend/sales/quotes` created only by an accept, with the fixture's currency and line count; a reviewer without `sales.quotes.manage` cannot create it; the `not-an-offer` fixture yields no `create_quote` action; the proposal page passes TEST-006 in light and dark mode, at narrow width, keyboard only; and the gap record above is written, naming either "no gap" or the exact missing behavior.

### Phase 3 — One app-owned draft action, conditional

- **Depends on:** Phase 2 exit gate recording a named observable gap. If the gap record says "no gap", this phase does not ship and the spec closes at phase 2.
- **Outcome:** the drafted offer carries the app-specific field or action the built-in extraction cannot produce.
- **Why this order / value delivered:** it is the only step that adds code to the app, so it is paid for only against evidence. The gap that unlocks it must be observable, for example: the extraction never fills a field this business needs on every offer and the field cannot be derived at accept time, or the business needs an action type the installed catalogue does not contain.
- **Deliverables:** one new app module under `src/modules/<id>/` whose only discovery file is a module-root `inbox-actions.ts` exporting an `InboxActionDefinition[]` with `type`, `requiredFeature`, `payloadSchema`, `promptSchema`, optional `promptRules`, optional `normalizePayload`, and an `execute` that writes only through `ctx.executeCommand`. No entity, no migration, no page.
- **Independent slices / estimated commits:** one.
- **Requirements closed:** none. Every requirement closes by phase 2 by design.
- **Tests:** a new self-contained integration test asserting the new action type appears on a proposal for a fixture that demands it, and that executing it writes through the command bus in the reviewer's scope.
- **Validation:** `yarn generate`, then `yarn typecheck`, `yarn lint`, `yarn test`, `yarn test:integration:ephemeral`
- **Exit gate:** the new type appears in `.mercato/generated/inbox-actions.generated.ts`, a proposal renders it, and accepting it creates the intended record. The classification problem in the traceability note below must be resolved before this phase starts.

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/inbox-ops` | `POST /api/inbox_ops/webhook/inbound`, `inbox_ops.email.received`, `inbox_ops:inbox_proposal` | Phase 2 (enabled by Phase 0, exercised by Phase 1) | TEST-001 | AC-001 |
| REQ-002 | J-001, `/backend/inbox-ops/proposals/[id]`, `/backend/sales/quotes/[id]` | `POST .../actions/[actionId]/accept`, command `sales.quotes.create`, `inbox_ops.action.executed` | Phase 2 | TEST-003, TEST-004, TEST-006 | AC-002, AC-003 |
| REQ-003 | J-002, `/backend/inbox-ops/proposals/[id]` | `inbox_ops:inbox_proposal_action` absence of `create_quote` | Phase 2 | TEST-005 | AC-004 |
| REQ-004 | J-001 step 1 | `POST /api/inbox_ops/webhook/inbound`, HMAC headers | Phase 1 | TEST-001, TEST-007 | AC-005 |
| REQ-005 | J-003, `/backend/inbox-ops/settings` | webhook signature and tenant resolution, `PATCH /api/inbox_ops/settings` | Phase 2 (script support in Phase 1) | TEST-002, TEST-007 | AC-006 |

### Extension-surface traceability

Phases 0 to 2 add no runtime or discovery extension surface. The script in phase 1 is a standalone client of a public HTTP route; it is not a module contribution, registers nothing, and is not loaded by discovery.

| Surface | Requirement | Reference file it adapts | Phase | Its own integration test | Mechanism classification |
|---|---|---|---|---|---|
| module-root `inbox-actions.ts` in a new app module | none; phase 3 closes no requirement | **unresolved, see the note below** | Phase 3, conditional | new test asserting the type reaches `.mercato/generated/inbox-actions.generated.ts` and executes in scope | `catalog-only`, provisional |

Note, and it is a blocker for phase 3 rather than for this spec: `src/modules/example/` does not emit an `inbox-actions.ts`, and `src/modules/example/references/surface-inventory.json` carries no coverage row for the inbox-action surface at all. The traceability rule requires an exact reference file and exactly one classification justified by the reference module's own coverage ledger. Neither exists here. The framework does describe the surface, in `node_modules/@open-mercato/shared/src/modules/inbox-actions.ts` and the generated registry, which is why `catalog-only` is the closest honest label, but the ledger does not carry the row that would justify it. This is recorded as Q-006 and must be resolved before phase 3 starts. It does not block phases 0 to 2, which add no surface.

## Rollout, Migration, and Rollback

No migration, because no entity changes. Nothing to generate, because no discovery file changes in phases 0 to 2; `yarn generate` is required only if the conditional phase 3 ships.

Rollout order: configure (phase 0), then add the script (phase 1), then prove the journey (phase 2). Setup work is limited to values already seeded by `inbox_ops.setup.onTenantCreated` plus a per-tenant secret an administrator sets in the UI. There is no feature flag, because there is no new feature surface to flag.

Observability: the installed `/backend/inbox-ops/log` page shows inbound emails and their status, which is the operational view for a failed extraction.

Rollback is complete and cheap at every step. Unset `INBOX_OPS_WEBHOOK_SECRET` and the inbound path returns `503` again, which is exactly today's behavior. Clear the per-tenant `webhookSecret` through the settings page and the inbox falls back to the global key. Delete the script and the fixtures and the repository is byte-identical to its current state. Nothing this spec does is destructive: no installed data is rewritten, and a quote created by an accept is an ordinary sales quote the reviewer can handle through the normal sales flow.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Prompt injection inside the mail body steers the extraction into a favourable draft | A quote with attacker-chosen prices or lines | Every write is behind a human accept; the price validator raises a `price_mismatch` discrepancy against the catalogue; the reviewer sees the source mail next to the draft | A reviewer who accepts without reading. Accepted for the MVP, which is exactly why auto-approval is out of scope. |
| The extraction produces a plausible but wrong draft, for example the wrong product variant | Wrong quote reaches the customer if the reviewer misses it | Discrepancies are surfaced; phase 2 records every field the extraction got wrong; the reviewer can edit before accepting | Residual and permanent. Mitigated by review, not removed. |
| No sales channel or no currency in the target tenant | The accept fails with `400` and the demo stalls | Phase 2 seed data explicitly includes a channel, its currency and a product; the error message names the cause | Low. |
| The events queue worker is not running, so the persistent event is never consumed | An email is stored and no proposal ever appears; the symptom looks like an LLM failure | The phase 0 exit gate checks for the proposal, not just the email, which separates the two failures | Open until Q-001 names the worker host for this app. |
| LLM provider outage, timeout, or quota exhaustion | Extraction fails; the email sits in a failed state | `inbox_ops.email.failed` is emitted and the log page shows it; `INBOX_OPS_LLM_TIMEOUT_MS` bounds the wait; `/api/inbox_ops/emails/[id]/reprocess` re-runs it | Accepted. |
| A holder of the global webhook secret posts into a tenant that has not set its own | An email is injected into that tenant | Phase 0 sets a per-tenant secret, which makes the global key unusable for that inbox | Low for the configured tenant; real for any tenant that skips the per-tenant secret. Worth calling out to administrators. |
| A committed fixture contains real customer data | Personal data in version control | Fixtures use invented names and invented companies, reviewed at merge | Low. |
| The team reads this spec as permission to build the orchestrator module later without evidence | Wasted build of a duplicate pipeline | The deferred alternative section names the exact conditions that unlock it | Low. |

## Acceptance Criteria

- [ ] **AC-001** — A signed inbound message addressed to the tenant inbox produces an `InboxProposal` in that tenant and organization carrying at least one `pending` `create_quote` action, with no human touching a mailbox.
- [ ] **AC-002** — Accepting that action as a reviewer holding `inbox_ops.proposals.manage` and `sales.quotes.manage` creates exactly one sales quote in the same tenant and organization, with the fixture's currency and line count, and writes its id back to the action as `created_entity_type: 'sales_quote'`.
- [ ] **AC-003** — No sales quote exists in the tenant at any point before that accept, and a reviewer lacking `sales.quotes.manage` cannot create one.
- [ ] **AC-004** — The `not-an-offer` fixture produces a proposal with no `create_quote` action and no sales quote.
- [ ] **AC-005** — A developer with a clean checkout runs one documented command and lands a drafted offer, with no mail server and no external account.
- [ ] **AC-006** — Unsigned, stale, wrong-secret and unknown-inbox inbound requests create no email, no proposal and no quote, and the unknown-inbox case is indistinguishable from success in the response body.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states. This spec authors none of them, so the criterion is verified against the installed pages in TEST-006.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | Root `AGENTS.md`; `.ai/guides/spec-delivery.md`; `.agents/skills/om-spec-writing/SKILL.md` and its `references/rules.md` and `references/agentic-setup.md`; `.ai/guides/modules/inbox_ops/*`; `.ai/guides/modules/sales/{domain-commands,acl-features,backend-pages}.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Traceability rows REQ-001 to REQ-005; no new entity, route, command or page, so every contract row cites installed source |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001 to J-003; phases 0 to 2 each close with their own exit gate; phase 3 is conditional and closes no requirement |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map; the only app-owned artifact in the shipping phases is the simulation script, and the orchestrator route is rejected with reasons |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI table cites the installed page files and their component families; TEST-006 covers light/dark, narrow width and keyboard |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phases 0 to 3 |

Verdict: `Blocked — Q-001, Q-002, Q-005 and Q-006 are open; Q-006 blocks the conditional phase 3 only.`

## Open Questions

Blocking questions must be resolved before setting `Status: Ready for implementation`.

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Which process consumes persistent events in this app during `yarn dev`? `inbox_ops.email.received` is emitted with `persistent: true`, the worker is `events:workers:events.worker`, and `package.json` exposes no dedicated worker script. If `yarn dev` does not run it, phase 0 needs an extra step. | operator | yes, blocks Phase 0 | pending |
| Q-002 | Which tenant, sales channel, currency and catalogue product does the demo target? The `create_quote` executor fails with `400` when no channel exists, and the line matcher needs a product the fixture can name. | operator | yes, blocks Phase 2 | pending |
| Q-003 | May the reviewer edit the draft before accepting, and how far? Source answers the mechanism: `PATCH /api/inbox_ops/proposals/[id]/actions/[actionId]` merges a partial payload and re-validates it, and the page ships an `EditActionDialog`. Open part is policy: is editing line prices allowed, or should the reviewer reject and re-quote by hand? | operator | no | pending; the MVP allows whatever the installed dialog allows |
| Q-004 | Which fields must an offer draft carry for this business beyond `orderPayloadSchema`'s required `customerName`, `currencyCode` and `lineItems`? The answer decides whether phase 3 is ever unlocked. | operator | no | pending; phase 2's gap record is the input |
| Q-005 | Exact path and runner for the simulation script and its fixtures. Proposed `scripts/simulate-inbound-email.mjs` with `scripts/fixtures/inbound/*.json`, run with `node`, matching the existing plain-`.mjs` scripts in `scripts/`. Confirm, or name a different home. | operator | no | pending; proposal stands unless overridden |
| Q-006 | How is a module-root `inbox-actions.ts` classified under the extension-surface traceability rule? `src/modules/example/` emits no such file and `references/surface-inventory.json` has no coverage row for the surface, so no exact reference file and no ledger-justified classification exist. | operator, plus whoever owns the example module's coverage ledger | yes, blocks Phase 3 only | pending |
| Q-007 | Does the demo need a non-English fixture? The proposal carries `workingLanguage` and `translations`, and the installed page renders a language toggle, so it is cheap to include, but it doubles the review evidence. | operator | no | pending |

## Changelog

| Date | Change |
|---|---|
| 2026-09-19 | Initial draft. Written against installed source after the briefed Agent Orchestrator premise was found to be already covered by `inbox_ops` plus `sales`; the orchestrator route is recorded as a deferred alternative. |
