import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createQueryClient } from '../queryClient';
import { createAppRouter } from '../router';

/** Providers: TanStack Query (server state) and the router. Theme, i18n and toasts live in RootLayout/main. */
export const App = () => {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter(queryClient));
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};
