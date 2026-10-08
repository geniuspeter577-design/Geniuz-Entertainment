import { createClient } from '@supabase/supabase-js';

import type { Config } from '../config/config';
import { HttpError } from './errors';

export function requireAdminRole(appMetadata: unknown) {
  if (
    typeof appMetadata !== 'object' ||
    appMetadata === null ||
    !('role' in appMetadata) ||
    appMetadata.role !== 'admin'
  ) {
    throw new HttpError(403, 'ADMIN_REQUIRED', 'Admin access is required.');
  }
}

export function requirePublishedOrAdmin(published: boolean, isAdmin: boolean) {
  if (!published && !isAdmin) {
    throw new HttpError(403, 'ADMIN_REQUIRED', 'Admin access is required.');
  }
}

export async function authenticatePlayback(
  config: Config,
  authorization: string | undefined,
) {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new HttpError(503, 'SUPABASE_NOT_CONFIGURED', 'Supabase authentication is not configured.');
  }

  const accessToken = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (authorization && !accessToken) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'A valid Supabase access token is required.');
  }

  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });

  if (!accessToken) {
    return { client, isAdmin: false, userId: undefined };
  }

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'A valid Supabase access token is required.');
  }

  return {
    client,
    isAdmin: data.user.app_metadata?.role === 'admin',
    userId: data.user.id,
  };
}

export async function authenticateAdmin(config: Config, authorization: string | undefined) {
  const accessToken = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!accessToken) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'A valid Supabase access token is required.');
  }
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new HttpError(503, 'SUPABASE_NOT_CONFIGURED', 'Supabase authentication is not configured.');
  }

  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'A valid Supabase access token is required.');
  }

  requireAdminRole(data.user.app_metadata);
  return { accessToken, client, userId: data.user.id };
}
