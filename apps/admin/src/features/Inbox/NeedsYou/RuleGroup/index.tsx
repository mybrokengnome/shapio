import { CONTENT_OPS_RULES, type ContentOpsRule } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssistEnabled } from '@/api/assist';
import { IconTile } from '@/components/IconTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GROUP_PREVIEW, RULE_ICONS, RULE_TITLE_KEYS } from '../../constants';
import type { FindingGroup } from '../../hooks/useFindingGroups';
import { ProposeFixes } from '../../ProposeFixes';
import { Finding } from '../Finding';

type RuleGroupProps = {
  group: FindingGroup;
  models: ReadonlyMap<string, ModelDefinition> | undefined;
  localeLabel: (code: string) => string;
  showLocale: boolean;
};

const isContentOpsRule = (rule: string): rule is ContentOpsRule =>
  (CONTENT_OPS_RULES as readonly string[]).includes(rule);

/** One rule's findings: a heading with the count, the first few rows, and "Show all" in place. */
export const RuleGroup = ({ group, models, localeLabel, showLocale }: RuleGroupProps) => {
  const { t } = useTranslation();
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const assistEnabled = useAssistEnabled();
  const shown = expanded ? group.findings : group.findings.slice(0, GROUP_PREVIEW);
  const hidden = group.findings.length - shown.length;
  return (
    <section aria-labelledby={headingId} className="py-1">
      <div className="flex items-center gap-3 px-5 pt-3 pb-1">
        <IconTile icon={RULE_ICONS[group.rule]} size="sm" tone="warning" />
        <h3 id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t(RULE_TITLE_KEYS[group.rule])}
        </h3>
        <Badge variant="secondary" className="tabular-nums">
          {group.count.toLocaleString()}
        </Badge>
      </div>
      {assistEnabled && isContentOpsRule(group.rule) ? <ProposeFixes rule={group.rule} /> : null}
      <ul className="divide-y">
        {shown.map((finding) => (
          <Finding
            key={finding.id}
            finding={finding}
            model={models?.get(finding.modelId)}
            localeLabel={localeLabel}
            showLocale={showLocale}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <div className="px-5 pb-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            {t('inbox.showAll', { count: group.findings.length })}
          </Button>
        </div>
      ) : null}
    </section>
  );
};
