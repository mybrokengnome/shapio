import { useEffect, useState } from 'react';
import { httpOriginOf } from '../helpers/previewFrame';

/**
 * Whether the admin's CSP blocked the preview frame: the page's `frame-src` was set when the admin loaded, so a
 * site connected since then needs a reload of the admin before it can be shown.
 */
export const useFrameBlocked = (origin: string | undefined): boolean => {
  const [blockedOrigin, setBlockedOrigin] = useState<string | undefined>();
  useEffect(() => {
    if (!origin) {
      return undefined;
    }
    const onViolation = (event: SecurityPolicyViolationEvent) => {
      if (/^(frame|child)-src/.test(event.effectiveDirective) && httpOriginOf(event.blockedURI) === origin) {
        setBlockedOrigin(origin);
      }
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => document.removeEventListener('securitypolicyviolation', onViolation);
  }, [origin]);
  return origin !== undefined && blockedOrigin === origin;
};
