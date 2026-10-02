export type HealthResponse = { status: 'ok' };

export type CheckStatus = 'ok' | 'failing';

export type ReadyResponse = {
  status: 'ready';
  checks: { database: CheckStatus; migrations: CheckStatus };
};

export type VersionResponse = { name: 'shapio'; version: string; node: string };
