# channel_ses — Exact override targets

[Back to module index](index.md)

## Exact override targets

| Domain | Path / key | Supported modes | Referenced fact | Source |
|---|---|---|---|---|
| acl | `overrides.acl.features["channel_ses.configure"]` | disable-replace | aclFeatures:channel_ses.configure | [acl.ts](../../../../node_modules/@open-mercato/channel-ses/src/modules/channel_ses/acl.ts) |
| acl | `overrides.acl.features["channel_ses.view"]` | disable-replace | aclFeatures:channel_ses.view | [acl.ts](../../../../node_modules/@open-mercato/channel-ses/src/modules/channel_ses/acl.ts) |
| di | `overrides.di["channelSesAdapter"]` | disable-replace | ownedContracts.di-registration:channelSesAdapter | [di.ts:17](../../../../node_modules/@open-mercato/channel-ses/src/modules/channel_ses/di.ts#L17) |
| di | `overrides.di["channelSesHealthCheck"]` | disable-replace | ownedContracts.di-registration:channelSesHealthCheck | [di.ts:18](../../../../node_modules/@open-mercato/channel-ses/src/modules/channel_ses/di.ts#L18) |
| setup | `overrides.setup.defaultRoleFeatures` | replace | ownedContracts.setup:channel_ses:setup | [setup.ts:18](../../../../node_modules/@open-mercato/channel-ses/src/modules/channel_ses/setup.ts#L18) |
| setup | `overrides.setup.seedDefaults` | replace | ownedContracts.setup:channel_ses:setup | [setup.ts:18](../../../../node_modules/@open-mercato/channel-ses/src/modules/channel_ses/setup.ts#L18) |

<!-- end module facts section: channel_ses/exact-override-targets -->
