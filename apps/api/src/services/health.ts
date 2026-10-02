import { SHAPIO_VERSION } from '../constants/version.js';
import * as systemHealthRepository from '../repositories/systemHealth.js';

export type CheckStatus = 'ok' | 'failing';

export type Readiness = {
  ready: boolean;
  checks: { database: CheckStatus; migrations: CheckStatus };
  pendingMigrations: string[];
};

/** Ready = the database answers and every migration this build knows about has run. */
export const checkReadiness = async (): Promise<Readiness> => {
  try {
    await systemHealthRepository.ping();
  } catch {
    return { ready: false, checks: { database: 'failing', migrations: 'failing' }, pendingMigrations: [] };
  }
  const pendingMigrations = await systemHealthRepository.listPendingMigrations();
  const migrations: CheckStatus = pendingMigrations.length === 0 ? 'ok' : 'failing';
  return { ready: migrations === 'ok', checks: { database: 'ok', migrations }, pendingMigrations };
};

export const getVersionInfo = () => ({
  name: 'shapio' as const,
  version: SHAPIO_VERSION,
  node: process.version,
});
