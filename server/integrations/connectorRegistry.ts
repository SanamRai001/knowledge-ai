import {
  IntegrationConnector,
  IntegrationProvider,
} from './types.js';

export class ConnectorRegistryError extends Error {
  public readonly statusCode = 422;
  public readonly code = 'CONNECTOR_NOT_REGISTERED';

  constructor(provider: IntegrationProvider) {
    super(
      'No integration connector is registered for provider ' +
        provider +
        '.'
    );
    this.name = 'ConnectorRegistryError';
  }
}

export class ConnectorRegistry {
  private connectors = new Map<
    IntegrationProvider,
    IntegrationConnector
  >();

  public register(connector: IntegrationConnector): void {
    this.connectors.set(connector.provider, connector);
  }

  public get(
    provider: IntegrationProvider
  ): IntegrationConnector | null {
    return this.connectors.get(provider) || null;
  }

  public require(
    provider: IntegrationProvider
  ): IntegrationConnector {
    const connector = this.get(provider);
    if (!connector) throw new ConnectorRegistryError(provider);
    return connector;
  }

  public listProviders(): IntegrationProvider[] {
    return Array.from(this.connectors.keys());
  }
}

export const connectorRegistry = new ConnectorRegistry();
