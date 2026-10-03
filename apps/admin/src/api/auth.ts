import type {
  AcceptInvitationInput,
  ChangePasswordInput,
  GlobalAction,
  LoginInput,
  MeResponse,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  SessionStarted,
  SetupInput,
  SetupStatusResponse,
  UpdateProfileInput,
} from '@shapio/client';
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { currentSite, leaveUnknownSite } from '@/app/currentSite';
import { adminApi } from './client';
import { resetCsrfToken, setCsrfToken, withCsrf } from './csrf';
import { hasErrorCode, isUnauthorized } from './errors';
import { queryKeys } from './queryKeys';

/** The signed-in admin, or `null` when there is no valid session (401 is an answer, not an error). */
export const meQueryOptions = queryOptions({
  queryKey: queryKeys.me,
  queryFn: async (): Promise<MeResponse | null> => {
    try {
      const me = await adminApi.auth.me();
      setCsrfToken(me.csrfToken);
      return me;
    } catch (error) {
      if (isUnauthorized(error)) {
        return null;
      }
      // A remembered site that no longer exists: start again without it. A site named in the URL is the
      // visitor's own request, so the route shows that it doesn't exist instead.
      if (hasErrorCode(error, 'SITE_NOT_FOUND') && !currentSite().explicit) {
        leaveUnknownSite();
        return new Promise<never>(() => undefined);
      }
      throw error;
    }
  },
  staleTime: 60_000,
});

export const setupStatusQueryOptions = queryOptions({
  queryKey: queryKeys.setupStatus,
  queryFn: () => adminApi.setup.status(),
  staleTime: Infinity,
});

export const useMe = () => useQuery(meQueryOptions);

/** First-run status: whether setup is pending and whether it needs the logged setup token. */
export const useSetupStatus = () => useQuery(setupStatusQueryOptions);

/**
 * A new session replaces whatever was cached for the previous one. The profile (roles, permissions) is
 * loaded before the caller navigates, so the shell renders with it.
 */
const startSession = async (queryClient: QueryClient, started: SessionStarted) => {
  setCsrfToken(started.csrfToken);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
  queryClient.setQueryData(queryKeys.setupStatus, (previous: SetupStatusResponse | undefined) => ({
    requiresToken: false,
    ...previous,
    required: false,
  }));
  await queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 });
};

const silent = { silent: true } as const;

export const useLogin = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['auth', 'login'],
    meta: silent,
    mutationFn: (input: LoginInput) => withCsrf(() => adminApi.auth.login(input)),
    onSuccess: (started) => startSession(queryClient, started),
  });
};

export const useSetup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['setup'],
    meta: silent,
    mutationFn: (input: SetupInput) => withCsrf(() => adminApi.setup.complete(input)),
    onSuccess: (started) => startSession(queryClient, started),
  });
};

export const useAcceptInvitation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['auth', 'acceptInvitation'],
    meta: silent,
    mutationFn: (input: AcceptInvitationInput) => withCsrf(() => adminApi.invitations.accept(input)),
    onSuccess: (started) => startSession(queryClient, started),
  });
};

export const useLogout = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['auth', 'logout'],
    mutationFn: () => withCsrf(() => adminApi.auth.logout()),
    // Signed out either way: forget the user (the shell then leaves for sign-in) and every cached answer.
    // `me` is set rather than removed so mounted observers see the change.
    onSettled: () => {
      resetCsrfToken();
      queryClient.setQueryData(queryKeys.me, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
    },
  });
};

export const useRequestPasswordReset = () =>
  useMutation({
    mutationKey: ['auth', 'requestPasswordReset'],
    meta: silent,
    mutationFn: (input: PasswordResetRequestInput) =>
      withCsrf(() => adminApi.auth.requestPasswordReset(input)),
  });

/** Who an invitation is for, so the form can show it. Public, read-only; the token travels in the body. */
export const useInspectInvitation = (token: string | undefined) =>
  useQuery({
    queryKey: queryKeys.invitationInspect(token ?? ''),
    queryFn: () => adminApi.invitations.inspect(token ?? ''),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
    meta: { silent: true },
  });

export const useConfirmPasswordReset = () =>
  useMutation({
    mutationKey: ['auth', 'confirmPasswordReset'],
    meta: silent,
    mutationFn: (input: PasswordResetConfirmInput) =>
      withCsrf(() => adminApi.auth.confirmPasswordReset(input)),
  });

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['auth', 'updateProfile'],
    meta: silent,
    mutationFn: (input: UpdateProfileInput) => withCsrf(() => adminApi.auth.updateProfile(input)),
    onSuccess: (user) =>
      queryClient.setQueryData(queryKeys.me, (current: MeResponse | null | undefined) =>
        current ? { ...current, user } : current,
      ),
  });
};

export const useChangePassword = () =>
  useMutation({
    mutationKey: ['auth', 'changePassword'],
    meta: silent,
    mutationFn: (input: ChangePasswordInput) => withCsrf(() => adminApi.auth.changePassword(input)),
    // The server rotates the session (and its CSRF secret) after a password change.
    onSuccess: ({ csrfToken }) => setCsrfToken(csrfToken),
  });

/** Whether the signed-in admin holds an instance-level permission (users, roles, tokens, audit). */
export const useHasGlobalPermission = (action: GlobalAction) => {
  const { data: me } = useMe();
  return me?.globalPermissions.includes(action) ?? false;
};
