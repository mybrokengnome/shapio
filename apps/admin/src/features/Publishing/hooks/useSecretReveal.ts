import { useEffect, useEffectEvent, useState } from 'react';

type Revealed = { id: string; secret: string };

/**
 * A secret created on this page (a webhook's or a connection's signing secret), shown once in a
 * `SecretReveal` at the top of the page, never through a URL. Dismissing it runs `onDismissed` with the
 * record's ID (to open it) only after the reveal, and its "leave without saving the secret?" guard, has
 * unmounted, so that navigation isn't stopped by the guard.
 */
export const useSecretReveal = (onDismissed: (id: string) => void) => {
  const [revealed, setRevealed] = useState<Revealed | undefined>(undefined);
  const [dismissedId, setDismissedId] = useState<string | undefined>(undefined);
  const afterDismiss = useEffectEvent((id: string) => onDismissed(id));
  useEffect(() => {
    if (dismissedId) {
      afterDismiss(dismissedId);
    }
  }, [dismissedId]);
  return {
    revealed,
    reveal: setRevealed,
    dismiss: () => {
      setDismissedId(revealed?.id);
      setRevealed(undefined);
    },
    /** For the create sheet's `onCloseAutoFocus`: focus stays on the reveal's copy button. */
    keepFocusOnReveal: (event: Event) => {
      if (revealed) {
        event.preventDefault();
      }
    },
  };
};
