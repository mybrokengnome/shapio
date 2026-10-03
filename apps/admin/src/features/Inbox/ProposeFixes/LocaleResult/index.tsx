import type { LocaleMissingResult } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { TextLink } from '@/components/TextLink';

type LocaleResultProps = { result: LocaleMissingResult };

/** Where the proposed locale drafts went (a change set to review) and how many were left alone. */
export const LocaleResult = ({ result }: LocaleResultProps) => {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground">
      {result.changeSetId ? (
        <TextLink to="/changes/$changeSetId" params={{ changeSetId: result.changeSetId }}>
          {t('assist.fixes.openSet', { count: result.written.length })}
        </TextLink>
      ) : (
        <span>{t('assist.fixes.nothingWritten')}</span>
      )}
      {result.skipped.length > 0 ? (
        <span>{t('assist.fixes.skipped', { count: result.skipped.length })}</span>
      ) : null}
    </span>
  );
};
