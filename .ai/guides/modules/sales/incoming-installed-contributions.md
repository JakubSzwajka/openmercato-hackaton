# sales — Incoming installed contributions

[Back to module index](index.md)

## Incoming installed contributions

| Contributor | Kind | Target | Resolution | Activation | Contribution · Source |
|---|---|---|---|---|---|
| documents | entity-extension | entity:sales:sales_quote @sales | capability-only | — | documents.entity-extension.4:sales:sales_quote->documents:document_entity_link · [node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts) |
| documents | entity-extension | entity:sales:sales_order @sales | capability-only | — | documents.entity-extension.5:sales:sales_order->documents:document_entity_link · [node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/data/extensions.ts) |
| shipping_carriers | data-table | widget-spot:data-table:sales.orders:row-actions @sales | bound | widget-spot:data-table:sales.orders:row-actions:widget-injection-consumer | shipping_carriers.injection.create-shipment-button@data-table:sales.orders:row-actions · [node_modules/@open-mercato/core/src/modules/shipping_carriers/widgets/injection-table.ts](../../../../node_modules/@open-mercato/core/src/modules/shipping_carriers/widgets/injection-table.ts) |
| staff | entity-extension | entity:sales:sales_order @sales | capability-only | — | staff.entity-extension.2:sales:sales_order->staff:staff_time_entry · [node_modules/@open-mercato/core/src/modules/staff/data/extensions.ts](../../../../node_modules/@open-mercato/core/src/modules/staff/data/extensions.ts) |
| wms | subscriber | event:sales.order.cancelled @sales | capability-only | — | wms:sales-order-cancelled-release · [node_modules/@open-mercato/core/src/modules/wms/subscribers/sales-order-cancelled-release.ts](../../../../node_modules/@open-mercato/core/src/modules/wms/subscribers/sales-order-cancelled-release.ts) |
| wms | subscriber | event:sales.order.confirmed @sales | capability-only | — | wms:sales-order-confirmed-reserve · [node_modules/@open-mercato/core/src/modules/wms/subscribers/sales-order-confirmed-reserve.ts](../../../../node_modules/@open-mercato/core/src/modules/wms/subscribers/sales-order-confirmed-reserve.ts) |
| wms | data-table | widget-spot:data-table:sales.order.items:columns @sales | bound | widget-spot:data-table:sales.order.items:columns:widget-injection-consumer | wms.injection.order-items-stock-column@data-table:sales.order.items:columns · [node_modules/@open-mercato/core/src/modules/wms/widgets/injection-table.ts](../../../../node_modules/@open-mercato/core/src/modules/wms/widgets/injection-table.ts) |
| wms | response-enricher | entity:sales:sales_order @sales | capability-only | — | wms.sales-order-inventory · [node_modules/@open-mercato/core/src/modules/wms/data/enrichers.ts](../../../../node_modules/@open-mercato/core/src/modules/wms/data/enrichers.ts) |

<!-- end module facts section: sales/incoming-installed-contributions -->
