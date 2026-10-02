import type { ValidationIssue } from '@shapio/schema';
import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';
import { DefinitionPanel } from '../DefinitionPanel';
import { Summary } from './Summary';

type ModelSettingsProps = { issues: readonly ValidationIssue[]; disabled: boolean };

/** Issues about the definition itself, not one of its fields (those show on the field). */
const isDefinitionIssue = (issue: ValidationIssue) => !/^\/fields(\/|$)/.test(issue.path);

/** The definition's own settings: a one-row summary until expanded to edit. */
export const ModelSettings = ({ issues, disabled }: ModelSettingsProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return (
    <Panel
      title={t('models.builder.definitionSettings')}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={t('models.builder.definitionSettings')}
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDown aria-hidden="true" className={cn('transition-transform', expanded && 'rotate-180')} />
        </Button>
      }
    >
      <div id={bodyId}>
        {expanded ? (
          <DefinitionPanel issues={issues} disabled={disabled} />
        ) : (
          <Summary hasIssues={issues.some(isDefinitionIssue)} />
        )}
      </div>
    </Panel>
  );
};
