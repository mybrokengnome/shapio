import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { describeIssue } from '../../helpers/describeIssue';
import { useModelIndex } from '../../hooks/useModelIndex';
import { useMemberIssues } from '../hooks/useMemberIssues';

type MembersProps = { interfaceId: string };

/**
 * An interface's members (plan interfaces D11): every type that implements it in this site's view, with a
 * link to its builder, where its membership comes from ("via Products" for a kind), and whether it meets
 * the draft's contract (OK, or the first refusal).
 */
export const Members = ({ interfaceId }: MembersProps) => {
  const { t } = useTranslation();
  const { index } = useModelIndex();
  const { memberIssues } = useMemberIssues();
  const nameOf = (id: string) => index.get(id)?.label ?? id;
  const members = index
    .implementedBy(interfaceId)
    .map((id) => {
      const definition = index.get(id);
      const own = definition && 'implements' in definition ? (definition.implements ?? []) : [];
      // A kind is a member through the nearest ancestor that implements it; its problems are reported there.
      const via = own.includes(interfaceId)
        ? undefined
        : [...index.ancestors(id)].reverse().find((ancestorId) => {
            const ancestor = index.get(ancestorId);
            return ancestor && 'implements' in ancestor && (ancestor.implements ?? []).includes(interfaceId);
          });
      return { id, label: nameOf(id), via, issue: memberIssues.get(via ?? id) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <Panel
      title={t('interfaces.members.title')}
      actions={<span className="text-meta text-muted-foreground tabular-nums">{members.length}</span>}
      flush
      bodyClassName="p-2"
    >
      {members.length === 0 ? (
        <p className="px-3 py-6 text-center text-meta text-muted-foreground">
          {t('interfaces.members.none')}
        </p>
      ) : (
        <ul className="space-y-0.5" aria-label={t('interfaces.members.title')}>
          {members.map((member) => (
            <li key={member.id} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5">
              <span className="min-w-0 flex-1 leading-tight">
                <RowTitle asChild>
                  <Link to="/models/$modelId" params={{ modelId: member.id }} className="block truncate">
                    {member.label}
                  </Link>
                </RowTitle>
                {member.via ? (
                  <span className="block truncate text-meta text-muted-foreground">
                    {t('interfaces.members.via', { model: nameOf(member.via) })}
                  </span>
                ) : null}
                {member.issue ? (
                  <span className="block text-meta text-destructive">
                    {describeIssue(member.issue, { definitionName: nameOf })}
                  </span>
                ) : null}
              </span>
              <StatusChip
                size="sm"
                tone={member.issue ? 'danger' : 'success'}
                label={member.issue ? t('interfaces.members.refused') : t('interfaces.members.ok')}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};
