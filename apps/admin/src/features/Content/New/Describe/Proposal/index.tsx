import type { SchemaDraftResult } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { KIND_LABEL_KEYS } from '@/features/Models/constants';

type ProposalProps = { proposal: SchemaDraftResult };

/** The proposed definitions at a glance: name, kind, API ID and fields, before they go into a change set. */
export const Proposal = ({ proposal }: ProposalProps) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="text-meta text-muted-foreground">
        {t('assist.describe.proposedBy', { model: proposal.model })}
      </p>
      <ul aria-label={t('assist.describe.proposalLabel')} className="space-y-3">
        {proposal.definitions.map((definition) => (
          <li key={definition.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{definition.label}</span>
              <Badge variant="secondary">{t(KIND_LABEL_KEYS[definition.kind])}</Badge>
              <span className="font-mono text-meta text-muted-foreground">{definition.apiKey}</span>
            </div>
            <ul className="mt-2 space-y-0.5 text-meta text-muted-foreground">
              {definition.fields.map((field) => (
                <li key={field.id}>
                  <span className="text-foreground">{field.label}</span>{' '}
                  {t('assist.describe.fieldType', { type: t(`models.dataTypes.${field.type}.name`) })}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
};
