import type { ServiceFactoryContext } from 'shapio/config';

export type ModelCount = { model: string; entries: number };

export type StatsService = { counts: () => Promise<ModelCount[]> };

/** Entry counts per model, read through Shapio's content service. */
export const createStatsService = ({ services }: ServiceFactoryContext): StatsService => ({
  counts: async () => {
    const models = await services.content.models();
    return Promise.all(
      models.map(async (model) => ({
        model: model.apiKey,
        entries: await services.content.count(model.apiKey),
      })),
    );
  },
});
