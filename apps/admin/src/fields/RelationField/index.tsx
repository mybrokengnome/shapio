import { ArrowDown, ArrowUp, Layers, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTile } from '@/components/IconTile';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFieldsEnvironment } from '../form/context';
import { entryTitle, shortId } from '../helpers/titles';
import { moveItem, toList } from '../helpers/values';
import { useEntryLabels } from '../hooks/useEntryLabels';
import type { BuiltInEditorProps } from '../types';
import { InlineCreateSheet } from './InlineCreateSheet';
import { RelationPicker } from './RelationPicker';

/**
 * `relationPicker`: links to entries of another model, one or many (ordered). Entries are found by their
 * title in a picker anchored to the field; with `allowInlineCreate`, a new one can be created in a sheet
 * without leaving the form.
 */
export const RelationField = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const environment = useFieldsEnvironment();
  const { value, onChange, onBlur, readOnly, disabled, definition, field, inputId, labelId, describedBy } =
    props;
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const settings = definition.type === 'relation' ? definition.settings : undefined;
  const target = settings ? environment.models.get(settings.target) : undefined;
  const multiple = settings?.cardinality === 'many';
  const ids = toList<string>(value).filter((id): id is string => typeof id === 'string');
  const labels = useEntryLabels(target, ids, environment.locale);
  if (!settings || !target) {
    return <p className="text-sm text-destructive">{t('content.relation.targetMissing')}</p>;
  }
  const editable = !readOnly && !disabled;
  const commit = (next: string[]) => {
    onChange(multiple ? (next.length > 0 ? next : null) : (next[0] ?? null));
    onBlur();
  };
  const add = (id: string) => commit(multiple ? (ids.includes(id) ? ids : [...ids, id]) : [id]);
  const canAddMore = !multiple || settings.max === undefined || ids.length < settings.max;
  const labelFor = (id: string) => {
    const item = labels.byId.get(id);
    return item ? (entryTitle(target, item.data) ?? `${t('content.untitled')} · ${shortId(id)}`) : undefined;
  };
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={describedBy} className="space-y-2">
      {ids.length > 0 ? (
        <ul ref={listRef} className="space-y-2">
          {ids.map((id, index) => {
            const label = labelFor(id);
            return (
              <li key={id} className="flex items-center gap-3 rounded-lg border bg-card p-2 pl-3">
                <IconTile icon={Layers} />
                <span className="min-w-0 flex-1">
                  {label !== undefined ? (
                    <span className="block truncate text-sm font-semibold">{label}</span>
                  ) : labels.isLoading ? (
                    <Skeleton className="h-4 w-40" />
                  ) : (
                    <span className="block truncate text-sm text-destructive">
                      {t('content.relation.missingEntry', { id: shortId(id) })}
                    </span>
                  )}
                  <span className="block text-meta text-muted-foreground">{target.label}</span>
                </span>
                {editable && multiple ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('content.items.moveUp', { item: label ?? id, position: index + 1 })}
                      disabled={index === 0}
                      onClick={() => commit(moveItem(ids, index, index - 1))}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('content.items.moveDown', { item: label ?? id, position: index + 1 })}
                      disabled={index === ids.length - 1}
                      onClick={() => commit(moveItem(ids, index, index + 1))}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  </>
                ) : null}
                {editable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('content.relation.remove', { item: label ?? id })}
                    onClick={() => commit(ids.filter((item) => item !== id))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('content.relation.empty')}</p>
      )}
      {editable ? (
        <RelationPicker
          open={searching}
          onOpenChange={setSearching}
          // Stays while the picker is open, so it remains anchored when the last allowed pick fills it.
          trigger={
            canAddMore || searching ? (
              <Button id={inputId} type="button" variant="outline" size="sm">
                <Plus aria-hidden="true" />
                {multiple
                  ? t('content.relation.add', { model: target.label })
                  : ids.length > 0
                    ? t('content.relation.change')
                    : t('content.relation.choose', { model: target.label })}
              </Button>
            ) : null
          }
          target={target}
          multiple={multiple}
          selected={ids}
          exclude={environment.entryId && target.id === environment.model.id ? [environment.entryId] : []}
          locale={environment.locale}
          full={!canAddMore}
          // TODO(per-model permissions in `me`): also require `create` on the target model. Until `me` carries
          // per-model permissions, a refusal shows as the server's 403 in the sheet.
          canCreate={field.options.allowInlineCreate === true}
          onPick={add}
          onUnpick={(id) => commit(ids.filter((item) => item !== id))}
          onCreate={() => setCreating(true)}
          // The relation is full and its button gone: focus the last linked entry's Unlink button.
          onFocusFallback={() =>
            listRef.current?.querySelector<HTMLElement>('li:last-child button:last-child')?.focus()
          }
        />
      ) : null}
      {creating ? (
        <InlineCreateSheet
          target={target}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            add(id);
          }}
        />
      ) : null}
    </div>
  );
};
