export type AccountAuthClient = {
  signUp: (input: {
    email: string;
    password: string;
    options: { data: { display_name: string }; emailRedirectTo?: string };
  }) => Promise<{ data: { session: unknown }; error: unknown | null }>;
  signInWithPassword: (input: { email: string; password: string }) => Promise<{
    data: { session: unknown };
    error: unknown | null;
  }>;
  signOut: () => Promise<{ error: unknown | null }>;
  resetPasswordForEmail: (email: string, options?: { redirectTo?: string }) => Promise<{ error: unknown | null }>;
};

export function getAuthState(session: { user: { id: string; app_metadata?: unknown } } | null) {
  return {
    userId: session?.user.id ?? null,
    isSignedIn: Boolean(session),
    isAdmin: Boolean(
      typeof session?.user.app_metadata === 'object' &&
      session.user.app_metadata !== null &&
      'role' in session.user.app_metadata &&
      session.user.app_metadata.role === 'admin',
    ),
  };
}

export function getFriendlyAuthError(error: unknown) {
  const candidate = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Confirm your email before signing in. Check your inbox for the confirmation link.';
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'Email or password is incorrect. Check both and try again.';
  }
  if (
    name.includes('fetch') ||
    name.includes('network') ||
    message.includes('network request failed') ||
    message.includes('failed to fetch')
  ) {
    return 'Could not connect. Check your internet connection and try again.';
  }
  if (code === 'user_already_exists' || message.includes('user already registered')) {
    return 'An account with this email already exists. Sign in instead.';
  }
  return 'Your account request could not be completed. Check your details and try again.';
}

export async function createAccount(
  auth: AccountAuthClient,
  email: string,
  password: string,
  displayName: string,
  emailRedirectTo?: string,
) {
  try {
    const { data, error } = await auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: displayName.trim() },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
    if (error) {
      throw error;
    }
    return { hasSession: Boolean(data.session) };
  } catch (error) {
    throw new Error(getFriendlyAuthError(error));
  }
}

export async function signInToAccount(auth: AccountAuthClient, email: string, password: string) {
  try {
    const { error } = await auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      throw error;
    }
  } catch (error) {
    throw new Error(getFriendlyAuthError(error));
  }
}

export async function signOutOfAccount(auth: AccountAuthClient) {
  try {
    const { error } = await auth.signOut();
    if (error) {
      throw error;
    }
  } catch (error) {
    throw new Error(getFriendlyAuthError(error));
  }
}

export async function sendPasswordReset(auth: AccountAuthClient, email: string, redirectTo?: string) {
  try {
    const { error } = await auth.resetPasswordForEmail(email.trim(), redirectTo ? { redirectTo } : undefined);
    if (error) {
      throw error;
    }
  } catch (error) {
    throw new Error(getFriendlyAuthError(error));
  }
}

export function runAccountFeatureGate(isSignedIn: boolean, openSignInSheet: () => void) {
  if (isSignedIn) {
    return true;
  }
  openSignInSheet();
  return false;
}

export function getProfileInitial(displayName: string | null | undefined, email: string | null | undefined) {
  const value = displayName?.trim() || email?.trim() || 'Geniuz+';
  return Array.from(value)[0]?.toLocaleUpperCase() ?? 'G';
}
