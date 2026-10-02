import type { ConnectionTestResult } from '@shapio/client';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type TestResultProps = { result: ConnectionTestResult };

/** Each check of a connection test, passed or failed, with the provider's message. */
export const TestResult = ({ result }: TestResultProps) => {
  const { t } = useTranslation();
  return (
    <Alert variant={result.ok ? 'success' : 'destructive'}>
      {result.ok ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
      <AlertTitle>
        {result.ok ? t('publishing.deployments.testPassed') : t('publishing.deployments.testFailed')}
      </AlertTitle>
      <AlertDescription>
        <ul className="space-y-1">
          {result.checks.map((check) => (
            <li key={check.name}>
              <span className="font-medium">
                {check.ok
                  ? t('publishing.deployments.checkPassed', { name: check.name })
                  : t('publishing.deployments.checkFailed', { name: check.name })}
              </span>
              {check.message ? <span className="block">{check.message}</span> : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
};
