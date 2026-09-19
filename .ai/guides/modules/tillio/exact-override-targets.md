# tillio — Exact override targets

[Back to module index](index.md)

## Exact override targets

| Domain | Path / key | Supported modes | Referenced fact | Source |
|---|---|---|---|---|
| acl | `overrides.acl.features["tillio.manage"]` | disable-replace | aclFeatures:tillio.manage | [acl.ts](../../../../node_modules/@open-mercato/tillio/src/modules/tillio/acl.ts) |
| cli | `overrides.cli["configure-from-env"]` | disable-replace | cliCommands:configure-from-env | [cli.ts](../../../../node_modules/@open-mercato/tillio/src/modules/tillio/cli.ts) |
| di | `overrides.di["tillioEnvironmentHealthCheck"]` | disable-replace | ownedContracts.di-registration:tillioEnvironmentHealthCheck | [di.ts:11](../../../../node_modules/@open-mercato/tillio/src/modules/tillio/di.ts#L11) |
| setup | `overrides.setup.defaultRoleFeatures` | replace | ownedContracts.setup:tillio:setup | [setup.ts:10](../../../../node_modules/@open-mercato/tillio/src/modules/tillio/setup.ts#L10) |
| setup | `overrides.setup.seedDefaults` | replace | ownedContracts.setup:tillio:setup | [setup.ts:10](../../../../node_modules/@open-mercato/tillio/src/modules/tillio/setup.ts#L10) |
| widgets | `overrides.widgets.injection["tillio.injection.pull-calls"]` | disable-replace | extensionSurfaces.contributions:tillio.injection.pull-calls@data-table:phone_calls.calls:toolbar | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/tillio/src/modules/tillio/widgets/injection-table.ts) |
| workers | `overrides.workers["tillio:pull-calls"]` | disable-replace | ownedContracts.worker:tillio:pull-calls | [workers/tillio-pull.ts:6](../../../../node_modules/@open-mercato/tillio/src/modules/tillio/workers/tillio-pull.ts#L6) |

<!-- end module facts section: tillio/exact-override-targets -->
