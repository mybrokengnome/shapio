import { Braces, Server, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../../Logo';

const PITCHES = [
  { icon: Zap, key: 'auth.brand.pitchLive' },
  { icon: Braces, key: 'auth.brand.pitchApi' },
  { icon: Server, key: 'auth.brand.pitchSelfHosted' },
] as const;

/** The cobalt brand column of the signed-out screens (lg and up): reverse mark, tagline, three-line pitch. */
export const BrandPanel = () => {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t('auth.brand.label')}
      className="hidden bg-linear-to-br from-cobalt to-primary-hover p-12 text-ivory lg:flex lg:w-5/12 lg:max-w-2xl lg:shrink-0 lg:flex-col lg:justify-between dark:from-primary-hover dark:to-ink"
    >
      <span className="inline-flex items-center gap-3">
        <Logo variant="reverse" className="size-10" />
        <span className="text-2xl font-extrabold tracking-tight lowercase">{t('app.name')}</span>
      </span>
      <div className="max-w-md space-y-8">
        <p className="text-5xl leading-tight font-extrabold tracking-tight">{t('auth.brand.tagline')}</p>
        <ul className="space-y-4">
          {PITCHES.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-3 text-base font-medium">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-ivory/15">
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
