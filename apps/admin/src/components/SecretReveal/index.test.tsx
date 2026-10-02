// @vitest-environment jsdom
import '@/test/dom';
import {
  Link,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SecretReveal } from '.';

const SECRET = 'shp_live_8f3a2c';

/** The reveal on `/` with a link away (any registered path; `/models` here), inside a real router so the leave guard (useBlocker) runs. */
const renderInRouter = (onDismiss: () => void) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const tokensRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <SecretReveal
          title="Copy your new token"
          description="It's shown only this once."
          label="Token"
          secret={SECRET}
          onDismiss={onDismiss}
        />
        <Link to="/models">Go elsewhere</Link>
      </>
    ),
  });
  const elsewhereRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/models',
    component: () => <h1>Elsewhere</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tokensRoute, elsewhereRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return router;
};

describe('SecretReveal', () => {
  it('is a region named by its title showing the secret read-only, with focus on Copy', async () => {
    renderInRouter(() => {});
    const region = await screen.findByRole('region', { name: 'Copy your new token' });
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Token' });
    expect(region.contains(field)).toBe(true);
    expect(field.value).toBe(SECRET);
    expect(field.readOnly).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy' })));
  });

  it('copies the secret to the clipboard', async () => {
    const user = userEvent.setup();
    renderInRouter(() => {});
    await user.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeDefined();
  });

  it('dismisses with the saved button', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderInRouter(onDismiss);
    await user.click(await screen.findByRole('button', { name: "I've saved it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('asks before navigating away while it is shown: Stay keeps it, Leave goes', async () => {
    const user = userEvent.setup();
    const router = renderInRouter(() => {});
    await user.click(await screen.findByRole('link', { name: 'Go elsewhere' }));
    const prompt = await screen.findByRole('alertdialog', { name: 'Leave without saving the secret?' });
    await user.click(screen.getByRole('button', { name: 'Stay and copy it' }));
    await waitFor(() => expect(prompt.isConnected).toBe(false));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('textbox', { name: 'Token' })).toBeDefined();

    await user.click(screen.getByRole('link', { name: 'Go elsewhere' }));
    await user.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeDefined();
  });
});
