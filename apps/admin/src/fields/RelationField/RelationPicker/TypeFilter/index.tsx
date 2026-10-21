import type { ContentTargetMember } from '@shapio/client';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Radix Select items can't carry an empty value. */
const ALL_TYPES = '*';

type TypeFilterProps = {
  /** The types the relation may link that the person can read (from the content-targets response). */
  members: readonly ContentTargetMember[];
  /** The type shown (singular API ID), or undefined for every type. */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

/** Narrows an interface or any-entry picker to one type ("All types" first). */
export const TypeFilter = ({ members, value, onChange }: TypeFilterProps) => {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="shrink-0 text-meta font-normal text-muted-foreground">
        {t('content.relation.typeFilter')}
      </Label>
      <Select
        value={value ?? ALL_TYPES}
        onValueChange={(next) => onChange(next === ALL_TYPES ? undefined : next)}
      >
        <SelectTrigger id={id} size="sm" className="min-w-0 flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TYPES}>{t('content.relation.allTypes')}</SelectItem>
          {members.map((member) => (
            <SelectItem key={member.apiKey} value={member.apiKey}>
              {member.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
