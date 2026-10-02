import { useTranslation } from 'react-i18next';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { RadioTile } from '@/components/RadioTile';
import { RadioGroup } from '@/components/ui/radio-group';
import { THEME_ICONS } from '@/constants/themeIcons';
import { isThemePreference, THEME_PREFERENCES, useThemeStore } from '@/stores/theme';

export const Appearance = () => {
  const { t } = useTranslation();
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  return (
    <Page width="full">
      <PageHeader title={t('appearance.title')} />
      <Panel title={t('appearance.mode')} description={t('appearance.storedHere')}>
        <RadioGroup
          aria-label={t('appearance.mode')}
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) {
              setPreference(value);
            }
          }}
          className="sm:grid-cols-3"
        >
          {THEME_PREFERENCES.map((option) => (
            <RadioTile key={option} value={option} label={t(`theme.${option}`)} icon={THEME_ICONS[option]} />
          ))}
        </RadioGroup>
      </Panel>
    </Page>
  );
};
