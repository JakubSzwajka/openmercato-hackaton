# documents — Contribution resolutions

[Back to module index](index.md)

## Contribution resolutions

| Contribution | Target | Resolution | Activations | Source |
|---|---|---|---|---|
| documents.entity-extension.0:customers:customer_entity->documents:document_entity_link | entity:customers:customer_entity @customers | capability-only | — | [data/extensions.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts) |
| documents.entity-extension.1:customers:customer_deal->documents:document_entity_link | entity:customers:customer_deal @customers | capability-only | — | [data/extensions.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts) |
| documents.entity-extension.2:catalog:catalog_product->documents:document_entity_link | entity:catalog:catalog_product @catalog | capability-only | — | [data/extensions.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts) |
| documents.entity-extension.3:catalog:catalog_offer->documents:document_entity_link | entity:catalog:catalog_offer @catalog | capability-only | — | [data/extensions.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts) |
| documents.entity-extension.4:sales:sales_quote->documents:document_entity_link | entity:sales:sales_quote @sales | capability-only | — | [data/extensions.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts) |
| documents.entity-extension.5:sales:sales_order->documents:document_entity_link | entity:sales:sales_order @sales | capability-only | — | [data/extensions.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts) |
| documents.injection.related-documents@crud-form:catalog.product | widget-spot:crud-form:catalog.product @catalog | bound | widget-spot:crud-form:catalog.product:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |
| documents.injection.related-documents@customers.company.detail:details | widget-spot:customers.company.detail:details @customers | bound | widget-spot:customers.company.detail:details:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |
| documents.injection.related-documents@customers.person.detail:details | widget-spot:customers.person.detail:details @customers | bound | widget-spot:customers.person.detail:details:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |
| documents.injection.related-documents@detail:customers.company:footer | widget-spot:detail:customers.company:footer @customers | bound | widget-spot:detail:customers.company:footer:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |
| documents.injection.related-documents@detail:customers.deal:footer | widget-spot:detail:customers.deal:footer @customers | bound | widget-spot:detail:customers.deal:footer:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |
| documents.injection.related-documents@detail:customers.person:footer | widget-spot:detail:customers.person:footer @customers | bound | widget-spot:detail:customers.person:footer:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |
| documents.injection.related-documents@sales.document.detail.order:details | widget-spot:sales.document.detail.order:details | wildcard | — | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |
| documents.injection.related-documents@sales.document.detail.quote:details | widget-spot:sales.document.detail.quote:details | wildcard | — | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |
| notification:documents.comment.mentioned | module:documents.comment.mentioned @documents | capability-only | — | [notifications.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/notifications.ts) |
| notification:documents.watch.changed | module:documents.watch.changed | capability-only | — | [notifications.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/notifications.ts) |
| notification:documents.watch.commented | module:documents.watch.commented | capability-only | — | [notifications.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/notifications.ts) |

<!-- end module facts section: documents/contribution-resolutions -->
