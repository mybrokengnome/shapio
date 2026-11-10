import type { OlderClients } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { versionProtection } from '../../../helpers/olderClients';

type OlderClientsAckProps = { olderClients: OlderClients | null | undefined; id?: string };

const listOf = (versions: readonly number[], locale: string) =>
  new Intl.ListFormat(locale, { type: 'disjunction' }).format(versions.map(String));

/**
 * The breaking acknowledgement's one line: which readers naming an older schema version keep working once
 * the change is live (protected), and which do not (their version reads worse, or they name none).
 */
export const OlderClientsAck = ({ olderClients, id }: OlderClientsAckProps) => {
  const { t, i18n } = useTranslation();
  const { protectedVersions, unprotectedVersions } = versionProtection(olderClients);
  const locale = i18n.resolvedLanguage ?? 'en';
  const text =
    protectedVersions.length > 0 && unprotectedVersions.length > 0
      ? t('olderClients.ack.mixed', {
          protected: listOf(protectedVersions, locale),
          unprotected: listOf(unprotectedVersions, locale),
        })
      : protectedVersions.length > 0
        ? t('olderClients.ack.protectedOnly', { versions: listOf(protectedVersions, locale) })
        : unprotectedVersions.length > 0
          ? t('olderClients.ack.unprotectedOnly', { versions: listOf(unprotectedVersions, locale) })
          : t('olderClients.ack.none');
  return (
    <p id={id} data-older-clients-ack className="flex items-start gap-1 text-meta text-muted-foreground">
      <span>{text}</span>
      <InfoHint about={t('olderClients.ack.about')}>{t('olderClients.ack.hint')}</InfoHint>
    </p>
  );
};
