export type Config = {
  port: number;
  tmdbApiKey: string | undefined;
  tmdbBaseUrl: string;
  anilistApiUrl: string;
  corsOrigins: string[];
  cacheTtlSeconds: number;
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

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const port = positiveInteger(environment.PORT, 4000);
  if (port > 65_535) {
    throw new Error('PORT must be between 1 and 65535.');
  }
  const cacheTtlSeconds = positiveInteger(environment.CATALOG_CACHE_TTL_SECONDS, 300);
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

  return {
    port,
    tmdbApiKey: environment.TMDB_API_KEY?.trim() || undefined,
    tmdbBaseUrl: parsedTmdbBaseUrl.toString().replace(/\/+$/, ''),
    anilistApiUrl: environment.ANILIST_API_URL?.trim() || 'https://graphql.anilist.co',
    corsOrigins: (environment.CORS_ORIGIN ?? 'http://localhost:8081,http://localhost:19006')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cacheTtlSeconds,
    supabaseUrl: environment.SUPABASE_URL?.trim() || environment.EXPO_PUBLIC_SUPABASE_URL?.trim() || undefined,
    supabasePublishableKey:
      environment.SUPABASE_PUBLISHABLE_KEY?.trim() ||
      environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
      undefined,
    s3Endpoint: environment.S3_ENDPOINT?.trim() || undefined,
    s3Region: environment.S3_REGION?.trim() || undefined,
    s3AccessKeyId: environment.S3_ACCESS_KEY_ID?.trim() || undefined,
    s3SecretAccessKey: environment.S3_SECRET_ACCESS_KEY?.trim() || undefined,
    s3Bucket: environment.S3_BUCKET?.trim() || undefined,
  };
}
