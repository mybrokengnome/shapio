import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

const readFragmentToken = () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? undefined;

/**
 * The single-use token from an emailed link (`…/reset-password#token=…`). It travels in the URL fragment so
 * it never reaches a server log; once read into memory it is removed from the address bar and history
 * entry, so it can't leak through bookmarks, screenshots or the back button.
 */
export const useFragmentToken = (): string | undefined => {
  const router = useRouter();
  const [token] = useState(readFragmentToken);
  useEffect(() => {
    if (window.location.hash) {
      router.history.replace(`${window.location.pathname}${window.location.search}`);
    }
  }, [router]);
  return token;
};
