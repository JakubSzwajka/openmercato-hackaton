# phone_calls — Exact override targets

[Back to module index](index.md)

## Exact override targets

| Domain | Path / key | Supported modes | Referenced fact | Source |
|---|---|---|---|---|
| acl | `overrides.acl.features["phone_calls.manage"]` | disable-replace | aclFeatures:phone_calls.manage | [acl.ts](../../../../node_modules/@open-mercato/core/src/modules/phone_calls/acl.ts) |
| acl | `overrides.acl.features["phone_calls.view"]` | disable-replace | aclFeatures:phone_calls.view | [acl.ts](../../../../node_modules/@open-mercato/core/src/modules/phone_calls/acl.ts) |
| di | `overrides.di["PhoneCall"]` | disable-replace | ownedContracts.di-registration:PhoneCall | [di.ts:7](../../../../node_modules/@open-mercato/core/src/modules/phone_calls/di.ts#L7) |
| di | `overrides.di["PhoneCallParticipant"]` | disable-replace | ownedContracts.di-registration:PhoneCallParticipant | [di.ts:8](../../../../node_modules/@open-mercato/core/src/modules/phone_calls/di.ts#L8) |
| encryption | `overrides.encryption.maps["phone_calls:phone_call"]` | disable-replace | ownedContracts.encryption:phone_calls:phone_call | [encryption.ts:4](../../../../node_modules/@open-mercato/core/src/modules/phone_calls/encryption.ts#L4) |
| encryption | `overrides.encryption.maps["phone_calls:phone_call_participant"]` | disable-replace | ownedContracts.encryption:phone_calls:phone_call_participant | [encryption.ts:16](../../../../node_modules/@open-mercato/core/src/modules/phone_calls/encryption.ts#L16) |
| routes | `overrides.routes.pages["backend:/backend/phone_calls"]` | disable-replace | backendPages:/backend/phone_calls | [backend/page.tsx](../../../../node_modules/@open-mercato/core/src/modules/phone_calls/backend/page.tsx) |
| setup | `overrides.setup.defaultRoleFeatures` | replace | ownedContracts.setup:phone_calls:setup | [setup.ts:3](../../../../node_modules/@open-mercato/core/src/modules/phone_calls/setup.ts#L3) |

<!-- end module facts section: phone_calls/exact-override-targets -->
