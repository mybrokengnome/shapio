import { GitPullRequest, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { TextLink } from '@/components/TextLink';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { MissingContractIssue } from '../../helpers/interfaces';
import { useContractFix } from '../hooks/useContractFix';

type ContractFixSheetProps = {
  /** The members lacking a contract field, from the refused plan; the sheet is open while there are any. */
  issues: readonly MissingContractIssue[] | undefined;
  /** The interface's name. */
  name: string;
  onClose: () => void;
};

const NO_ISSUES: readonly MissingContractIssue[] = [];

/**
 * The review of an interface whose new contract fields some members lack (plan interfaces decision 4): the
 * members missing them, and the offer to add them to every member here in one change set with the
 * interface's change. Members on another site are listed with where to add the field first.
 */
export const ContractFixSheet = ({ issues, name, onClose }: ContractFixSheetProps) => {
  const { t } = useTranslation();
  const fix = useContractFix(issues ?? NO_ISSUES);
  const single = fix.fieldApiKeys.length === 1 ? fix.fieldApiKeys[0] : undefined;
  return (
    <Sheet open={issues !== undefined} onOpenChange={(open) => !open && !fix.saving && onClose()}>
      <SheetContent size="md">
        <SheetHeader className="pr-14">
          <SheetTitle>{t('interfaces.fix.title', { name })}</SheetTitle>
          <SheetDescription>
            {t('interfaces.fix.description', { name, fields: fix.fieldApiKeys.join(', ') })}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-4 pt-1">
          <ul aria-label={t('interfaces.fix.membersLabel')} className="divide-y rounded-lg border">
            {fix.members.map((member, position) => (
              <li
                key={member.kind === 'here' ? member.id : `elsewhere-${position}`}
                className="space-y-0.5 px-3 py-2.5"
              >
                {member.kind === 'here' ? (
                  <TextLink
                    to="/models/$modelId"
                    params={{ modelId: member.id }}
                    className="text-sm font-semibold"
                  >
                    {member.label}
                  </TextLink>
                ) : (
                  <span className="text-sm font-semibold">
                    {member.siteKey
                      ? t('interfaces.fix.otherSite', { site: member.siteKey })
                      : t('interfaces.fix.otherSiteUnnamed')}
                  </span>
                )}
                <p className="text-meta text-muted-foreground">
                  {member.kind === 'here'
                    ? t('interfaces.fix.lacks', { fields: member.fieldApiKeys.join(', ') })
                    : t('interfaces.fix.addThereFirst', { fields: member.fieldApiKeys.join(', ') })}
                </p>
              </li>
            ))}
          </ul>
          <FormError error={fix.error} />
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={fix.saving}>
            {t('common.cancel')}
          </Button>
          {fix.fixableCount > 0 ? (
            <Button
              type="button"
              disabled={fix.saving}
              aria-busy={fix.saving || undefined}
              onClick={() => void fix.addToMembers()}
            >
              {fix.saving ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <GitPullRequest aria-hidden="true" />
              )}
              {fix.saving
                ? t('common.saving')
                : single !== undefined
                  ? t('interfaces.fix.addField', { field: single, count: fix.fixableCount })
                  : t('interfaces.fix.addFields', { count: fix.fixableCount })}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
