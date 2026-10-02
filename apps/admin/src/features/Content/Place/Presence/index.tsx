import type { PresencePerson } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar';
import { UserAvatar } from '@/components/UserAvatar';
import { MAX_ROW_PRESENCE } from '../constants';

type PresenceProps = { people: readonly PresencePerson[] };

/** Small avatars of the people editing an entry right now (information only; nothing is locked). */
export const Presence = ({ people }: PresenceProps) => {
  const { t } = useTranslation();
  if (people.length === 0) {
    return null;
  }
  const names = [...new Set(people.map((person) => person.name))];
  const label = t('place.presence.editing', { names: names.join(', '), count: names.length });
  const shown = names.slice(0, MAX_ROW_PRESENCE);
  return (
    <span className="inline-flex shrink-0 items-center" title={label}>
      <AvatarGroup aria-hidden="true">
        {shown.map((name) => (
          <UserAvatar key={name} name={name} size="sm" />
        ))}
        {names.length > shown.length ? (
          <AvatarGroupCount className="text-2xs">+{names.length - shown.length}</AvatarGroupCount>
        ) : null}
      </AvatarGroup>
      <span className="sr-only">{label}</span>
    </span>
  );
};
