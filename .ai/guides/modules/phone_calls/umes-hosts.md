# phone_calls — UMES hosts

[Back to module index](index.md)

## UMES hosts

| ID / pattern | Family | Supports | Context | Stability | Source |
|---|---|---|---|---|---|
| phone_calls:phone_call | entity | response-enricher, query-enricher, mutation-guard, entity-extension | tenant-and-organization | STABLE | entities:phone_calls:phone_call |
| phone_calls:phone_call_participant | entity | response-enricher, query-enricher, mutation-guard, entity-extension | tenant-and-organization | STABLE | entities:phone_calls:phone_call_participant |
| phone_calls.call.ingest_failed | event | async-subscriber, sync-subscriber | tenant-organization-and-audience | STABLE | events:phone_calls.call.ingest_failed |
| phone_calls.call.ingested | event | async-subscriber, sync-subscriber | tenant-organization-and-audience | STABLE | events:phone_calls.call.ingested |
| phone_calls.call.updated | event | async-subscriber, sync-subscriber | tenant-organization-and-audience | STABLE | events:phone_calls.call.updated |

<!-- end module facts section: phone_calls/umes-hosts -->
