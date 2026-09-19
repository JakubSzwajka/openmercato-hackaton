# staff — Active extension bindings

[Back to module index](index.md)

## Active extension bindings

| Activation | Kind | Host | Contribution kinds | Phases | Bridge | Source |
|---|---|---|---|---|---|---|
| api-route:staff/timesheets/time-entries:GET:api-interceptor-bridge | api-interceptor-bridge | api-route:staff/timesheets/time-entries GET @staff | api-interceptor | before | apiRoutes:/staff/timesheets/time-entries | [api/timesheets/time-entries/route.ts](../../../../node_modules/@open-mercato/core/src/modules/staff/api/timesheets/time-entries/route.ts) |
| entity:staff:staff_time_entry:crud-response-enricher | crud-response-enricher | entity:staff:staff_time_entry @staff | response-enricher | — | — | [api/timesheets/time-entries/route.ts:411](../../../../node_modules/@open-mercato/core/src/modules/staff/api/timesheets/time-entries/route.ts#L411) |
| entity:staff:staff_time_project:crud-response-enricher | crud-response-enricher | entity:staff:staff_time_project @staff | response-enricher | — | — | [api/timesheets/time-projects/route.ts:355](../../../../node_modules/@open-mercato/core/src/modules/staff/api/timesheets/time-projects/route.ts#L355) |
| entity:staff:staff_time_report:crud-response-enricher | crud-response-enricher | entity:staff:staff_time_report @staff | response-enricher | — | — | [api/timesheets/reports/route.ts:277](../../../../node_modules/@open-mercato/core/src/modules/staff/api/timesheets/reports/route.ts#L277) |
| entity:staff:staff_time_task:crud-response-enricher | crud-response-enricher | entity:staff:staff_time_task @staff | response-enricher | — | — | [api/timesheets/tasks/route.ts:357](../../../../node_modules/@open-mercato/core/src/modules/staff/api/timesheets/tasks/route.ts#L357) |
| widget-spot:dashboard:staff.timesheets.hoursByProject:dashboard-host-consumer | dashboard-host-consumer | widget-spot:dashboard:staff.timesheets.hoursByProject @framework | widget | — | hosts:framework.dashboard | packages/ui/src |
| widget-spot:dashboard:staff.timesheets.timeReporting:dashboard-host-consumer | dashboard-host-consumer | widget-spot:dashboard:staff.timesheets.timeReporting @framework | widget | — | hosts:framework.dashboard | packages/ui/src |

<!-- end module facts section: staff/active-extension-bindings -->
