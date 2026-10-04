import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { RadioTile } from '@/components/RadioTile';
import { useSingleVariantNote } from '@/components/ThemeMenu/hooks/useSingleVariantNote';
import { useThemeSelection } from '@/components/ThemeMenu/hooks/useThemeSelection';
import { ThemeSwatches } from '@/components/ThemeSwatches';
import { RadioGroup } from '@/components/ui/radio-group';
import { THEME_ICONS } from '@/constants/themeIcons';
import { APPEARANCES, isAppearance } from '@/constants/themes';
import { useThemeStore } from '@/stores/theme';

export const Appearance = () => {
  const { t } = useTranslation();
  const { themes, themeKey, isSingleVariant, selectTheme } = useThemeSelection();
  const appearance = useThemeStore((state) => state.appearance);
  const setAppearance = useThemeStore((state) => state.setAppearance);
  const singleVariantNote = useSingleVariantNote();
  return (
    <Page width="full">
      <PageHeader title={t('appearance.title')} />
      <div className="space-y-6">
        <Panel title={t('appearance.theme')} description={t('appearance.storedHere')}>
          <RadioGroup
            aria-label={t('appearance.theme')}
            value={themeKey}
            onValueChange={selectTheme}
            className="sm:grid-cols-2 xl:grid-cols-4"
          >
            {themes.map((option) => (
              <RadioTile
                key={option.key}
                value={option.key}
                label={option.name}
                description={option.description}
                media={<ThemeSwatches themeKey={option.key} variants={option.variants} size="lg" />}
              />
            ))}
          </RadioGroup>
        </Panel>
        <Panel
          title={t('appearance.mode')}
          actions={
            singleVariantNote ? (
              <InfoHint about={t('appearance.mode')}>{singleVariantNote}</InfoHint>
            ) : undefined
          }
        >
          <RadioGroup
            aria-label={t('appearance.mode')}
            value={appearance}
            onValueChange={(value) => {
              if (isAppearance(value)) {
                setAppearance(value);
              }
            }}
            className="sm:grid-cols-3"
          >
            {APPEARANCES.map((option) => (
              <RadioTile
                key={option}
                value={option}
                label={t(`theme.${option}`)}
                icon={THEME_ICONS[option]}
                disabled={isSingleVariant}
              />
            ))}
          </RadioGroup>
        </Panel>
      </div>
    </Page>
  );
};
