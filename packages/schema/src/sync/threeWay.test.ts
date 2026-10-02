import { describe, expect, it } from 'vitest';
import { model } from '../testing/fixtures.js';
import { decideSync, type SyncInput } from './threeWay.js';

const definition = model();
const local = (hash: string) => ({ definition, hash });
const remote = (version: number, hash: string) => ({ definition, version, hash });
const base = (version: number, hash: string) => ({ version, hash });
const decide = (input: Partial<SyncInput>) => decideSync({ prune: false, ...input });

describe('decideSync', () => {
  it('skips a definition unchanged locally, even when the target changed it', () => {
    expect(decide({ local: local('h1'), base: base(1, 'h1'), remote: remote(5, 'h9') })).toEqual({
      action: 'skip',
      reason: 'unchangedLocally',
    });
  });

  it('applies a local change when the target has not moved, guarded by its version', () => {
    expect(decide({ local: local('h2'), base: base(1, 'h1'), remote: remote(1, 'h1') })).toEqual({
      action: 'update',
      expectedVersion: 1,
    });
  });

  it('treats a target that moved and came back to the base content as unchanged', () => {
    expect(decide({ local: local('h2'), base: base(1, 'h1'), remote: remote(3, 'h1') })).toEqual({
      action: 'update',
      expectedVersion: 3,
    });
  });

  it('refuses when both sides changed', () => {
    expect(decide({ local: local('h2'), base: base(1, 'h1'), remote: remote(2, 'h3') })).toEqual({
      action: 'conflict',
      reason: 'changedOnBoth',
    });
  });

  it('skips when both sides made the same change', () => {
    expect(decide({ local: local('h2'), base: base(1, 'h1'), remote: remote(2, 'h2') })).toEqual({
      action: 'skip',
      reason: 'alreadyApplied',
    });
  });

  it('creates a new local definition, and refuses if the target already has a different one', () => {
    expect(decide({ local: local('h1') })).toEqual({ action: 'create' });
    expect(decide({ local: local('h1'), remote: remote(1, 'h1') })).toEqual({
      action: 'skip',
      reason: 'alreadyApplied',
    });
    expect(decide({ local: local('h1'), remote: remote(1, 'h2') })).toEqual({
      action: 'conflict',
      reason: 'existsOnTarget',
    });
  });

  it('refuses a local edit to a definition deleted on the target', () => {
    expect(decide({ local: local('h2'), base: base(1, 'h1') })).toEqual({
      action: 'conflict',
      reason: 'deletedOnTarget',
    });
  });

  it('deletes only with prune, and only when the target has not moved', () => {
    expect(decide({ base: base(1, 'h1'), remote: remote(1, 'h1') })).toEqual({
      action: 'skip',
      reason: 'deletedLocallyWithoutPrune',
    });
    expect(decide({ base: base(1, 'h1'), remote: remote(1, 'h1'), prune: true })).toEqual({
      action: 'delete',
      expectedVersion: 1,
    });
    expect(decide({ base: base(1, 'h1'), remote: remote(2, 'h2'), prune: true })).toEqual({
      action: 'conflict',
      reason: 'changedOnTargetBeforeDelete',
    });
    expect(decide({ base: base(1, 'h1'), prune: true })).toEqual({
      action: 'skip',
      reason: 'alreadyDeleted',
    });
  });

  it('leaves definitions created on the target alone', () => {
    expect(decide({ remote: remote(1, 'h1') })).toEqual({ action: 'skip', reason: 'remoteOnly' });
  });
});
