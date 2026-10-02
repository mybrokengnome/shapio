import { Send } from 'lucide-react';
import { useId, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocales } from '@/api/locales';
import { HintedLabel } from '@/components/HintedLabel';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilterRows } from '../FilterRows';
import { hasParameter, type DeliveryOperation } from '../helpers/operations';
import type { RequestDraft } from '../helpers/request';
import { useExplorerTokenStore } from '../stores/token';
import { TextParam } from './TextParam';

/** Radix Select has no empty value: this stands for "no `locale` parameter" (the default locale). */
const DEFAULT_LOCALE = '__default__';
const METHOD = 'GET';

type RequestBuilderProps = {
  operation: DeliveryOperation;
  draft: RequestDraft;
  onDraftChange: (draft: RequestDraft) => void;
  path: string;
  sendable: boolean;
  sending: boolean;
  onSend: () => void;
};

/** Path parameter, locale, snapshot, projection, filters and the token, then Send. */
export const RequestBuilder = ({
  operation,
  draft,
  onDraftChange,
  path,
  sendable,
  sending,
  onSend,
}: RequestBuilderProps) => {
  const { t } = useTranslation();
  const localeId = useId();
  const locales = useLocales().data ?? [];
  const token = useExplorerTokenStore((state) => state.token);
  const setToken = useExplorerTokenStore((state) => state.setToken);
  const set = (patch: Partial<RequestDraft>) => onDraftChange({ ...draft, ...patch });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sendable) {
      onSend();
    }
  };
  return (
    <Panel title={operation.summary} titleAs="h2">
      <form className="space-y-5" onSubmit={submit}>
        <p className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {METHOD}
          </Badge>
          <code className="min-w-0 font-mono text-xs break-all">{path}</code>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {operation.byId ? (
            <TextParam
              label={t('develop.api.request.id')}
              value={draft.id}
              onChange={(id) => set({ id })}
              required
              mono
            />
          ) : null}
          {hasParameter(operation, 'locale') ? (
            <div className="min-w-0 space-y-2">
              <HintedLabel
                htmlFor={localeId}
                label={t('develop.api.request.locale')}
                hint={t('develop.api.request.localeHint')}
              />
              <Select
                value={draft.locale || DEFAULT_LOCALE}
                onValueChange={(value) => set({ locale: value === DEFAULT_LOCALE ? '' : value })}
              >
                <SelectTrigger id={localeId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_LOCALE}>{t('develop.api.request.defaultLocale')}</SelectItem>
                  {locales.map((locale) => (
                    <SelectItem key={locale.code} value={locale.code}>
                      {t('develop.api.request.localeOption', { label: locale.label, code: locale.code })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {hasParameter(operation, 'snapshot') ? (
            <TextParam
              label={t('develop.api.request.snapshot')}
              hint={t('develop.api.request.snapshotHint')}
              value={draft.snapshot}
              onChange={(snapshot) => set({ snapshot })}
              inputMode="numeric"
            />
          ) : null}
          <TextParam
            label={t('develop.api.request.fields')}
            hint={t('develop.api.request.fieldsHint')}
            value={draft.fields}
            onChange={(fields) => set({ fields })}
            mono
          />
          <TextParam
            label={t('develop.api.request.populate')}
            hint={t('develop.api.request.populateHint')}
            value={draft.populate}
            onChange={(populate) => set({ populate })}
            mono
          />
          {operation.list ? (
            <>
              <TextParam
                label={t('develop.api.request.sort')}
                hint={t('develop.api.request.sortHint')}
                value={draft.sort}
                onChange={(sort) => set({ sort })}
                mono
              />
              <TextParam
                label={t('develop.api.request.search')}
                value={draft.q}
                onChange={(q) => set({ q })}
              />
              <TextParam
                label={t('develop.api.request.page')}
                value={draft.page}
                onChange={(page) => set({ page })}
                inputMode="numeric"
              />
              <TextParam
                label={t('develop.api.request.pageSize')}
                value={draft.pageSize}
                onChange={(pageSize) => set({ pageSize })}
                inputMode="numeric"
              />
            </>
          ) : null}
        </div>
        {operation.list ? <FilterRows rows={draft.filters} onChange={(filters) => set({ filters })} /> : null}
        <TextParam
          label={t('develop.api.request.token')}
          hint={t('develop.api.request.tokenHint')}
          value={token}
          onChange={setToken}
          type="password"
          autoComplete="off"
          placeholder={t('develop.api.request.tokenPlaceholder')}
          mono
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!sendable || sending}>
            <Send aria-hidden="true" />
            {sending ? t('develop.api.sending') : t('develop.api.send')}
          </Button>
        </div>
      </form>
    </Panel>
  );
};
