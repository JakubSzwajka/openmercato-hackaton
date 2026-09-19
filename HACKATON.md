# Hackaton demo runbook

Everything needed to build the Nordwind Logistics demo, run one enquiry through it, and wipe the activity so you can rehearse again.

All commands run from the repository root.

## The moving parts

```
yarn demo:seed              builds the company        (idempotent, adds only)
yarn demo:seed --reset      wipes activity, rebuilds  (company survives)

offer_automation demo       makes activity OFFLINE    (no server, no model, no worker)
offer_automation send-email makes activity FOR REAL   (signed webhook -> running app)
offer_automation origins    shows the email -> proposal -> quote trail
offer_automation check-ai   proves a model is reachable before you rely on one
```

## What the seed creates

| Step | What |
|---|---|
| 1/8 | Tenant and organization, `Nordwind Logistics`, slug `nordwind-logistics` |
| 2/8 | Roles, `admin@nordwind-logistics.example`, `sales@nordwind-logistics.example`, automation account |
| 3/8 | Currencies, catalogue units and price kinds, sales statuses, tax rates, adjustment kinds, shipping and payment methods, CRM dictionaries |
| 4/8 | Feature grants (`sync-role-acls`) |
| 5/8 | Sales channel `Direct sales` |
| 6/8 | Freight catalogue: `FRT-FTL-SHIPMENT`, `FRT-LTL-PALLET`, `FRT-ROAD-KM`, `FRT-ACC-TAILLIFT` |
| 7/8 | Three customers with contacts: Nordwind Spedition GmbH, Baltic Freight Partners, Vistula Logistics |
| 8/8 | Inbound mailbox settings for the org |

Default password for both humans is `Nordwind!1`. Override with `--password`, `--admin-password`, `--sales-password`, or `OM_DEMO_PASSWORD`.

The seed creates **no activity**. No inbound email, no thread, no proposal, no quote, no notification. That is on purpose: the first email in the system is one you send.

## What `--reset` deletes

Step `0/8`, before anything is rebuilt. Scoped to one tenant and one organization, children before parents.

```
message_access_tokens · message_objects · message_recipients
message_confirmations · messages
sales_quotes (through sales.quotes.delete, which empties 5 child tables)
inbox_discrepancies · inbox_proposal_actions · inbox_proposals
inbox_emails
notifications (org-scoped only; org_id IS NULL rows survive)
```

Survives a reset: tenant, organization, roles, users, automation account, feature grants, currencies, sales dictionaries, the sales channel, the freight catalogue, the three customers, and `inbox_settings`.

Refuses to run when `NODE_ENV=production`, unless `OM_DEMO_SEED_ALLOW_PRODUCTION` holds the exact override value the error names.

### Why the reset matters

Core's inbound webhook deduplicates permanently on `contentHash`, scoped to tenant and org, with no time window (`inbox_ops/api/webhook/inbound.ts:437`, `checkDuplicate`). Send the same enquiry body twice and the second one is dropped while the webhook still answers `200`. Clearing `inbox_emails` is what lets you rehearse with an unchanged body.

## Path A: offline rehearsal

Needs a database. No server, no API key, no queue worker.

```bash
# 1. Build the company. Copy tenantId, organizationId and the sales userId it prints.
yarn demo:seed

export T=<tenantId>
export O=<organizationId>
export U=<salesUserId>

# 2. Create activity: inbox email, thread, proposal, accepted draft_offer, quote.
yarn mercato offer_automation demo --tenant $T --org $O --auto-accept --user $U

# 3. Confirm it is there.
yarn mercato offer_automation origins --tenant $T --org $O

# 4. Wipe it. Watch the 0/8 block and its counts.
yarn demo:seed --reset

# 5. Confirm it is gone.
yarn mercato offer_automation origins --tenant $T --org $O

# 6. Same body again, to prove the dedupe is unblocked.
yarn mercato offer_automation demo --tenant $T --org $O --auto-accept --user $U
yarn mercato offer_automation origins --tenant $T --org $O
```

`salesUserId` is printed in step `2/8`, on the row for `sales@nordwind-logistics.example`.

## Path B: the real webhook

This is the one that shows the system reacting on its own. It needs three things the offline path does not.

1. `INBOX_OPS_WEBHOOK_SECRET` set in `.env`. The command signs with it and the server verifies with it, so both sides read one value. Restart `yarn dev` after changing it.
2. A running app at `APP_URL`, default `http://localhost:3000`.
3. A queue worker draining events. `yarn dev` spawns one when `AUTO_SPAWN_WORKERS` is on; otherwise run `yarn mercato queue worker --all`.

```bash
yarn dev                                    # separate terminal

yarn demo:seed
export T=<tenantId>
export O=<organizationId>

yarn mercato offer_automation check-ai      # thirty seconds now beats finding out on stage
yarn mercato offer_automation send-email
yarn mercato offer_automation origins --tenant $T --org $O

yarn demo:seed --reset
yarn mercato offer_automation origins --tenant $T --org $O

yarn mercato offer_automation send-email    # same body, must not be deduped away
yarn mercato offer_automation origins --tenant $T --org $O
```

What reacts, in order:

1. An events worker picks up the job.
2. Extraction turns the email into a proposal carrying a `draft_offer` action.
3. `offer_automation:draft-offer-executor` runs that action as the automation user and creates the priced draft quote.
4. Everyone holding `sales.quotes.view` gets a notification naming the quote.

## Checks that tell you it worked

1. [ ] `yarn demo:seed --reset` prints `0/8  Reset (org nordwind-logistics)` with non-zero counts, including its own `inbox_emails` line.
2. [ ] `origins` right after the reset prints nothing.
3. [ ] Steps `1/8` to `8/8` all report `already present`, so company, catalogue and customers survived.
4. [ ] The repeat send lands a new email. A silent disappearance with HTTP `200` means the `inbox_emails` delete did not take.

## When it goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Email sent, nothing reacts, status stays `received` with no error | No events worker draining the queue | `yarn mercato queue worker --all` |
| `send-email` fails to sign or the server rejects it | `INBOX_OPS_WEBHOOK_SECRET` missing or different on the two sides | Set it in `.env`, restart `yarn dev` |
| Second send vanishes, HTTP `200`, no new email | `contentHash` dedupe | `yarn demo:seed --reset`, or change the body |
| Accepted offer fails with no status | `sales.order_status` `draft` missing | `yarn mercato sales seed-statuses --tenant $T --org $O` |
| `executeDraftOffer` refuses | No active sales channel | Activate one under Sales > Channels |
| Live extraction fails on stage | Key missing, expired or out of quota | `yarn mercato offer_automation check-ai` beforehand; fall back to `demo` |

`seed-demo` runs its own prerequisite check at the end and names whichever of the last two is missing.

## Other useful flags

```bash
yarn mercato offer_automation seed-demo --help
yarn mercato offer_automation send-email --help
yarn mercato offer_automation demo --help

# A second, throwaway company beside the first.
yarn demo:seed --org-slug throwaway-freight --admin-email admin@throwaway.example

# Catalogue only, into an existing org.
yarn mercato offer_automation seed-catalog --tenant $T --org $O

# Custom enquiry text.
yarn mercato offer_automation send-email --subject "Quote please" --body "3 pallets Poznan to Hamburg, no dock."
yarn mercato offer_automation send-email --body-file ./enquiry.txt
```

`demo` is deterministic and offline. `send-email` is the honest one. Rehearse with `demo`, present with `send-email`, and keep `demo` as the fallback if the venue wifi or the API key lets you down.
