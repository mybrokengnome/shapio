import type { SchemaContentPorts, StepImpact } from './contentPorts.js';
import type { ChangePlan } from './plan.js';
import { isIndexStep, stepKey } from './steps.js';

/** What a plan would touch (brief §5 step 5: "show impact"). */
export type PlanImpact = {
  /** Heads (every locale and state) of the affected models. */
  affectedHeads: number;
  steps: Array<{ key: string; kind: string } & StepImpact>;
};

/** Counts affected heads through the content port (package E; zero until content storage exists). */
export const computeImpact = async (plan: ChangePlan, ports: SchemaContentPorts): Promise<PlanImpact> => {
  const affectedHeads = await ports.impact.countHeads(plan.affectedModelIds);
  const steps = await Promise.all(
    plan.prerequisites.map(async (step) => ({
      key: stepKey(step),
      kind: step.kind,
      ...(isIndexStep(step) ? { affectedHeads } : await ports.impact.assess(step)),
    })),
  );
  return { affectedHeads, steps };
};
