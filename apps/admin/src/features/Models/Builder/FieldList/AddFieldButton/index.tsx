import { ChevronDown, Plus, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { useAddSeoField } from '../../hooks/useAddSeoField';
import { ADD_FIELD_BUTTON_ID } from '../../hooks/useNewField';

type AddFieldButtonProps = {
  disabled: boolean;
  onAdd: () => void;
  /** "SEO fields" in the menu; absent for components (the SEO group belongs on content types). */
  seo?: ReturnType<typeof useAddSeoField>;
};

const SEO_HELP_KEYS = {
  askAdmin: 'seo.builder.askAdmin',
  present: 'seo.builder.present',
} as const;

/**
 * "Add field" as a split button: the main half adds a field at once (as before), the chevron opens a menu
 * with Field and SEO fields. Enabling SEO for the network asks first, anchored to the chevron.
 */
export const AddFieldButton = ({ disabled, onAdd, seo }: AddFieldButtonProps) => {
  const { t } = useTranslation();
  const helpId = useId();
  const [confirming, setConfirming] = useState(false);
  const addButton = (
    <Button
      id={ADD_FIELD_BUTTON_ID}
      type="button"
      size="sm"
      onClick={onAdd}
      disabled={disabled}
      className={seo ? 'rounded-r-none' : undefined}
    >
      <Plus aria-hidden="true" />
      {t('models.builder.addField')}
    </Button>
  );
  if (!seo) {
    return addButton;
  }
  const { availability } = seo;
  const help = availability === 'askAdmin' || availability === 'present' ? SEO_HELP_KEYS[availability] : null;
  return (
    <div className="flex">
      {addButton}
      <DropdownMenu>
        <InlineConfirm
          tone="default"
          open={confirming}
          onOpenChange={setConfirming}
          title={t('seo.builder.enableTitle')}
          description={t('seo.builder.enableDescription')}
          confirmLabel={t('seo.builder.enable')}
          pendingLabel={t('seo.builder.enabling')}
          onConfirm={seo.enableAndAdd}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              disabled={disabled}
              aria-label={t('seo.builder.menu')}
              className="rounded-l-none border-l border-primary-foreground/25"
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </InlineConfirm>
        <DropdownMenuContent
          align="end"
          className="w-64"
          onCloseAutoFocus={(event) => confirming && event.preventDefault()}
        >
          <DropdownMenuItem onSelect={onAdd}>
            <Plus aria-hidden="true" />
            {t('seo.builder.field')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={availability !== 'ready' && availability !== 'enable'}
            aria-describedby={help ? helpId : undefined}
            onSelect={() => (availability === 'enable' ? setConfirming(true) : seo.add())}
          >
            <Search aria-hidden="true" />
            {t('seo.builder.seoFields')}
          </DropdownMenuItem>
          {help ? (
            <p id={helpId} className="px-2 pb-1.5 pl-8 text-meta text-muted-foreground">
              {t(help)}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
