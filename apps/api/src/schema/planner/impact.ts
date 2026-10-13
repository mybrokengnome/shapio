import type { SchemaContentPorts, StepImpact } from './contentPorts.js';
import type { ChangePlan } from './plan.js';
import { isIndexStep, stepKey, type ContentStep } from './steps.js';

/** What a plan would touch (brief §5 step 5: "show impact"). */
export type PlanImpact = {
  /** Heads (every locale and state) of the affected models. */
  affectedHeads: number;
  steps: Array<{ key: string; kind: string } & StepImpact>;
};

/** Counts affected heads through the content port (package E; zero until content storage exists). */
export const computeImpact = async (plan: ChangePlan, ports: SchemaContentPorts): Promise<PlanImpact> => {
  const affectedHeads = await ports.impact.countHeads(plan.affectedModelIds);
  const contentSteps = plan.prerequisites.filter((step): step is ContentStep => !isIndexStep(step));
  // An index is per model: a family's change builds one per member, each over that member's heads only.
  const headsByModel = new Map<string, Promise<number>>();
  const headsOf = (modelId: string) => {
    let count = headsByModel.get(modelId);
    if (!count) {
      count = ports.impact.countHeads([modelId]);
      headsByModel.set(modelId, count);
    }
    return count;
  };
  const steps = await Promise.all(
    plan.prerequisites.map(async (step) => ({
      key: stepKey(step),
      kind: step.kind,
      ...(isIndexStep(step)
        ? { affectedHeads: await headsOf(step.modelId) }
        : await ports.impact.assess(step, contentSteps)),
    })),
  );
  return { affectedHeads, steps };
};
