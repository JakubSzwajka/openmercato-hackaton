# workflows — Events

[Back to module index](index.md)

## Events  (32)

| ID | Category | Entity | Browser transport | Source |
|---|---|---|---|---|
| workflows.definition.created | crud | definition | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.definition.updated | crud | definition | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.definition.deleted | crud | definition | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.definition.customized | lifecycle | definition | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.definition.reset_to_code | lifecycle | definition | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.definition.published | lifecycle | definition | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.created | crud | instance | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.updated | crud | instance | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.deleted | crud | instance | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.started | lifecycle | — | client | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.completed | lifecycle | — | client | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.failed | lifecycle | — | client | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.cancelled | lifecycle | — | client | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.paused | lifecycle | — | client | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.resumed | lifecycle | — | client | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.milestone_reached | lifecycle | — | client | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.task.assigned | lifecycle | task | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.task.reminder_due | lifecycle | task | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.task.deadline_breached | lifecycle | task | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.task.portal_assigned | lifecycle | task | portal | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.activity.started | lifecycle | — | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.activity.completed | lifecycle | — | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.activity.failed | lifecycle | — | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.agent.action | lifecycle | — | client | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.trigger.created | crud | trigger | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.trigger.updated | crud | trigger | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.trigger.deleted | crud | trigger | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.branch.opened | lifecycle | branch | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.branch.completed | lifecycle | branch | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.branch.cancelled | lifecycle | branch | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.branch.failed | lifecycle | branch | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.join.completed | lifecycle | branch | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |

<!-- end module facts section: workflows/events -->
