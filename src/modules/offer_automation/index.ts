import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'offer_automation',
  title: 'Offer Automation',
  version: '0.1.0',
  description:
    'Proves the app-owned inbox-action discovery convention: registers a custom `draft_offer` action that the inbox_ops execution engine runs when a human accepts it.',
  author: 'Open Mercato Hackathon',
  license: 'MIT',
}
