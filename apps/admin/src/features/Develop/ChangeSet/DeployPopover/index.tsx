import { zodResolver } from '@hookform/resolvers/zod';
import type { DeploymentConnection } from '@shapio/client';
import { Rocket } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/FormError';
import { FormSelectField } from '@/components/FormSelectField';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { requiredText } from '@/helpers/validation';
import type { ShipFlow } from '../hooks/useShipFlow';

const deploySchema = z.object({ connectionId: requiredText() });
type DeployValues = z.infer<typeof deploySchema>;

type DeployPopoverProps = {
  flow: ShipFlow;
  connections: readonly DeploymentConnection[];
  /** The connection already chosen for this set, preselected. */
  currentConnectionId: string | null;
  disabled: boolean;
};

/**
 * "Ship with deploy": ship the set as one snapshot, then trigger the chosen connection's build pinned to
 * that snapshot (plan developer-face §5, option A).
 */
export const DeployPopover = ({ flow, connections, currentConnectionId, disabled }: DeployPopoverProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const defaults = useMemo<DeployValues>(
    () => ({ connectionId: currentConnectionId ?? connections[0]?.id ?? '' }),
    [currentConnectionId, connections],
  );
  const form = useForm<DeployValues>({ resolver: zodResolver(deploySchema), values: defaults });
  const onSubmit = form.handleSubmit(async ({ connectionId }) => {
    setError(null);
    try {
      await flow.shipNow(connectionId);
      setOpen(false);
    } catch (cause) {
      setError(cause);
    }
  });
  return (
    <Popover open={open} onOpenChange={(next) => (flow.shipping && !next ? undefined : setOpen(next))} modal>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Rocket aria-hidden="true" />
          {t('changes.review.shipWithDeploy')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className="w-80">
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
          <p id={titleId} className="text-sm font-semibold">
            {t('changes.review.shipWithDeployTitle')}
          </p>
          <FormSelectField
            control={form.control}
            name="connectionId"
            label={t('changes.review.connection')}
            options={connections.map((connection) => ({ value: connection.id, label: connection.name }))}
          />
          <p className="text-meta text-muted-foreground">{t('changes.review.shipWithDeployHint')}</p>
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <SubmitButton size="sm" pending={flow.shipping} pendingLabel={t('changes.review.shipping')}>
              {t('changes.review.shipWithDeploy')}
            </SubmitButton>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
};
