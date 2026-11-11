/**
 * Aligns the items of a written list with the stored ones by what the caller sees of each (its key), the way a
 * diff does, and says whether that alignment is certain (plan item-ids, "never guess"):
 *
 * 1. A list sent exactly as stored (same keys, same order) continues item by item.
 * 2. A key found exactly once in the sent list and once in the stored list pairs those two items, wherever
 *    they stand (unchanged items, and moves of unique items).
 * 3. The longest run of those pairs in stored order stays in place; it splits both lists into gaps, and each gap
 *    is aligned on its own with the least edits: a match costs nothing, an edit in place (the same component)
 *    costs 4, an insert or a delete 3 each. So one edit in place beats a delete and an insert, and a delete and
 *    an insert beat two edits.
 * 4. The alignment is certain when every sent item has exactly one option (a stored item, or new) over every
 *    least-cost alignment of its gap. Otherwise it is ambiguous; the first least-cost alignment is returned.
 *
 * Bounded: steps 1 to 3 are O(n log n); step 4 fills at most `ALIGNMENT_CELL_BUDGET` cells over all gaps, and a
 * gap that would need more is ambiguous, aligned in place.
 */

/** The most cells the gap alignments of one list may fill (two tables of this many 32-bit costs at most). */
export const ALIGNMENT_CELL_BUDGET = 2_000_000;

const MATCH = 0;
const EDIT = 4;
const INDEL = 3;
/** No such step (an edit into another component). Costs stay far below it: at most 4 per item. */
const NONE = 2 ** 30;

export type AlignmentSide = {
  /** What the caller sees of each item; null: never matched by content. */
  keys: ReadonlyArray<string | null>;
  /** The component each item holds; an item is edited in place only into the same component. */
  kinds: ReadonlyArray<string | null>;
};

export type Alignment = {
  /** Per sent item, the stored item it continues, or -1 for a new item. */
  pairs: number[];
  /** Some sent item has more than one option. */
  ambiguous: boolean;
};

const sameSequence = (sent: AlignmentSide, stored: AlignmentSide) =>
  sent.keys.length === stored.keys.length &&
  sent.keys.every((key, index) => key !== null && key === stored.keys[index]);

/** Keys found exactly once on each side: their two positions. */
const uniquePairs = (sent: AlignmentSide, stored: AlignmentSide): Array<[number, number]> => {
  const count = (keys: ReadonlyArray<string | null>) => {
    const positions = new Map<string, number>();
    const twice = new Set<string>();
    keys.forEach((key, index) => {
      if (key === null) {
        return;
      }
      if (positions.has(key)) {
        twice.add(key);
      } else {
        positions.set(key, index);
      }
    });
    twice.forEach((key) => positions.delete(key));
    return positions;
  };
  const once = count(stored.keys);
  const pairs: Array<[number, number]> = [];
  count(sent.keys).forEach((sentAt, key) => {
    const storedAt = once.get(key);
    if (storedAt !== undefined) {
      pairs.push([sentAt, storedAt]);
    }
  });
  return pairs.sort((left, right) => left[0] - right[0]);
};

/** The longest run of pairs increasing in both positions (pairs sorted by sent position): patience sorting. */
const longestRun = (pairs: ReadonlyArray<[number, number]>): Array<[number, number]> => {
  const tails: number[] = [];
  const previous: number[] = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([, storedAt], index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((pairs[tails[middle] as number] as [number, number])[1] < storedAt) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    previous[index] = low > 0 ? (tails[low - 1] as number) : -1;
    tails[low] = index;
  });
  const run: Array<[number, number]> = [];
  for (
    let at = tails.length > 0 ? (tails[tails.length - 1] as number) : -1;
    at !== -1;
    at = previous[at] as number
  ) {
    run.push(pairs[at] as [number, number]);
  }
  return run.reverse();
};

type Gap = { sent: number[]; stored: number[] };

/**
 * One gap aligned with the least edits; whether any of its sent items has more than one option. With
 * `exactOnly`, items pair only when equal (no edit in place), and a gap left with both sent and stored items
 * is ambiguous too: which new item continues which stored one cannot be told.
 */
const alignGap = (
  gap: Gap,
  sent: AlignmentSide,
  stored: AlignmentSide,
  pairs: number[],
  budget: { cells: number },
  exactOnly: boolean,
): boolean => {
  const s = gap.sent.length;
  const t = gap.stored.length;
  if (s === 0 || t === 0) {
    gap.sent.forEach((sentAt) => {
      pairs[sentAt] = -1;
    });
    return false;
  }
  const cells = (s + 1) * (t + 1);
  if (cells > budget.cells) {
    // Too large to weigh: edits in place where the components agree, the rest new. Never certain.
    gap.sent.forEach((sentAt, index) => {
      const storedAt = gap.stored[index];
      pairs[sentAt] =
        storedAt !== undefined && sent.kinds[sentAt] !== null && sent.kinds[sentAt] === stored.kinds[storedAt]
          ? storedAt
          : -1;
    });
    budget.cells = 0;
    return true;
  }
  budget.cells -= cells;
  const width = t + 1;
  const cost = (i: number, j: number): number => {
    const sentAt = gap.sent[i] as number;
    const storedAt = gap.stored[j] as number;
    const key = sent.keys[sentAt];
    if (key !== null && key !== undefined && key === stored.keys[storedAt]) {
      return MATCH;
    }
    const kind = sent.kinds[sentAt];
    return !exactOnly && kind !== null && kind !== undefined && kind === stored.kinds[storedAt] ? EDIT : NONE;
  };
  const forward = new Int32Array(cells);
  const backward = new Int32Array(cells);
  for (let i = 0; i <= s; i += 1) {
    for (let j = 0; j <= t; j += 1) {
      if (i === 0 && j === 0) {
        continue;
      }
      let best = NONE;
      if (i > 0) {
        best = Math.min(best, (forward[(i - 1) * width + j] as number) + INDEL);
      }
      if (j > 0) {
        best = Math.min(best, (forward[i * width + j - 1] as number) + INDEL);
      }
      if (i > 0 && j > 0) {
        const step = cost(i - 1, j - 1);
        if (step !== NONE) {
          best = Math.min(best, (forward[(i - 1) * width + j - 1] as number) + step);
        }
      }
      forward[i * width + j] = best;
    }
  }
  for (let i = s; i >= 0; i -= 1) {
    for (let j = t; j >= 0; j -= 1) {
      if (i === s && j === t) {
        continue;
      }
      let best = NONE;
      if (i < s) {
        best = Math.min(best, (backward[(i + 1) * width + j] as number) + INDEL);
      }
      if (j < t) {
        best = Math.min(best, (backward[i * width + j + 1] as number) + INDEL);
      }
      if (i < s && j < t) {
        const step = cost(i, j);
        if (step !== NONE) {
          best = Math.min(best, (backward[(i + 1) * width + j + 1] as number) + step);
        }
      }
      backward[i * width + j] = best;
    }
  }
  const optimum = forward[s * width + t] as number;
  // Every option each sent item has over the least-cost alignments: a stored item, or new.
  let ambiguous = false;
  for (let i = 0; i < s && !ambiguous; i += 1) {
    let options = 0;
    let asNew = false;
    for (let j = 0; j <= t && options < 2; j += 1) {
      const before = forward[i * width + j] as number;
      if (j < t) {
        const step = cost(i, j);
        if (step !== NONE && before + step + (backward[(i + 1) * width + j + 1] as number) === optimum) {
          options += 1;
        }
      }
      if (!asNew && before + INDEL + (backward[(i + 1) * width + j] as number) === optimum) {
        asNew = true;
        options += 1;
      }
    }
    ambiguous = options > 1;
  }
  // The first least-cost alignment: in place or matched first, then new, then deleted.
  let i = 0;
  let j = 0;
  while (i < s) {
    const here = backward[i * width + j] as number;
    const step = j < t ? cost(i, j) : NONE;
    if (step !== NONE && step + (backward[(i + 1) * width + j + 1] as number) === here) {
      pairs[gap.sent[i] as number] = gap.stored[j] as number;
      i += 1;
      j += 1;
    } else if (INDEL + (backward[(i + 1) * width + j] as number) === here) {
      pairs[gap.sent[i] as number] = -1;
      i += 1;
    } else {
      j += 1;
    }
  }
  if (exactOnly) {
    const matched = new Set(gap.sent.map((sentAt) => pairs[sentAt]));
    const newItems = gap.sent.some((sentAt) => pairs[sentAt] === -1);
    const deleted = gap.stored.some((storedAt) => !matched.has(storedAt));
    return ambiguous || (newItems && deleted);
  }
  return ambiguous;
};

/** Whether the sent list holds exactly the stored items' keys, rearranged (a pure reorder). */
const isRearrangement = (sent: AlignmentSide, stored: AlignmentSide): boolean => {
  if (sent.keys.length !== stored.keys.length || sent.keys.some((key) => key === null)) {
    return false;
  }
  const counts = new Map<string, number>();
  stored.keys.forEach((key) => {
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  return sent.keys.every((key) => {
    const left = counts.get(key as string) ?? 0;
    counts.set(key as string, left - 1);
    return left > 0;
  });
};

/**
 * A pure edit in place: the same length, every item the same component as the stored item at its place, and
 * no stored item that changed at its place shows up again elsewhere in what was sent (it could have moved
 * there: then which item continues which cannot be told).
 */
const isInPlace = (sent: AlignmentSide, stored: AlignmentSide): boolean => {
  if (
    sent.kinds.length !== stored.kinds.length ||
    !sent.kinds.every((kind, index) => kind !== null && kind === stored.kinds[index])
  ) {
    return false;
  }
  const sentKeys = new Map<string, number>();
  sent.keys.forEach((key) => {
    if (key !== null) {
      sentKeys.set(key, (sentKeys.get(key) ?? 0) + 1);
    }
  });
  return stored.keys.every((key, index) => {
    if (key === null || key === sent.keys[index]) {
      return true;
    }
    // Changed here: its old content must not be sent at another place.
    return !sentKeys.has(key);
  });
};

/** Unique pairs, then each gap between the ones that stay in order (see above). */
const alignAround = (sent: AlignmentSide, stored: AlignmentSide, exactOnly: boolean): Alignment => {
  const pairs = new Array<number>(sent.keys.length).fill(-1);
  const unique = uniquePairs(sent, stored);
  const fixed = longestRun(unique);
  const pairedSent = new Set<number>();
  const pairedStored = new Set<number>();
  for (const [sentAt, storedAt] of unique) {
    pairs[sentAt] = storedAt;
    pairedSent.add(sentAt);
    pairedStored.add(storedAt);
  }
  const budget = { cells: ALIGNMENT_CELL_BUDGET };
  let ambiguous = false;
  let sentFrom = 0;
  let storedFrom = 0;
  for (const [sentAt, storedAt] of [...fixed, [sent.keys.length, stored.keys.length] as [number, number]]) {
    const gap: Gap = { sent: [], stored: [] };
    for (let index = sentFrom; index < sentAt; index += 1) {
      if (!pairedSent.has(index)) {
        gap.sent.push(index);
      }
    }
    for (let index = storedFrom; index < storedAt; index += 1) {
      if (!pairedStored.has(index)) {
        gap.stored.push(index);
      }
    }
    ambiguous = alignGap(gap, sent, stored, pairs, budget, exactOnly) || ambiguous;
    sentFrom = sentAt + 1;
    storedFrom = storedAt + 1;
  }
  return { pairs, ambiguous };
};

/**
 * The alignment of a sent list with a stored one, for a list whose items cannot hold values the caller cannot
 * see: the least edits (see above), never refused for it.
 */
export const alignItems = (sent: AlignmentSide, stored: AlignmentSide): Alignment =>
  sameSequence(sent, stored)
    ? { pairs: sent.keys.map((_, index) => index), ambiguous: false }
    : alignAround(sent, stored, false);

/**
 * The alignment for a list whose items can hold values the caller cannot see (plan item-ids, never guess): an
 * item continues a stored item it does not equal only in a pure edit in place, where the list kept its length,
 * every item stands where it stood (the same component at every place), no changed item's old content was sent
 * at another place, and the list is no rearrangement of the stored items. Anything else pairs equal items only (unique ones wherever they moved, duplicates in order
 * between them); a gap left with both new and stored items, or with more than one way to pair, is ambiguous.
 * A rearrangement is a reorder, never an edit of every item into another's content.
 */
export const alignItemsStrictly = (sent: AlignmentSide, stored: AlignmentSide): Alignment => {
  if (sameSequence(sent, stored)) {
    return { pairs: sent.keys.map((_, index) => index), ambiguous: false };
  }
  if (!isRearrangement(sent, stored) && isInPlace(sent, stored)) {
    return { pairs: sent.keys.map((_, index) => index), ambiguous: false };
  }
  return alignAround(sent, stored, true);
};
