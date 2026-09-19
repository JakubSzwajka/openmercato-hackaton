# workflows — Contribution resolutions

[Back to module index](index.md)

## Contribution resolutions

| Contribution | Target | Resolution | Activations | Source |
|---|---|---|---|---|
| ai:workflows.create_definition | module:workflows.create_definition | capability-only | — | [ai-tools/authoring-pack.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/ai-tools/authoring-pack.ts) |
| ai:workflows.get_context_schema | module:workflows.get_context_schema | capability-only | — | [ai-tools/authoring-pack.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/ai-tools/authoring-pack.ts) |
| ai:workflows.list_activity_types | module:workflows.list_activity_types | capability-only | — | [ai-tools/authoring-pack.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/ai-tools/authoring-pack.ts) |
| ai:workflows.start_test_run | module:workflows.start_test_run | capability-only | — | [ai-tools/authoring-pack.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/ai-tools/authoring-pack.ts) |
| ai:workflows.update_definition | module:workflows.update_definition | capability-only | — | [ai-tools/authoring-pack.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/ai-tools/authoring-pack.ts) |
| ai:workflows.validate_definition | module:workflows.validate_definition | capability-only | — | [ai-tools/authoring-pack.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/ai-tools/authoring-pack.ts) |
| ai:workflows.validate_workflow_definition | module:workflows.validate_workflow_definition | capability-only | — | [ai-tools/authoring-pack.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/ai-tools/authoring-pack.ts) |
| notification:workflows.task.assigned | module:workflows.task.assigned @workflows | capability-only | — | [notifications.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/notifications.ts) |
| notification:workflows.task.deadline_breached | module:workflows.task.deadline_breached @workflows | capability-only | — | [notifications.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/notifications.ts) |
| notification:workflows.task.reminder_due | module:workflows.task.reminder_due @workflows | capability-only | — | [notifications.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/notifications.ts) |
| workflow:workflows.checkout-demo | module:workflows.checkout-demo | capability-only | — | [workflows.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/workflows.ts) |
| workflow:workflows.simple-approval | module:workflows.simple-approval | capability-only | — | [workflows.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/workflows.ts) |
| workflows:event-trigger | wildcard:* | wildcard | — | [subscribers/event-trigger.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/subscribers/event-trigger.ts) |
| workflows:task-assigned-notification | event:workflows.task.assigned @workflows | capability-only | — | [subscribers/task-assigned-notification.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/subscribers/task-assigned-notification.ts) |
| workflows:task-deadline-breached-notification | event:workflows.task.deadline_breached @workflows | capability-only | — | [subscribers/task-deadline-breached-notification.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/subscribers/task-deadline-breached-notification.ts) |
| workflows:task-reminder-notification | event:workflows.task.reminder_due @workflows | capability-only | — | [subscribers/task-reminder-notification.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/subscribers/task-reminder-notification.ts) |
| workflows.agent.action.browser | event:workflows.agent.action @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.injection.order-approval@sales.document.detail.order:details | widget-spot:sales.document.detail.order:details | wildcard | — | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/widgets/injection-table.ts) |
| workflows.injection.pending-work@detail:customers.company:footer | widget-spot:detail:customers.company:footer @customers | bound | widget-spot:detail:customers.company:footer:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/widgets/injection-table.ts) |
| workflows.injection.pending-work@detail:customers.deal:footer | widget-spot:detail:customers.deal:footer @customers | bound | widget-spot:detail:customers.deal:footer:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/widgets/injection-table.ts) |
| workflows.injection.pending-work@detail:customers.person:footer | widget-spot:detail:customers.person:footer @customers | bound | widget-spot:detail:customers.person:footer:widget-injection-consumer | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/widgets/injection-table.ts) |
| workflows.injection.pending-work@sales.document.detail.order:tabs | widget-spot:sales.document.detail.order:tabs | wildcard | — | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/widgets/injection-table.ts) |
| workflows.instance.cancelled.browser | event:workflows.instance.cancelled @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.completed.browser | event:workflows.instance.completed @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.failed.browser | event:workflows.instance.failed @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.milestone_reached.browser | event:workflows.instance.milestone_reached @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.paused.browser | event:workflows.instance.paused @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.resumed.browser | event:workflows.instance.resumed @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.instance.started.browser | event:workflows.instance.started @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |
| workflows.task.portal_assigned.browser | event:workflows.task.portal_assigned @workflows | capability-only | — | [events.ts](../../../../node_modules/@open-mercato/core/src/modules/workflows/events.ts) |

<!-- end module facts section: workflows/contribution-resolutions -->
