import type { FastifyBaseLogger } from 'fastify';
import type { Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import type { SeqAllocator } from '../../repositories/publications.js';
import type { ContentStep, FollowUpStep } from './steps.js';

/**
 * What the activation transaction offers the content rewrite: one publication sequence number per affected
 * site (sites plan §H, ADR 0010 amendment: one snapshot per affected site), each taken late, on first use,
 * under the schema lock, and a way to defer work until a site's number is known (rolling the publication log
 * of converted published heads after every rewrite, so the number's row lock is held as briefly as possible).
 * A site whose content does not change takes no number.
 */
export type ActivationContext = {
  /** The origin site's number: the shipping change set's site (the primary site without a change set). */
  seq: SeqAllocator;
  /** The number of one site, for content converted on it. */
  seqFor: (siteId: string) => SeqAllocator;
  /** Runs `work` with the site's sequence number, after every item's rewrite, before commit. */
  atSeq: (siteId: string, work: (seq: number) => Promise<void>) => void;
};

/**
 * The planner's view of content. Content storage belongs to package E, so the planner talks to it through
 * these ports. Until E lands, the defaults report "no content", which is exactly true: no entries exist.
 */

export type StepOutcome =
  | { ok: true; watermark?: unknown }
  | {
      ok: false;
      /** Key (`stepKey`) of the step the content fails. */
      step?: string;
      reason: string;
      invalidCount?: number;
      sampleEntryIds?: string[];
    };

export type ContentStepContext = {
  signal: AbortSignal;
  /** Progress from an earlier attempt of this step, or null. */
  checkpoint: unknown;
  saveCheckpoint: (checkpoint: unknown) => Promise<boolean>;
  log: FastifyBaseLogger;
};

/**
 * A change's content steps (every prerequisite but index builds, in plan order) go through three stages
 * (ADR 0002 pipeline): a dry run, the activation-time apply, and, if the change fails, a discard.
 */
export type ContentMigrationPort = {
  /**
   * Dry run up to a watermark (resumable through the checkpoint): converts and backfills content in memory
   * and checks it against the proposed schema, without writing content. Writes continue meanwhile under
   * the old revision; whatever they change after the watermark is re-checked at activation.
   */
  run: (steps: readonly ContentStep[], context: ContentStepContext) => Promise<StepOutcome>;
  /**
   * Inside the activation transaction, holding the exclusive model locks: re-checks the content changed
   * since `watermark` (the transitional write policy's final delta scan), then writes converted and
   * backfilled values. A failure aborts the activation and rolls every write back.
   */
  apply: (
    steps: readonly ContentStep[],
    watermark: unknown,
    trx: Transaction<DB>,
    activation: ActivationContext,
  ) => Promise<StepOutcome>;
  /** After the change failed for good: releases what the dry run staged (unique-registry claims). Idempotent. */
  discard: (steps: readonly ContentStep[]) => Promise<void>;
  /** Post-activation work that touches content (e.g. dropping unique-registry rows). Idempotent. */
  runFollowUp: (step: FollowUpStep, log: FastifyBaseLogger) => Promise<void>;
};

export type StepImpact = { affectedHeads: number; invalidHeads?: number };

export type ContentImpactSource = {
  /** Heads (every locale and state) of these models. */
  countHeads: (modelIds: readonly string[]) => Promise<number>;
  /** How many heads a step would touch and, where cheap to know, how many would fail it. */
  assess: (step: ContentStep) => Promise<StepImpact>;
  /** Heads stored in one locale (impact of deleting it). */
  countLocaleHeads: (code: string) => Promise<number>;
};

export type SchemaContentPorts = { migration: ContentMigrationPort; impact: ContentImpactSource };

/** Ports for an instance without content storage: every step trivially succeeds over zero heads. */
export const NO_CONTENT_PORTS: SchemaContentPorts = {
  migration: {
    run: async () => ({ ok: true, watermark: null }),
    apply: async () => ({ ok: true }),
    discard: async () => undefined,
    runFollowUp: async () => undefined,
  },
  impact: {
    countHeads: async () => 0,
    assess: async () => ({ affectedHeads: 0, invalidHeads: 0 }),
    countLocaleHeads: async () => 0,
  },
};
