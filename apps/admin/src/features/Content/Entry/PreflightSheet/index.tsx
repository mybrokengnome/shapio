import type { PreflightCheck } from '@shapio/client';
import { CalendarClock, CircleCheck, Loader2, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { usePreflight } from '@/api/entryDocument';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEntryForm, useFieldsEnvironment } from '@/fields/form/context';
import { formatDateTime } from '@/helpers/formatDate';
import { AddToChangeSet } from '../AddToChangeSet';
import { resolveFieldPath } from '../helpers/fieldPath';
import { sentenceOf } from '../helpers/preflightSentences';
import { PreflightCheckItem } from '../PreflightCheckItem';
import { ScheduleForm } from '../ScheduleForm';

type PreflightSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryId: string;
  /** The draft has been saved (autosaved) since it was last changed: the checks see what is on screen. */
  ready: boolean;
  labelOf: (code: string) => string;
  canSchedule: boolean;
  /** Offer "Add to change set…" (the admin manages change sets). */
  canUseChangeSets: boolean;
  publishing: boolean;
  onPublish: () => Promise<boolean>;
  /** Takes the person to a value, once the sheet has closed. */
  onFix: (path: string, assetId?: string) => void;
};

/**
 * Publishing as a pre-flight (Ghost-style): one plain sentence per thing publishing would run into, each
 * with a way to fix it. Errors (required fields, invalid values, a slug already live elsewhere) disable
 * "Publish now"; warnings (missing alt text, a locale not started) only inform. Schedule… publishes later.
 */
export const PreflightSheet = ({
  open,
  onOpenChange,
  entryId,
  ready,
  labelOf,
  canSchedule,
  canUseChangeSets,
  publishing,
  onPublish,
  onFix,
}: PreflightSheetProps) => {
  const { t } = useTranslation();
  const { model, components, locale } = useFieldsEnvironment();
  const values = useEntryForm((state) => state.values);
  const preflight = usePreflight(model.apiKey, entryId, locale ?? undefined, open && ready);
  const [scheduling, setScheduling] = useState(false);
  // A Fix waits for the sheet to close, then moves focus to the value instead of back to Publish.
  const pendingFix = useRef<(() => void) | null>(null);
  const localeChecks = preflight.data?.locales.flatMap((item) => item.checks) ?? [];
  const entryChecks = preflight.data?.entry ?? [];
  const blocked = localeChecks.some((check) => check.severity === 'error');
  const sentence = (check: PreflightCheck, entryLevel: boolean) => {
    const target = check.path ? resolveFieldPath(model, components, values, check.path) : undefined;
    return sentenceOf(check, {
      fieldLabel: target?.trail.join(' › '),
      field: target?.field,
      localeLabel: labelOf,
      entryLevel,
    });
  };
  const fixOf = (check: PreflightCheck) => {
    const path = check.path;
    if (!path) {
      return undefined;
    }
    const assetId = typeof check.params.assetId === 'string' ? check.params.assetId : undefined;
    return () => {
      pendingFix.current = () => onFix(path, assetId);
      onOpenChange(false);
    };
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setScheduling(false);
        }
      }}
    >
      <SheetContent
        size="md"
        onCloseAutoFocus={(event) => {
          const fix = pendingFix.current;
          if (fix) {
            event.preventDefault();
            pendingFix.current = null;
            fix();
          }
        }}
      >
        <SheetHeader>
          <SheetTitle>{t('entry.preflight.title')}</SheetTitle>
          <SheetDescription>
            {locale
              ? t('entry.preflight.descriptionLocale', { locale: labelOf(locale) })
              : t('entry.preflight.description')}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          {!ready || preflight.isPending ? (
            <LoadingState rows={3} />
          ) : preflight.isError ? (
            <ErrorState error={preflight.error} onRetry={() => void preflight.refetch()} />
          ) : (
            <>
              {localeChecks.length === 0 && entryChecks.length === 0 ? (
                <p className="flex items-center gap-2 text-sm" role="status">
                  <CircleCheck aria-hidden="true" className="size-4 text-success" />
                  {t('entry.preflight.allClear')}
                </p>
              ) : (
                <ul aria-label={t('entry.preflight.checks')} className="rounded-xl border px-4">
                  {localeChecks.map((check, index) => (
                    <PreflightCheckItem
                      key={`${check.rule}-${check.path ?? ''}-${index}`}
                      check={check}
                      sentence={sentence(check, false)}
                      onFix={fixOf(check)}
                    />
                  ))}
                  {entryChecks.map((check, index) => (
                    <PreflightCheckItem
                      key={`entry-${check.rule}-${index}`}
                      check={check}
                      sentence={sentence(check, true)}
                    />
                  ))}
                </ul>
              )}
              {scheduling && canSchedule ? (
                <ScheduleForm
                  modelKey={model.apiKey}
                  entryId={entryId}
                  locale={locale}
                  onScheduled={(runAt) => {
                    toast.success(t('entry.preflight.scheduledToast', { time: formatDateTime(runAt) }));
                    onOpenChange(false);
                  }}
                />
              ) : null}
            </>
          )}
        </SheetBody>
        <SheetFooter className="justify-between">
          <div className="flex flex-wrap gap-2">
            {canSchedule ? (
              <Button
                type="button"
                variant="outline"
                aria-expanded={scheduling}
                disabled={blocked || !preflight.data}
                onClick={() => setScheduling((current) => !current)}
              >
                <CalendarClock aria-hidden="true" />
                {t('entry.preflight.schedule')}
              </Button>
            ) : null}
            {canUseChangeSets ? (
              <AddToChangeSet
                entryId={entryId}
                locale={locale}
                disabled={blocked || !preflight.data}
                onAdded={() => onOpenChange(false)}
              />
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('entry.preflight.notYet')}
            </Button>
            <Button
              type="button"
              disabled={blocked || !preflight.data || publishing}
              onClick={() =>
                void onPublish().then((published) => (published ? onOpenChange(false) : undefined))
              }
            >
              {publishing ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {t('entry.preflight.publishNow')}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
