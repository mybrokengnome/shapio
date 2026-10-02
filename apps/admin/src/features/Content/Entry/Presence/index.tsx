import type { PresencePerson } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/UserAvatar';

type PresenceProps = { people: readonly PresencePerson[] };

const SHOWN = 3;

/** Who else has this entry open right now: overlapping initials, names in the tooltip and for readers. */
export const Presence = ({ people }: PresenceProps) => {
  const { t } = useTranslation();
  if (people.length === 0) {
    return null;
  }
  const names = [
    ...new Set(people.map((person) => (person.you ? t('entry.presence.youElsewhere') : person.name))),
  ];
  const label = t('entry.presence.label', { names: names.join(', ') });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} className="flex items-center" data-presence>
          {people.slice(0, SHOWN).map((person) => (
            <UserAvatar
              key={`${person.userId}-${person.since}`}
              name={person.name}
              size="sm"
              className="-ml-1.5 ring-2 ring-background first:ml-0"
            />
          ))}
          {people.length > SHOWN ? (
            <span className="ml-1 text-meta text-muted-foreground">+{people.length - SHOWN}</span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
