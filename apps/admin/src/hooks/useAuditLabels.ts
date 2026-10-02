import { useTranslation } from 'react-i18next';
import { AUDIT_ACTION_LABEL_KEYS, AUDIT_TARGET_LABEL_KEYS } from '@/constants/auditLabels';

const isActionCode = (code: string): code is keyof typeof AUDIT_ACTION_LABEL_KEYS =>
  Object.hasOwn(AUDIT_ACTION_LABEL_KEYS, code);

const isTargetType = (type: string): type is keyof typeof AUDIT_TARGET_LABEL_KEYS =>
  Object.hasOwn(AUDIT_TARGET_LABEL_KEYS, type);

/**
 * Human labels for audit action codes ("auth.login" → "Signed in") and target types ("admin_user" →
 * "Admin user"). Undefined for a code the admin doesn't know yet (a newer server, an extension's route):
 * callers then show the raw code.
 */
export const useAuditLabels = () => {
  const { t } = useTranslation();
  return {
    actionLabel: (code: string) => (isActionCode(code) ? t(AUDIT_ACTION_LABEL_KEYS[code]) : undefined),
    targetLabel: (type: string) => (isTargetType(type) ? t(AUDIT_TARGET_LABEL_KEYS[type]) : undefined),
  };
};
