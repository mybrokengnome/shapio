import type { ContentHealthFinding } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RULE_FIX_KEYS, RULE_SENTENCE_KEYS } from '../../constants';
import { entryLink } from '../../helpers/entryLink';
import { findingParams } from '../../helpers/findingParams';

type FindingProps = {
  finding: ContentHealthFinding;
  model: ModelDefinition | undefined;
  localeLabel: (code: string) => string;
  /** Show the locale beside the sentence (more than one locale is configured). */
  showLocale: boolean;
};

/** One finding: the entry, one sentence about what is wrong, and a fix that opens the entry at the value. */
export const Finding = ({ finding, model, localeLabel, showLocale }: FindingProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const params = findingParams(finding, model, localeLabel, t('inbox.aField'));
  const title = finding.entryTitle ?? t('content.untitled');
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p id={titleId} className="truncate text-sm font-semibold">
          {title}
        </p>
        <p className="text-meta text-muted-foreground">
          {model
            ? t('inbox.findingMeta', {
                place: model.label,
                sentence: t(RULE_SENTENCE_KEYS[finding.rule], params),
              })
            : t(RULE_SENTENCE_KEYS[finding.rule], params)}
        </p>
      </div>
      {showLocale && finding.locale !== '*' ? (
        <Badge variant="outline" title={localeLabel(finding.locale)} className="uppercase">
          {finding.locale}
        </Badge>
      ) : null}
      <Button variant="outline" size="sm" asChild>
        <Link
          {...entryLink(finding.modelKey, finding.entryId, model?.kind, {
            locale: finding.locale,
            ...(finding.path ? { path: finding.path } : {}),
          })}
          aria-describedby={titleId}
        >
          {t(RULE_FIX_KEYS[finding.rule], params)}
        </Link>
      </Button>
    </li>
  );
};
