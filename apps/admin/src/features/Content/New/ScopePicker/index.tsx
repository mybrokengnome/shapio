import { AppWindow, Globe2 } from 'lucide-react';
import { useController, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { InfoHint } from '@/components/InfoHint';
import { RadioTile } from '@/components/RadioTile';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import type { CreateDefinitionValues } from '@/features/Models/hooks/useCreateDefinitionForm';

type ScopePickerProps = {
  control: Control<CreateDefinitionValues>;
  /** The admin may create shared definitions (`schema.create` on every site); otherwise "All sites" is off. */
  canShare: boolean;
};

/** "Available on": this site (the default) or all sites, as cards (a radio group). */
export const ScopePicker = ({ control, canShare }: ScopePickerProps) => {
  const { t } = useTranslation();
  const site = useMe().data?.site;
  const {
    field: { ref, value, onChange },
  } = useController({ control, name: 'scope' });
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label" className="mb-0 flex items-center gap-1">
        {t('contentTypes.availableOn')}
        {canShare ? null : (
          <InfoHint about={t('contentTypes.allSites')}>{t('contentTypes.allSitesNeedsNetwork')}</InfoHint>
        )}
      </FieldLegend>
      <RadioGroup ref={ref} value={value} onValueChange={onChange} className="gap-3 sm:grid-cols-2">
        <RadioTile
          value="site"
          icon={AppWindow}
          label={t('contentTypes.thisSite')}
          description={t('contentTypes.thisSiteDescription', { site: site?.name ?? '' })}
        />
        <RadioTile
          value="network"
          icon={Globe2}
          label={t('contentTypes.allSites')}
          description={t('contentTypes.allSitesDescription')}
          disabled={!canShare}
        />
      </RadioGroup>
    </FieldSet>
  );
};
