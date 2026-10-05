const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

const { createAccount, getAuthState, getFriendlyAuthError, logAuthErrorContext, resendConfirmation, runAccountFeatureGate, sendPasswordReset, signInToAccount, signOutOfAccount } = require('../.test-build/src/utils/accountAuth.js');
const { isValidProfileCreation } = require('../.test-build/src/utils/accountProfile.js');
const { getUsernameError, isValidDateOfBirth, isValidUsername, normalizeUsername } = require('../.test-build/src/utils/accountProfile.js');
const { isAccountProfile } = require('../.test-build/src/models/profile.js');
const {
  createChunkedSecureStorage,
  sanitizeSecureStoreKey,
  splitSecureValue,
} = require('../.test-build/src/utils/secureStorage.js');

function createAuth(overrides = {}) {
  return {
    signUp: async () => ({ data: { session: { user: { id: 'user-id' } } }, error: null }),
    signInWithPassword: async () => ({ data: { session: { user: { id: 'user-id' } } }, error: null }),
    resend: async () => ({ error: null }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ error: null }),
    ...overrides,
  };
}

test('auth state reads signed-in and admin state only from the authenticated session', () => {
  assert.deepEqual(getAuthState(null), { userId: null, isSignedIn: false, isAdmin: false });
  assert.deepEqual(getAuthState({ user: { id: 'user-id', app_metadata: { role: 'user' } } }), {
    userId: 'user-id', isSignedIn: true, isAdmin: false,
  });
  assert.deepEqual(getAuthState({ user: { id: 'admin-id', app_metadata: { role: 'admin' } } }), {
    userId: 'admin-id', isSignedIn: true, isAdmin: true,
  });
});

test('guest feature gating opens the reusable sign-in sheet while signed-in actions proceed', () => {
  let opens = 0;
  const openSheet = () => { opens += 1; };
  assert.equal(runAccountFeatureGate(false, openSheet), false);
  assert.equal(opens, 1);
  assert.equal(runAccountFeatureGate(true, openSheet), true);
  assert.equal(opens, 1);
});

test('account creation trims email and display name and reports email-confirmation state', async () => {
  let request;
  const auth = createAuth({
    signUp: async (input) => {
      request = input;
      return { data: { session: null }, error: null };
    },
  });
  assert.deepEqual(await createAccount(auth, ' person@example.test ', 'password-value', ' Name ', '1990-01-02', 'geniuz://auth/confirm'), {
    hasSession: false,
  });
  assert.deepEqual(request, {
    email: 'person@example.test',
    password: 'password-value',
    options: { data: { display_name: 'Name', date_of_birth: '1990-01-02' }, emailRedirectTo: 'geniuz://auth/confirm' },
  });
});

test('sign-in, sign-out, and password reset use Supabase Auth through mocked calls', async () => {
  const calls = [];
  const auth = createAuth({
    signInWithPassword: async (input) => { calls.push(['sign-in', input.email]); return { data: { session: {} }, error: null }; },
    resend: async (input) => { calls.push(['resend', input.email, input.type]); return { error: null }; },
    signOut: async () => { calls.push(['sign-out']); return { error: null }; },
    resetPasswordForEmail: async (email, options) => { calls.push(['reset', email, options]); return { error: null }; },
  });
  await signInToAccount(auth, ' user@example.test ', 'password');
  await resendConfirmation(auth, ' user@example.test ');
  await signOutOfAccount(auth);
  await sendPasswordReset(auth, ' user@example.test ', 'geniuz://auth/recovery');
  assert.deepEqual(calls, [
    ['sign-in', 'user@example.test'],
    ['resend', 'user@example.test', 'signup'],
    ['sign-out'],
    ['reset', 'user@example.test', { redirectTo: 'geniuz://auth/recovery' }],
  ]);
});

test('sign-in rejects a successful response without a Supabase session', async () => {
  const auth = createAuth({
    signInWithPassword: async () => ({ data: { session: null }, error: null }),
  });
  await assert.rejects(signInToAccount(auth, 'user@example.test', 'password'), /could not be completed/i);
});

test('account errors explain invalid credentials, unconfirmed email, network, and duplicate signup', () => {
  assert.match(getFriendlyAuthError({ code: 'invalid_credentials' }), /email or password is incorrect/i);
  assert.match(getFriendlyAuthError({ code: 'email_not_confirmed' }), /confirm your email/i);
  assert.match(getFriendlyAuthError(new TypeError('Network request failed')), /internet connection/i);
  assert.match(getFriendlyAuthError({ code: 'user_already_exists' }), /already exists/i);
  assert.match(getFriendlyAuthError({ code: 'weak_password' }), /at least 8 characters/i);
  assert.match(getFriendlyAuthError({ code: 'email_address_invalid' }), /valid email/i);
  assert.match(getFriendlyAuthError({ status: 429 }), /too many attempts/i);
});

test('auth error logging is dev-only and redacts email and token-like values', () => {
  const previousDev = global.__DEV__;
  const originalWarn = console.warn;
  const logged = [];
  try {
    global.__DEV__ = false;
    console.warn = (...args) => logged.push(args);
    logAuthErrorContext('test', { code: 'auth_error', message: 'request failed' });
    assert.equal(logged.length, 0);

    global.__DEV__ = true;
    logAuthErrorContext('test', {
      code: 'auth_error',
      status: 401,
      message: 'user@example.test Bearer abcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuv',
    });
    assert.equal(logged.length, 1);
    const serialized = JSON.stringify(logged[0]);
    assert.doesNotMatch(serialized, /user@example\.test|abcdefghijklmnopqrstuvwxyz/);
    assert.match(serialized, /auth_error/);
  } finally {
    console.warn = originalWarn;
    if (previousDev === undefined) {
      delete global.__DEV__;
    } else {
      global.__DEV__ = previousDev;
    }
  }
});

test('signup rejects malformed email and weak passwords before calling Supabase', async () => {
  let calls = 0;
  const auth = createAuth({ signUp: async () => { calls += 1; return { data: { session: null }, error: null }; } });
  await assert.rejects(createAccount(auth, 'invalid', 'long-enough-password', 'Name'), /valid email/i);
  await assert.rejects(createAccount(auth, 'person@example.test', 'short', 'Name'), /at least 8 characters/i);
  await assert.rejects(createAccount(auth, 'person@example.test', 'long-enough-password', 'Name', 'not-a-date'), /date of birth/i);
  assert.equal(calls, 0);
});

test('usernames normalize and enforce the documented profile format', () => {
  assert.equal(normalizeUsername('  @Geniuz_User  '), 'geniuz_user');
  assert.equal(isValidUsername('geniuz_user'), true);
  assert.equal(isValidUsername('1bad'), false);
  assert.match(getUsernameError('1bad'), /start with a letter/i);
});

test('date of birth accepts real non-future ISO dates only', () => {
  assert.equal(isValidDateOfBirth('1990-01-02'), true);
  assert.equal(isValidDateOfBirth('2020-02-30'), false);
  assert.equal(isValidDateOfBirth('3000-01-01'), false);
  assert.equal(isValidDateOfBirth('01-02-1990'), false);
});

test('profile creation and returned profile validation require the auth ID and short numeric public ID', () => {
  const input = {
    userId: '00000000-0000-4000-8000-000000000001',
    displayName: 'Geniuz User',
    publicId: '00123456',
  };
  assert.equal(isValidProfileCreation(input), true);
  assert.equal(isValidProfileCreation({ ...input, publicId: 'public-id' }), false);
  assert.equal(isValidProfileCreation({ ...input, displayName: '   ' }), false);
  const profile = {
    id: input.userId,
    display_name: input.displayName,
    avatar_color: '#72F06A',
    public_id: input.publicId,
    created_at: '2026-10-03T00:00:00Z',
    username: null,
    bio: '',
    avatar_url: null,
    date_of_birth: '1990-01-02',
  };
  assert.equal(isAccountProfile(profile, input.userId), true);
  assert.equal(isAccountProfile({ ...profile, id: 'another-user' }, input.userId), false);
});

test('new profile migration protects avatar ownership and adds short categories without fake titles', () => {
  const migration = fs.readFileSync('supabase/migrations/20261012000000_profile_editing_and_shorts.sql', 'utf8');
  assert.match(migration, /values \('avatars', 'avatars', true, 2097152/i);
  assert.match(migration, /name = auth\.uid\(\)::text \|\| '\/avatar\.jpg'/i);
  assert.match(migration, /is_username_available/i);
  assert.match(migration, /create table if not exists public\.account_deletion_requests/i);
  assert.match(migration, /check \(content_type in \('movie', 'series', 'short'\)\)/i);
  assert.match(migration, /values \('Anime'\), \('Kids'\), \('Shorts'\), \('TV'\), \('Nollywood'\), \('Football'\)/i);
  assert.doesNotMatch(migration, /insert into public\.movies/i);
});

test('Me screen avatar opens Edit profile and replaces the standalone edit link', () => {
  const screen = fs.readFileSync('app/(tabs)/profile.tsx', 'utf8');
  assert.match(
    screen,
    /<Pressable[\s\S]*?accessibilityLabel="Edit profile"[\s\S]*?onPress=\{\(\) => router\.push\('\/edit-profile'\)\}[\s\S]*?styles\.avatarButton/,
  );
  assert.match(screen, /styles\.avatarEditBadge/);
  assert.doesNotMatch(screen, /<Text[^>]*>\s*Edit profile\s*<\/Text>/);
});

test('date-of-birth migration stores private dates and limits completion to the authenticated user', () => {
  const migration = fs.readFileSync('supabase/migrations/20261014000000_profile_date_of_birth.sql', 'utf8');
  assert.match(migration, /add column if not exists date_of_birth date/i);
  assert.match(migration, /revoke update on table public\.profiles from authenticated/i);
  assert.match(migration, /grant update \(display_name, username, bio, avatar_url\)/i);
  assert.match(migration, /new\.raw_user_meta_data ->> 'date_of_birth'/i);
  assert.match(migration, /function public\.complete_profile_date_of_birth\(requested_date date\)/i);
  assert.match(migration, /where id = auth\.uid\(\)[\s\S]*date_of_birth is null/i);
});

test('Animation migration adds the category without restricting free-form categories', () => {
  const migration = fs.readFileSync('supabase/migrations/20261015000000_animation_category.sql', 'utf8');
  assert.match(migration, /insert into public\.content_categories \(name\)[\s\S]*values \('Animation'\)[\s\S]*on conflict \(name\) do nothing/i);
});

test('SecureStore adapter chunks large UTF-8 sessions, replaces old chunks, and removes the whole value', async () => {
  const values = new Map();
  const secureStoreKeys = [];
  const validateKey = (key) => {
    assert.match(key, /^[A-Za-z0-9._-]+$/);
    secureStoreKeys.push(key);
  };
  const store = {
    getItemAsync: async (key) => { validateKey(key); return values.get(key) ?? null; },
    setItemAsync: async (key, value) => { validateKey(key); values.set(key, value); },
    deleteItemAsync: async (key) => { validateKey(key); values.delete(key); },
  };
  const secureStorage = createChunkedSecureStorage(store, 48);
  const session = `${'session-token-'.repeat(40)}${'🔐'.repeat(40)}`;
  const chunks = splitSecureValue(session, 48);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 48));
  await secureStorage.setItem('sb-project/auth:token', session);
  assert.equal(await secureStorage.getItem('sb-project/auth:token'), session);
  await secureStorage.setItem('sb-project/auth:token', 'short');
  assert.equal(await secureStorage.getItem('sb-project/auth:token'), 'short');
  assert.ok([...values.keys()].every((key) => /^[A-Za-z0-9._-]+$/.test(key)));
  assert.equal([...values.keys()].some((key) => key.includes(':secure-chunk:')), false);
  await secureStorage.removeItem('sb-project/auth:token');
  assert.equal(await secureStorage.getItem('sb-project/auth:token'), null);
  assert.ok(secureStoreKeys.every((key) => /^[A-Za-z0-9._-]+$/.test(key)));
});

test('SecureStore key sanitizing preserves valid keys and replaces invalid characters', () => {
  assert.equal(sanitizeSecureStoreKey('sb-project.auth_token-1'), 'sb-project.auth_token-1');
  assert.equal(sanitizeSecureStoreKey('sb:project/auth@ token'), 'sb_project_auth__token');
  assert.equal(sanitizeSecureStoreKey(''), 'secure-store-key');
  assert.match(sanitizeSecureStoreKey(':/@'), /^[A-Za-z0-9._-]+$/);
});

test('profile migration creates user-owned profiles on signup and grants no public insert policy', () => {
  const migration = fs.readFileSync('supabase/migrations/20261011000000_user_profiles.sql', 'utf8');
  assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
  assert.match(migration, /public_id text not null unique check \(public_id ~ '\^\[0-9\]\{8\}\$'\)/i);
  assert.match(migration, /after insert on auth\.users/i);
  assert.match(migration, /using \(id = auth\.uid\(\)\)/i);
  assert.match(migration, /with check \(id = auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on table public\.profiles from anon, authenticated/i);
  assert.doesNotMatch(migration, /grant insert[\s\S]{0,80}to anon/i);
});
