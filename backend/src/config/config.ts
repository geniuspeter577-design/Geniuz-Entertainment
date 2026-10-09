import videoConversionProfile from './videoConversionProfile.json';

export const REQUIRED_BACKEND_ENV_VARS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'CORS_ORIGIN',
] as const;

export type Config = {
  port: number;
  tmdbApiKey: string | undefined;
  footballDataApiKey?: string;
  paystackSecretKey?: string;
  flutterwaveSecretKey?: string;
  flutterwaveSecretHash?: string;
  flutterwaveRedirectUrl?: string;
  paymentProvider: 'paystack' | 'flutterwave';
  supabaseServiceRoleKey?: string;
  membershipCronSecret?: string;
  membershipPriceNgn: number;
  membershipGraceDays: number;
  subscription1500Enabled: boolean;
  // TODO: implement Paystack dedicated virtual accounts only when this is enabled.
  dedicatedAccountEnabled: boolean;
  tmdbBaseUrl: string;
  anilistApiUrl: string;
  corsOrigins: string[];
  cacheTtlSeconds: number;
  unusedMediaMinAgeHours: number;
  videoMaxrateKbps: number;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Bucket?: string;
};

function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Expected a positive integer environment setting.');
  }
  return parsed;
}

export function ensureRequiredBackendEnv(environment: NodeJS.ProcessEnv = process.env) {
  const missing = REQUIRED_BACKEND_ENV_VARS.filter(
    (name) => !environment[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(`Missing required backend environment variables: ${missing.join(', ')}`);
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const port = positiveInteger(environment.PORT, 4000);
  if (port > 65_535) {
    throw new Error('PORT must be between 1 and 65535.');
  }
  const cacheTtlSeconds = positiveInteger(environment.CATALOG_CACHE_TTL_SECONDS, 300);
  const unusedMediaMinAgeHours = positiveInteger(environment.UNUSED_MEDIA_MIN_AGE_HOURS, 24);
  const tmdbBaseUrl = environment.TMDB_BASE_URL?.trim() || 'https://api.themoviedb.org/3';

  let parsedTmdbBaseUrl: URL;
  try {
    parsedTmdbBaseUrl = new URL(tmdbBaseUrl);
  } catch {
    throw new Error('TMDB_BASE_URL must be a valid HTTPS URL.');
  }

  if (parsedTmdbBaseUrl.protocol !== 'https:') {
    throw new Error('TMDB_BASE_URL must use HTTPS.');
  }

  const allowCodespaces = (environment.CORS_ALLOW_CODESPACES ?? 'false').trim().toLowerCase() === 'true';
  const defaultCorsOrigins = [
    'http://localhost:8081',
    'http://localhost:19006',
    ...(allowCodespaces && environment.CODESPACE_NAME
      ? [`https://${environment.CODESPACE_NAME}-8081.app.github.dev`]
      : []),
  ];

  return {
    port,
    tmdbApiKey: environment.TMDB_API_KEY?.trim() || undefined,
    footballDataApiKey: environment.FOOTBALL_DATA_API_KEY?.trim() || undefined,
    paystackSecretKey: environment.PAYSTACK_SECRET_KEY?.trim() || undefined,
    flutterwaveSecretKey: environment.FLUTTERWAVE_SECRET_KEY?.trim() || undefined,
    flutterwaveSecretHash: environment.FLUTTERWAVE_SECRET_HASH?.trim() || undefined,
    flutterwaveRedirectUrl: environment.FLUTTERWAVE_REDIRECT_URL?.trim() || undefined,
    paymentProvider: environment.PAYMENT_PROVIDER?.trim().toLowerCase() === 'flutterwave' ? 'flutterwave' : 'paystack',
    supabaseServiceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
    membershipCronSecret: environment.MEMBERSHIP_CRON_SECRET?.trim() || undefined,
    membershipPriceNgn: positiveInteger(environment.MEMBERSHIP_PRICE_NGN, 900),
    membershipGraceDays: positiveInteger(environment.MEMBERSHIP_GRACE_DAYS, 3),
    subscription1500Enabled: (environment.SUBSCRIPTION_1500_ENABLED ?? 'false').trim().toLowerCase() === 'true',
    dedicatedAccountEnabled: (environment.DEDICATED_ACCOUNT_ENABLED ?? 'false').trim().toLowerCase() === 'true',
    tmdbBaseUrl: parsedTmdbBaseUrl.toString().replace(/\/+$/, ''),
    anilistApiUrl: environment.ANILIST_API_URL?.trim() || 'https://graphql.anilist.co',
    corsOrigins: (environment.CORS_ORIGIN ?? defaultCorsOrigins.join(','))
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cacheTtlSeconds,
    unusedMediaMinAgeHours,
    videoMaxrateKbps: positiveInteger(
      environment.VIDEO_MAXRATE_KBPS,
      videoConversionProfile.VIDEO_MAXRATE_KBPS,
    ),
    supabaseUrl: environment.SUPABASE_URL?.trim() || undefined,
    supabasePublishableKey:
      environment.SUPABASE_PUBLISHABLE_KEY?.trim() || undefined,
    s3Endpoint: environment.S3_ENDPOINT?.trim() || undefined,
    s3Region: environment.S3_REGION?.trim() || undefined,
    s3AccessKeyId: environment.S3_ACCESS_KEY_ID?.trim() || undefined,
    s3SecretAccessKey: environment.S3_SECRET_ACCESS_KEY?.trim() || undefined,
    s3Bucket: environment.S3_BUCKET?.trim() || undefined,
  };
}
