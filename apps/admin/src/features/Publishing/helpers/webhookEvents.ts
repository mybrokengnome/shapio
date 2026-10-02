import type { WebhookEventType } from '@shapio/client';

export type EventGroup = { group: string; types: string[] };

/** `content.*`: every event of a group, including ones added in later Shapio versions. */
export const groupPattern = (group: string) => `${group}.*`;

/** The catalogue grouped for display, in the server's order. */
export const groupEvents = (events: readonly WebhookEventType[]): EventGroup[] => {
  const groups = new Map<string, string[]>();
  for (const { type, group } of events) {
    groups.set(group, [...(groups.get(group) ?? []), type]);
  }
  return [...groups].map(([group, types]) => ({ group, types }));
};

/** Selecting a whole group replaces its individual types with the pattern (the server would match both). */
export const toggleGroup = (selected: readonly string[], { group, types }: EventGroup, checked: boolean) => {
  const pattern = groupPattern(group);
  const others = selected.filter((value) => value !== pattern && !types.includes(value));
  return checked ? [...others, pattern] : others;
};

export const toggleEvent = (selected: readonly string[], type: string, checked: boolean) =>
  checked
    ? [...selected.filter((value) => value !== type), type]
    : selected.filter((value) => value !== type);
