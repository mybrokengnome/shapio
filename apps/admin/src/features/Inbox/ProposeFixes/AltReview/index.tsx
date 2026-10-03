import type { AltProposal } from '@shapio/client';
import { useTranslation } from 'react-i18next';
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
import type { AltDecision } from '../../hooks/useContentOpsProposal';
import { Row } from './Row';

type AltReviewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: string;
  proposals: readonly AltProposal[];
  decisions: Readonly<Record<string, AltDecision>>;
  onDecide: (assetId: string, decision: AltDecision) => void;
};

/** Proposed library alt texts, one per image: edit, accept (saved to the file) or reject, one at a time. */
export const AltReview = ({ open, onOpenChange, model, proposals, decisions, onDecide }: AltReviewProps) => {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle>{t('assist.fixes.altTitle')}</SheetTitle>
          <SheetDescription>{t('assist.fixes.altDescription', { model })}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <ul aria-label={t('assist.fixes.altTitle')} className="divide-y">
            {proposals.map((proposal) => (
              <Row
                key={proposal.assetId}
                proposal={proposal}
                decision={decisions[proposal.assetId]}
                onDecide={(decision) => onDecide(proposal.assetId, decision)}
              />
            ))}
          </ul>
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
