import { useTranslation } from 'react-i18next';

/** Header names are protocol, not prose: they are not translated. */
const SIGNATURE_HEADERS = [
  { name: 'X-Shapio-Signature', valueKey: 'publishing.webhooks.signatureFormat' },
  { name: 'X-Shapio-Timestamp', valueKey: 'publishing.webhooks.timestampFormat' },
  { name: 'X-Shapio-Event', valueKey: 'publishing.webhooks.eventFormat' },
  { name: 'X-Shapio-Delivery', valueKey: 'publishing.webhooks.deliveryFormat' },
] as const;

type SignatureHelpProps = { description: string };

/** How receivers verify a request: what the signature covers, and the headers Shapio sends. */
export const SignatureHelp = ({ description }: SignatureHelpProps) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-meta text-muted-foreground">{description}</p>
      <dl className="space-y-1 rounded-lg border bg-muted p-3 font-mono text-xs break-all">
        {SIGNATURE_HEADERS.map((header) => (
          <div key={header.name}>
            <dt className="inline font-semibold">{header.name}</dt>
            <dd className="inline before:content-[':_']">{t(header.valueKey)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
