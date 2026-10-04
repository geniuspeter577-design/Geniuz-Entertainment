import { isValidDateOfBirth } from './accountProfile';
export type AccountAuthClient = {
  signUp: (input: {
    email: string;
    password: string;
    options: { data: { display_name: string; date_of_birth: string }; emailRedirectTo?: string };
  }) => Promise<{ data: { session: unknown }; error: unknown | null }>;
  signInWithPassword: (input: { email: string; password: string }) => Promise<{
    data: { session: unknown };
    error: unknown | null;
  }>;
  resend: (input: { type: 'signup'; email: string }) => Promise<{ error: unknown | null }>;
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
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  if (
    code.includes('weak_password') ||
    message.includes('password should be at least') ||
    message.includes('password is too weak')
  ) {
    return 'Use a password with at least 8 characters.';
  }
  if (
    code.includes('email_address_invalid') ||
    code.includes('invalid_email') ||
    message.includes('email address is invalid') ||
    message.includes('invalid email')
  ) {
    return 'Enter a valid email address.';
  }
  if (
    code.includes('provider_disabled') ||
    code.includes('unsupported_provider') ||
    message.includes('provider is not enabled')
  ) {
    return 'Google sign-in is not configured. Use email and password or contact support.';
  }
  if (
    status === 429 ||
    code.includes('rate_limit') ||
    code.includes('too_many') ||
    message.includes('too many requests') ||
    message.includes('rate limit')
  ) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes('service unavailable') ||
    message.includes('gateway timeout')
  ) {
    return 'The account service is temporarily unavailable. Please wait a moment and retry.';
  }
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
  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    message.includes('user already registered') ||
    message.includes('already been registered')
  ) {
    return 'An account with this email already exists. Sign in instead.';
  }
  return 'Your account request could not be completed. Check your details and try again.';
}

function getAuthErrorMetadata(error: unknown) {
  const candidate = typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : {};
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
    name: typeof candidate.name === 'string'
      ? candidate.name
      : error instanceof Error
        ? error.name
        : undefined,
    message: sanitizeAuthLogMessage(
      typeof candidate.message === 'string'
        ? candidate.message
        : error instanceof Error
          ? error.message
          : undefined,
    ),
  };
}

function sanitizeAuthLogMessage(message?: string) {
  return message
    ?.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:access|refresh|id)[_-]?token\s*[:=]\s*\S+/gi, '[token redacted]')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[token redacted]')
    .slice(0, 240);
}

export function logAuthErrorContext(label: string, error: unknown) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.warn(`[Auth:${label}] Supabase error`, getAuthErrorMetadata(error));
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function createAccount(
  auth: AccountAuthClient,
  email: string,
  password: string,
  displayName: string,
  dateOfBirth: string,
  emailRedirectTo?: string,
) {
  const normalizedEmail = email.trim();
  if (!isValidEmail(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }
  if (password.length < 8) {
    throw new Error('Use a password with at least 8 characters.');
  }
  if (displayName.trim().length < 1 || displayName.trim().length > 80) {
    throw new Error('Display name must be between 1 and 80 characters.');
  }
  if (!isValidDateOfBirth(dateOfBirth)) {
    throw new Error('Enter a valid date of birth in YYYY-MM-DD format.');
  }
  try {
    const { data, error } = await auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { display_name: displayName.trim(), date_of_birth: dateOfBirth },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
    if (error) {
      throw error;
    }
    return { hasSession: Boolean(data.session) };
  } catch (error) {
    logAuthErrorContext('signUp', error);
    throw new Error(getFriendlyAuthError(error));
  }
}

export async function signInToAccount(auth: AccountAuthClient, email: string, password: string) {
  const normalizedEmail = email.trim();
  if (!isValidEmail(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }
  try {
    const { data, error } = await auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) {
      throw error;
    }
    if (!data?.session) {
      throw new Error('Supabase sign-in returned no session.');
    }
  } catch (error) {
    logAuthErrorContext('signIn', error);
    throw new Error(getFriendlyAuthError(error));
  }
}

export async function resendConfirmation(auth: AccountAuthClient, email: string) {
  const normalizedEmail = email.trim();
  if (!isValidEmail(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }
  try {
    const { error } = await auth.resend({ type: 'signup', email: normalizedEmail });
    if (error) {
      throw error;
    }
  } catch (error) {
    logAuthErrorContext('resendConfirmation', error);
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
  const normalizedEmail = email.trim();
  if (!isValidEmail(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }
  try {
    const { error } = await auth.resetPasswordForEmail(normalizedEmail, redirectTo ? { redirectTo } : undefined);
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
