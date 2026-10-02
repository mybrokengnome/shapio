import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { ThemeMenu } from '../ThemeMenu';
import { Wordmark } from '../Wordmark';
import { BrandPanel } from './BrandPanel';

type AuthLayoutProps = { title: string; description?: string; children: ReactNode };

/**
 * Frame for the signed-out screens (setup, sign in, invitation, password reset): the cobalt brand panel on
 * the left from lg up, the form card (420px) on the right. Below lg the panel gives way to a compact header.
 */
export const AuthLayout = ({ title, description, children }: AuthLayoutProps) => (
  <div className="flex min-h-svh bg-background">
    <BrandPanel />
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 items-center justify-end px-4 sm:px-8">
        <Wordmark className="mr-auto lg:hidden" />
        <ThemeMenu />
      </header>
      <main
        id="main"
        className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:items-center sm:px-8 sm:pt-0"
      >
        <Card className="w-full max-w-105">
          <CardHeader>
            <h1 className="text-title">{title}</h1>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </main>
    </div>
  </div>
);
