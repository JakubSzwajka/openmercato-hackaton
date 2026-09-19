# documents — Exact override targets

[Back to module index](index.md)

## Exact override targets

| Domain | Path / key | Supported modes | Referenced fact | Source |
|---|---|---|---|---|
| acl | `overrides.acl.features["documents.create"]` | disable-replace | aclFeatures:documents.create | [acl.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/acl.ts) |
| acl | `overrides.acl.features["documents.delete"]` | disable-replace | aclFeatures:documents.delete | [acl.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/acl.ts) |
| acl | `overrides.acl.features["documents.edit"]` | disable-replace | aclFeatures:documents.edit | [acl.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/acl.ts) |
| acl | `overrides.acl.features["documents.manage"]` | disable-replace | aclFeatures:documents.manage | [acl.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/acl.ts) |
| acl | `overrides.acl.features["documents.share"]` | disable-replace | aclFeatures:documents.share | [acl.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/acl.ts) |
| acl | `overrides.acl.features["documents.templates.manage"]` | disable-replace | aclFeatures:documents.templates.manage | [acl.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/acl.ts) |
| acl | `overrides.acl.features["documents.view"]` | disable-replace | aclFeatures:documents.view | [acl.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/acl.ts) |
| di | `overrides.di["Document"]` | disable-replace | ownedContracts.di-registration:Document | [di.ts:19](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L19) |
| di | `overrides.di["DocumentAttachment"]` | disable-replace | ownedContracts.di-registration:DocumentAttachment | [di.ts:20](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L20) |
| di | `overrides.di["DocumentComment"]` | disable-replace | ownedContracts.di-registration:DocumentComment | [di.ts:21](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L21) |
| di | `overrides.di["DocumentContent"]` | disable-replace | ownedContracts.di-registration:DocumentContent | [di.ts:22](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L22) |
| di | `overrides.di["DocumentEntityLink"]` | disable-replace | ownedContracts.di-registration:DocumentEntityLink | [di.ts:24](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L24) |
| di | `overrides.di["DocumentFavorite"]` | disable-replace | ownedContracts.di-registration:DocumentFavorite | [di.ts:25](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L25) |
| di | `overrides.di["DocumentFolder"]` | disable-replace | ownedContracts.di-registration:DocumentFolder | [di.ts:23](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L23) |
| di | `overrides.di["DocumentShare"]` | disable-replace | ownedContracts.di-registration:DocumentShare | [di.ts:26](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L26) |
| di | `overrides.di["DocumentTemplate"]` | disable-replace | ownedContracts.di-registration:DocumentTemplate | [di.ts:27](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L27) |
| di | `overrides.di["DocumentVersion"]` | disable-replace | ownedContracts.di-registration:DocumentVersion | [di.ts:28](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L28) |
| di | `overrides.di["DocumentWatcher"]` | disable-replace | ownedContracts.di-registration:DocumentWatcher | [di.ts:29](../../../../node_modules/@open-mercato/documents/src/modules/documents/di.ts#L29) |
| encryption | `overrides.encryption.maps["documents:document_entity_link"]` | disable-replace | ownedContracts.encryption:documents:document_entity_link | [encryption.ts:8](../../../../node_modules/@open-mercato/documents/src/modules/documents/encryption.ts#L8) |
| notifications | `overrides.notifications.types["documents.comment.mentioned"]` | disable-replace | notifications:documents.comment.mentioned | [notifications.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/notifications.ts) |
| notifications | `overrides.notifications.types["documents.watch.changed"]` | disable-replace | notifications:documents.watch.changed | [notifications.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/notifications.ts) |
| notifications | `overrides.notifications.types["documents.watch.commented"]` | disable-replace | notifications:documents.watch.commented | [notifications.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/notifications.ts) |
| routes | `overrides.routes.pages["backend:/backend/documents"]` | disable-replace | backendPages:/backend/documents | [backend/documents/page.tsx](../../../../node_modules/@open-mercato/documents/src/modules/documents/backend/documents/page.tsx) |
| routes | `overrides.routes.pages["backend:/backend/documents/[id]"]` | disable-replace | backendPages:/backend/documents/[id] | [backend/documents/[id]/page.tsx](../../../../node_modules/@open-mercato/documents/src/modules/documents/backend/documents/[id]/page.tsx) |
| routes | `overrides.routes.pages["backend:/backend/documents/templates"]` | disable-replace | backendPages:/backend/documents/templates | [backend/documents/templates/page.tsx](../../../../node_modules/@open-mercato/documents/src/modules/documents/backend/documents/templates/page.tsx) |
| setup | `overrides.setup.defaultRoleFeatures` | replace | ownedContracts.setup:documents:setup | [setup.ts:4](../../../../node_modules/@open-mercato/documents/src/modules/documents/setup.ts#L4) |
| setup | `overrides.setup.onTenantCreated` | replace | ownedContracts.setup:documents:setup | [setup.ts:4](../../../../node_modules/@open-mercato/documents/src/modules/documents/setup.ts#L4) |
| setup | `overrides.setup.seedDefaults` | replace | ownedContracts.setup:documents:setup | [setup.ts:4](../../../../node_modules/@open-mercato/documents/src/modules/documents/setup.ts#L4) |
| widgets | `overrides.widgets.injection["documents.injection.related-documents"]` | disable-replace | extensionSurfaces.contributions:documents.injection.related-documents@customers.company.detail:details | [widgets/injection-table.ts](../../../../node_modules/@open-mercato/documents/src/modules/documents/widgets/injection-table.ts) |

<!-- end module facts section: documents/exact-override-targets -->
