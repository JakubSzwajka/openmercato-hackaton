# workflows — Incoming installed contributions

[Back to module index](index.md)

## Incoming installed contributions

| Contributor | Kind | Target | Resolution | Activation | Contribution · Source |
|---|---|---|---|---|---|
| agent_orchestrator | subscriber | event:workflows.instance.cancelled @workflows | capability-only | — | agent_orchestrator:process-workflow-cancelled · [node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-cancelled.ts](../../../../node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-cancelled.ts) |
| agent_orchestrator | subscriber | event:workflows.instance.completed @workflows | capability-only | — | agent_orchestrator:process-workflow-completed · [node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-completed.ts](../../../../node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-completed.ts) |
| agent_orchestrator | subscriber | event:workflows.instance.failed @workflows | capability-only | — | agent_orchestrator:process-workflow-failed · [node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-failed.ts](../../../../node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-failed.ts) |
| agent_orchestrator | subscriber | event:workflows.instance.milestone_reached @workflows | capability-only | — | agent_orchestrator:process-workflow-milestone · [node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-milestone.ts](../../../../node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-milestone.ts) |
| agent_orchestrator | subscriber | event:workflows.instance.started @workflows | capability-only | — | agent_orchestrator:process-workflow-started · [node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-started.ts](../../../../node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/subscribers/process-workflow-started.ts) |
| agent_orchestrator | data-table | widget-spot:data-table:workflows.tasks.list:row-actions @workflows | bound | widget-spot:data-table:workflows.tasks.list:row-actions:widget-injection-consumer | agent_orchestrator.injection.task-proposal-link@data-table:workflows.tasks.list:row-actions · [node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/widgets/injection-table.ts](../../../../node_modules/@open-mercato/enterprise/src/modules/agent_orchestrator/widgets/injection-table.ts) |
| customers | subscriber | event:workflows.task.assigned @workflows | capability-only | — | customers:link-workflow-task · [node_modules/@open-mercato/core/src/modules/customers/subscribers/link-workflow-task.ts](../../../../node_modules/@open-mercato/core/src/modules/customers/subscribers/link-workflow-task.ts) |

<!-- end module facts section: workflows/incoming-installed-contributions -->
