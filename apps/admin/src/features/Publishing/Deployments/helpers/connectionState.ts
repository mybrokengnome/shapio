import type { DeploymentConnectionSummary } from '@shapio/client';

/** Deploy now needs an enabled connection whose stored secrets can be read (a run would fail otherwise). */
export const canDeployConnection = ({
  enabled,
  secretsUnreadable,
}: Pick<DeploymentConnectionSummary, 'enabled' | 'secretsUnreadable'>) => enabled && !secretsUnreadable;
