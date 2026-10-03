const {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} = require('@aws-sdk/client-s3');

const requiredSettings = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];

function reportFailure(operation, error) {
  const status = error?.$metadata?.httpStatusCode;
  const denied =
    status === 403 ||
    error?.name === 'AccessDenied' ||
    error?.Code === 'AccessDenied';

  if (denied) {
    if (operation === 'PutBucketCors') {
      console.error('FAILURE: The Backblaze application key lacks permission to change CORS rules.');
      return;
    }
    console.error(`FAILURE: Backblaze denied ${operation} (AccessDenied/403).`);
    return;
  }
  console.error(`FAILURE: ${operation} failed (${error?.name || 'unknown error'}).`);
}

function printRules(label, rules) {
  if (!rules?.length) {
    console.log(`${label}: no bucket CORS rules are configured.`);
    return;
  }
  console.log(`${label}:`);
  console.log(JSON.stringify(rules, null, 2));
}

function normalizeOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('CORS_ORIGIN contains an invalid HTTP(S) origin.');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('CORS_ORIGIN contains an invalid HTTP(S) origin.');
  }
  return parsed.origin;
}

function buildAllowedOrigins({
  codespaceName = process.env.CODESPACE_NAME,
  corsOrigin = process.env.CORS_ORIGIN,
} = {}) {
  const normalizedCodespaceName = codespaceName?.trim();
  if (!normalizedCodespaceName) {
    throw new Error('CODESPACE_NAME is required to build the current Codespaces origin.');
  }

  const configuredOrigins = (corsOrigin ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
  const codespacesOrigin = normalizeOrigin(
    `https://${normalizedCodespaceName}-8081.app.github.dev`,
  );
  return [...new Set([
    ...configuredOrigins,
    codespacesOrigin,
    'http://localhost:8081',
    'http://localhost:19006',
  ])];
}

async function main() {
  if (process.argv.length > 2) {
    console.error('Usage: npm run b2:cors');
    process.exitCode = 2;
    return;
  }

  const missingSettings = requiredSettings.filter((name) => !process.env[name]?.trim());
  if (missingSettings.length > 0) {
    console.error(`Missing required backend settings: ${missingSettings.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  let allowedOrigins;
  try {
    allowedOrigins = buildAllowedOrigins();
  } catch (error) {
    console.error(`FAILURE: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT.trim(),
    region: process.env.S3_REGION.trim(),
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID.trim(),
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY.trim(),
    },
  });
  const bucket = process.env.S3_BUCKET.trim();
  const corsRule = {
    AllowedOrigins: allowedOrigins,
    AllowedMethods: ['HEAD', 'GET', 'PUT'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['etag'],
    MaxAgeSeconds: 3600,
  };

  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: [corsRule] },
      }),
    );
  } catch (error) {
    reportFailure('PutBucketCors', error);
    process.exitCode = 1;
    return;
  }

  try {
    const updated = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    printRules('Final bucket CORS rules', updated.CORSRules);
    console.log('SUCCESS: Backblaze bucket CORS rules updated and verified.');
  } catch (error) {
    reportFailure('GetBucketCors verification', error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAILURE: B2 CORS command failed (${error?.name || 'unknown error'}).`);
    process.exitCode = 1;
  });
}

module.exports = { buildAllowedOrigins };
