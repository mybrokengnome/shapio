import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/CopyButton';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { JsonBlock } from '../../JsonBlock';
import { SignatureHelp } from '../../SignatureHelp';

type CallbackHelpProps = { callbackUrl: string };

/** The body a build posts back; code, not prose, so it is not translated. */
const CALLBACK_EXAMPLE = {
  runId: '0b8f3c1e-…',
  status: 'deployed',
  logUrl: 'https://ci.example.com/builds/123',
  siteUrl: 'https://www.example.com',
  message: 'Build 123',
};

/** How a generic-webhook site reports build progress: where to post, what to send, how to sign it. */
export const CallbackHelp = ({ callbackUrl }: CallbackHelpProps) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <Field>
        <FieldLabel htmlFor="deployment-callback-url">{t('publishing.deployments.callbackUrl')}</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="deployment-callback-url"
            readOnly
            value={callbackUrl}
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyButton value={callbackUrl} />
        </div>
      </Field>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold">{t('publishing.deployments.callbackBody')}</p>
          <JsonBlock value={CALLBACK_EXAMPLE} label={t('publishing.deployments.callbackBody')} />
          <p className="text-meta text-muted-foreground">{t('publishing.deployments.callbackFields')}</p>
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold">{t('publishing.webhooks.signatureTitle')}</p>
          <SignatureHelp description={t('publishing.deployments.callbackSignature')} />
        </div>
      </div>
    </div>
  );
};
