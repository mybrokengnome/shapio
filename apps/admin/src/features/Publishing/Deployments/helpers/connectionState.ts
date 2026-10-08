import type { DeploymentConnection } from '@shapio/client';

/** Deploy now needs an enabled connection whose stored secrets can be read (a run would fail otherwise). */
export const canDeployConnection = ({
  enabled,
  secretsUnreadable,
}: Pick<DeploymentConnection, 'enabled' | 'secretsUnreadable'>) => enabled && !secretsUnreadable;
