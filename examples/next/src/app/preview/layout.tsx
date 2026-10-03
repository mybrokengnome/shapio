import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../site.css';

/** Drafts are never indexed, and the token in the URL is never sent on as a Referer. */
export const metadata: Metadata = {
  title: 'Preview',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
  icons: '/favicon.svg',
};

/** The preview's own root layout (outside `[locale]`): the draft renders client-side with the token. */
const PreviewLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body>{children}</body>
  </html>
);

export default PreviewLayout;
