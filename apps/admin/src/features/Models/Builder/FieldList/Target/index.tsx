import { useTranslation } from 'react-i18next';

type TargetProps = {
  /** What the field points at: "Page and 3 kinds", "Linkable (interface)", "Hero, Grid". */
  label: string;
};

/**
 * A field row's "→ Page" after its API ID. The arrow is for the eye only; a screen reader hears "points at
 * Page" instead of "right arrow Page".
 */
export const Target = ({ label }: TargetProps) => {
  const { t } = useTranslation();
  return (
    <span className="min-w-0 truncate">
      <span className="sr-only">{t('models.builder.pointsAt', { target: label })}</span>
      <span aria-hidden="true">→ {label}</span>
    </span>
  );
};
