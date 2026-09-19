import { domainPackRegistry } from './domainPackRegistry.js';
import type { DomainPackDescriptor } from './types.js';

const INVENTORY_OPERATIONS_PACK: DomainPackDescriptor = {
  id: 'inventory.operations',
  version: '1.0.0',
  name: 'Inventory Operations',
  description:
    'Reusable inventory vocabulary, low-stock analysis, monitoring suggestions, and proposal-only receiving workflows.',
  category: 'OPERATIONS',
  executionMode: 'DECLARATIVE',
  stability: 'STABLE',
  entityVocabulary: [
    {
      entityType: 'PRODUCT',
      label: 'Product',
      pluralLabel: 'Products',
      description:
        'Stocked item whose quantity and reorder state may be monitored.',
    },
    {
      entityType: 'SUPPLIER',
      label: 'Supplier',
      pluralLabel: 'Suppliers',
      description:
        'Organization or person supplying inventory.',
    },
  ],
  detectorTemplates: [
    {
      id: 'low-stock',
      name: 'Low stock',
      description:
        'Run the registered fixed low-stock detector with inventory-friendly defaults.',
      detectorId: 'inventory.fixed-low-stock',
      detectorVersion: '1.0.0',
      defaultConfig: {
        stockColumn: 'current_stock',
        entityColumn: 'product_name',
        threshold: 5,
        severity: 'MEDIUM',
      },
      overridableConfigFields: [
        'stockColumn',
        'entityColumn',
        'threshold',
        'severity',
      ],
    },
  ],
  watchTemplates: [
    {
      id: 'product-stock-watch',
      name: 'Product stock threshold',
      description:
        'Suggested per-product Watch rule for current stock.',
      activation: 'SUGGESTION_ONLY',
      entityType: 'PRODUCT',
      predicate: 'CURRENT_STOCK',
      operator: 'LTE',
      defaultThreshold: 5,
      evaluationMode: 'INTERVAL',
      intervalMinutes: 60,
    },
  ],
  actionTemplates: [
    {
      id: 'receive-inventory',
      name: 'Receive inventory',
      description:
        'Proposal-only wording template for the existing safe inventory receipt action path.',
      intent: 'RECEIVE_INVENTORY',
      mode: 'PROPOSAL_ONLY',
      instructionTemplate:
        'Received {{quantity}} {{productReference}} today.',
      requiredFields: ['quantity', 'productReference'],
    },
  ],
  ui: {
    iconKey: 'package',
    shortLabel: 'Inventory',
    keywords: [
      'inventory',
      'stock',
      'reorder',
      'products',
      'receiving',
    ],
  },
};

export function registerBuiltInDomainPacks(): void {
  for (const pack of [INVENTORY_OPERATIONS_PACK]) {
    if (!domainPackRegistry.get(pack.id)) {
      domainPackRegistry.registerBuiltIn(pack);
    }
  }
}

registerBuiltInDomainPacks();
