# channel_resend — Exact override targets

[Back to module index](index.md)

## Exact override targets

| Domain | Path / key | Supported modes | Referenced fact | Source |
|---|---|---|---|---|
| acl | `overrides.acl.features["channel_resend.configure"]` | disable-replace | aclFeatures:channel_resend.configure | [acl.ts](../../../../node_modules/@open-mercato/channel-resend/src/modules/channel_resend/acl.ts) |
| acl | `overrides.acl.features["channel_resend.view"]` | disable-replace | aclFeatures:channel_resend.view | [acl.ts](../../../../node_modules/@open-mercato/channel-resend/src/modules/channel_resend/acl.ts) |
| di | `overrides.di["channelResendAdapter"]` | disable-replace | ownedContracts.di-registration:channelResendAdapter | [di.ts:17](../../../../node_modules/@open-mercato/channel-resend/src/modules/channel_resend/di.ts#L17) |
| di | `overrides.di["channelResendHealthCheck"]` | disable-replace | ownedContracts.di-registration:channelResendHealthCheck | [di.ts:18](../../../../node_modules/@open-mercato/channel-resend/src/modules/channel_resend/di.ts#L18) |
| setup | `overrides.setup.defaultRoleFeatures` | replace | ownedContracts.setup:channel_resend:setup | [setup.ts:18](../../../../node_modules/@open-mercato/channel-resend/src/modules/channel_resend/setup.ts#L18) |
| setup | `overrides.setup.seedDefaults` | replace | ownedContracts.setup:channel_resend:setup | [setup.ts:18](../../../../node_modules/@open-mercato/channel-resend/src/modules/channel_resend/setup.ts#L18) |

<!-- end module facts section: channel_resend/exact-override-targets -->
