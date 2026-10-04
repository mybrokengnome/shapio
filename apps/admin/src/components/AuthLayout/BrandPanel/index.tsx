import { Braces, Server, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Wordmark } from '../../Wordmark';

const PITCHES = [
  { icon: Zap, key: 'auth.brand.pitchLive' },
  { icon: Braces, key: 'auth.brand.pitchApi' },
  { icon: Server, key: 'auth.brand.pitchSelfHosted' },
] as const;

/**
 * The brand column of the signed-out screens (lg and up), in the theme's brand-panel colours: panel logo,
 * tagline, three-line pitch.
 */
export const BrandPanel = () => {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t('auth.brand.label')}
      className="hidden bg-linear-to-br from-brand-panel-from to-brand-panel-to p-12 text-brand-panel-foreground lg:flex lg:w-5/12 lg:max-w-2xl lg:shrink-0 lg:flex-col lg:justify-between"
    >
      <Wordmark size="lg" variant="reverse" className="self-start" />
      <div className="max-w-md space-y-8">
        <p className="text-5xl leading-tight font-extrabold tracking-tight">{t('auth.brand.tagline')}</p>
        <ul className="space-y-4">
          {PITCHES.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-3 text-base font-medium">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-panel-foreground/15">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
};
