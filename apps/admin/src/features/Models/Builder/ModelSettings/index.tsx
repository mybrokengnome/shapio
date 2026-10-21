import type { DefinitionKind, InterfaceDefinition, ModelDefinition, ValidationIssue } from '@shapio/schema';
import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { DefinitionPanel } from '../DefinitionPanel';
import { Summary } from './Summary';

type ModelSettingsProps = {
  issues: readonly ValidationIssue[];
  disabled: boolean;
  /** Passed to `DefinitionPanel`. */
  scopeSection?: ReactNode;
  /** Passed to `DefinitionPanel`. */
  parentChoices: readonly ModelDefinition[];
  /** Passed to `DefinitionPanel`. */
  kindCount: number;
  /** Passed to `DefinitionPanel`. */
  interfaceChoices: readonly InterfaceDefinition[];
};

/** The panel's name by the definition's kind (collections and singletons are models). */
const SETTINGS_LABEL_KEYS = {
  collection: 'models.builder.definitionSettings',
  singleton: 'models.builder.definitionSettings',
  component: 'models.builder.componentSettings',
  interface: 'models.builder.interfaceSettings',
} as const satisfies Record<DefinitionKind, string>;

/** Issues about the definition itself, not one of its fields (those show on the field). */
const isDefinitionIssue = (issue: ValidationIssue) => !/^\/fields(\/|$)/.test(issue.path);

/** The definition's own settings: a one-row summary until expanded to edit. */
export const ModelSettings = ({
  issues,
  disabled,
  scopeSection,
  parentChoices,
  kindCount,
  interfaceChoices,
}: ModelSettingsProps) => {
  const { t } = useTranslation();
  const kind = useDefinitionDraftStore((state) => state.draft?.kind ?? 'collection');
  const title = t(SETTINGS_LABEL_KEYS[kind]);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return (
    <Panel
      title={title}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={title}
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDown aria-hidden="true" className={cn('transition-transform', expanded && 'rotate-180')} />
        </Button>
      }
    >
      <div id={bodyId}>
        {expanded ? (
          <DefinitionPanel
            issues={issues}
            disabled={disabled}
            scopeSection={scopeSection}
            parentChoices={parentChoices}
            kindCount={kindCount}
            interfaceChoices={interfaceChoices}
          />
        ) : (
          <Summary hasIssues={issues.some(isDefinitionIssue)} />
        )}
      </div>
    </Panel>
  );
};
