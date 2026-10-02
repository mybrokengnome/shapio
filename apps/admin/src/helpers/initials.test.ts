import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['Grace Brewster Hopper', 'GH'],
    ['ada@example.com', 'A'],
    ['jean-luc.picard@example.com', 'JP'],
    ['', '?'],
  ])('%s → %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
