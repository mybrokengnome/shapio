import { useTranslation } from 'react-i18next';

const ACTOR_TYPE_KEYS = {
  admin: 'develop.actors.admin',
  token: 'develop.actors.token',
  system: 'develop.actors.system',
} as const;

const isKnownType = (type: string): type is keyof typeof ACTOR_TYPE_KEYS => type in ACTOR_TYPE_KEYS;

/** Who did something: the admin's or token's name, else what kind of actor it was. */
export const useActorLabel = () => {
  const { t } = useTranslation();
  return (actor: { type: string; name?: string | null } | null): string => {
    if (!actor) {
      return t('develop.actors.system');
    }
    if (actor.name) {
      return actor.name;
    }
    return isKnownType(actor.type) ? t(ACTOR_TYPE_KEYS[actor.type]) : actor.type;
  };
};
