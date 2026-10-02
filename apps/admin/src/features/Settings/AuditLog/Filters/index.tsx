import type { AuditActorType } from '@shapio/client';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AUDIT_ACTOR_TYPES } from '@/constants/audit';

type FiltersProps = {
  action: string | undefined;
  actorType: AuditActorType | undefined;
  onChange: (filters: { action: string | undefined; actorType: AuditActorType | undefined }) => void;
};

const ALL = 'all';

const isActorType = (value: string): value is AuditActorType =>
  (AUDIT_ACTOR_TYPES as readonly string[]).includes(value);

/** The audit table's filter row: action (applied on Enter or blur) and actor type. */
export const Filters = ({ action, actorType, onChange }: FiltersProps) => {
  const { t } = useTranslation();
  const [actionDraft, setActionDraft] = useState(action ?? '');
  const hasFilters = Boolean(action) || Boolean(actorType);
  return (
    <form
      role="search"
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ action: actionDraft.trim() || undefined, actorType });
      }}
    >
      <Label htmlFor="audit-action" className="sr-only">
        {t('audit.filterAction')}
      </Label>
      <div className="relative w-full sm:w-80">
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="audit-action"
          inputSize="sm"
          value={actionDraft}
          placeholder={t('audit.filterActionPlaceholder')}
          onChange={(event) => setActionDraft(event.target.value)}
          onBlur={() => onChange({ action: actionDraft.trim() || undefined, actorType })}
          className="pl-8"
        />
      </div>
      <Label htmlFor="audit-actor-type" className="sr-only">
        {t('audit.filterActor')}
      </Label>
      <Select
        value={actorType ?? ALL}
        onValueChange={(value) => onChange({ action, actorType: isActorType(value) ? value : undefined })}
      >
        <SelectTrigger id="audit-actor-type" size="sm" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('audit.allActors')}</SelectItem>
          {AUDIT_ACTOR_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {t(`audit.actorTypes.${type}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setActionDraft('');
            onChange({ action: undefined, actorType: undefined });
          }}
        >
          {t('audit.clearFilters')}
        </Button>
      ) : null}
    </form>
  );
};
