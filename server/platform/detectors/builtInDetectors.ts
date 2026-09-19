import { insightFor, normalizeName, numberValue } from '../../discovery/detectorUtils.js';
import type { InsightSeverity } from '../../discovery/types.js';
import { detectorRegistry } from './detectorRegistry.js';
import type { RegisteredDetector } from './types.js';

function severity(value: unknown): InsightSeverity {
  return value === 'LOW' || value === 'HIGH' ? value : 'MEDIUM';
}

const FIXED_LOW_STOCK: RegisteredDetector = {
  descriptor: {
    id: 'inventory.fixed-low-stock',
    version: '1.0.0',
    name: 'Fixed low-stock threshold',
    description:
      'Flag rows whose configured numeric stock column is at or below a fixed threshold.',
    sourceType: 'DATASET',
    executionMode: 'TRUSTED_BUILT_IN',
    stability: 'STABLE',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['stockColumn', 'threshold'],
      properties: {
        stockColumn: {
          type: 'string',
          description: 'Exact source column containing current stock.',
          minLength: 1,
          maxLength: 160,
        },
        threshold: {
          type: 'number',
          description: 'Trigger when stock is at or below this value.',
          minimum: 0,
          maximum: 1_000_000_000,
        },
        entityColumn: {
          type: 'string',
          description: 'Optional exact source column used to label affected rows.',
          minLength: 1,
          maxLength: 160,
        },
        severity: {
          type: 'string',
          description: 'Deterministic severity assigned to emitted insight.',
          enum: ['LOW', 'MEDIUM', 'HIGH'],
        },
      },
    },
    output: {
      kind: 'INSIGHT',
      supportedTypes: ['RISK'],
      severityModel: 'DETERMINISTIC',
      evidenceRequired: true,
    },
  },
  handler: (context, version, config) => {
    const stockColumnName = String(config.stockColumn);
    const entityColumnName =
      typeof config.entityColumn === 'string'
        ? config.entityColumn
        : undefined;
    const threshold = Number(config.threshold);
    const configuredSeverity = severity(config.severity);
    const insights = [];

    for (const table of version.tables) {
      const stockIndex = table.columns.findIndex(
        (column) =>
          normalizeName(column.name) ===
            normalizeName(stockColumnName) ||
          normalizeName(column.normalizedName || column.name) ===
            normalizeName(stockColumnName)
      );
      if (stockIndex < 0) continue;

      const stockColumn = table.columns[stockIndex];
      if (
        !['INTEGER', 'DECIMAL', 'CURRENCY'].includes(
          stockColumn.inferredType
        )
      ) {
        continue;
      }

      const entityIndex = entityColumnName
        ? table.columns.findIndex(
            (column) =>
              normalizeName(column.name) ===
                normalizeName(entityColumnName) ||
              normalizeName(column.normalizedName || column.name) ===
                normalizeName(entityColumnName)
          )
        : -1;

      const affected: Array<{
        rowIndex: number;
        stock: number;
        entity?: string;
      }> = [];

      table.rows.forEach((row, rowIndex) => {
        const current = numberValue(row[stockIndex] ?? null);
        if (current === null || current > threshold) return;
        affected.push({
          rowIndex,
          stock: current,
          entity:
            entityIndex >= 0 && row[entityIndex] !== null
              ? String(row[entityIndex])
              : undefined,
        });
      });

      if (affected.length === 0) continue;

      insights.push(
        insightFor({
          context,
          version,
          table,
          detectorId: context.detectorId,
          detectorVersion: context.detectorVersion,
          type: 'RISK',
          severity: configuredSeverity,
          title:
            String(affected.length) +
            ' record' +
            (affected.length === 1 ? '' : 's') +
            ' at or below configured stock threshold',
          summary:
            String(affected.length) +
            ' of ' +
            String(table.rowCount) +
            ' records have ' +
            stockColumn.name +
            ' <= ' +
            String(threshold) +
            '.',
          confidence: 1,
          calculation:
            'Select rows where ' +
            stockColumn.name +
            ' <= ' +
            String(threshold) +
            ' using registered detector config hash ' +
            context.configHash +
            '.',
          values: {
            stockColumn: stockColumn.name,
            threshold,
            affectedRecords: affected.length,
            totalRecords: table.rowCount,
            detectorConfigHash: context.configHash,
          },
          rowReferences: affected.slice(0, 50).map((item) => ({
            rowIndex: item.rowIndex,
            values: {
              ...(entityIndex >= 0
                ? {
                    [table.columns[entityIndex].name]:
                      item.entity || null,
                  }
                : {}),
              [stockColumn.name]: item.stock,
            },
          })),
          fingerprintParts: [
            context.configHash,
            stockColumn.name,
            threshold,
            affected.length,
            table.rowCount,
          ],
        })
      );
    }

    return insights.map((insight) => ({
      ...insight,
      evidence: {
        ...insight.evidence,
        detectorConfigHash: context.configHash,
        detectorConfig: {
          ...context.normalizedConfig,
        },
      },
    }));
  },
};

export function registerBuiltInDetectors(): void {
  for (const detector of [FIXED_LOW_STOCK]) {
    if (!detectorRegistry.get(detector.descriptor.id)) {
      detectorRegistry.registerBuiltIn(detector);
    }
  }
}

registerBuiltInDetectors();
