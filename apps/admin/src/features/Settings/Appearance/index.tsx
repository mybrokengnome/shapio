import { useTranslation } from 'react-i18next';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { RadioTile } from '@/components/RadioTile';
import { useLookSelection } from '@/components/ThemeMenu/hooks/useLookSelection';
import { ThemeSwatches } from '@/components/ThemeSwatches';
import { RadioGroup } from '@/components/ui/radio-group';

export const Appearance = () => {
  const { t } = useTranslation();
  const { looks, selectedLook, selectLook } = useLookSelection();
  return (
    <Page width="full">
      <PageHeader title={t('appearance.title')} />
      <Panel title={t('appearance.theme')} description={t('appearance.storedHere')}>
        <RadioGroup
          aria-label={t('appearance.theme')}
          value={selectedLook}
          onValueChange={selectLook}
          className="sm:grid-cols-2 xl:grid-cols-3"
        >
          {looks.map((look) => (
            <RadioTile
              key={look.value}
              value={look.value}
              label={look.name}
              description={look.description}
              media={<ThemeSwatches themeKey={look.themeKey} variant={look.variant} size="lg" />}
            />
          ))}
        </RadioGroup>
      </Panel>
    </Page>
  );
};
