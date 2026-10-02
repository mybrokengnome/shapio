import { useSchemaSummary } from '@/api/schema';

/**
 * Whether another session activated a newer version of this definition than the one the draft is based
 * on. The summary is polled (there is no push channel), so this shows within a few seconds. Changes this
 * session is applying itself are ignored while they run.
 */
export const useRemoteChangeNotice = (id: string, baseVersion: number, ownChangeRunning: boolean) => {
  const summary = useSchemaSummary();
  const remote = summary.data?.definitions.find((definition) => definition.id === id);
  const changedElsewhere = !ownChangeRunning && remote !== undefined && remote.version > baseVersion;
  return { changedElsewhere, remoteVersion: remote?.version };
};
