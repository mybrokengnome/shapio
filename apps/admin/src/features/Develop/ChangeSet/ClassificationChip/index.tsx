import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { CHANGE_CLASS_DISPLAY, type ChangeClass } from '../helpers/classification';

type ClassificationChipProps = { changeClass: ChangeClass; size?: 'default' | 'sm' };

/** Additive, validation, conversion, breaking or metadata: what a schema change does to existing content. */
export const ClassificationChip = ({ changeClass, size }: ClassificationChipProps) => {
  const { t } = useTranslation();
  const display = CHANGE_CLASS_DISPLAY[changeClass];
  return <StatusChip tone={display.tone} label={t(display.labelKey)} size={size} />;
};
