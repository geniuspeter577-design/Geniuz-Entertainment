const {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} = require('@aws-sdk/client-s3');

const apply = process.argv.includes('--apply');
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--apply');
if (unknownArguments.length > 0 || process.argv.filter((argument) => argument === '--apply').length > 1) {
  console.error('Usage: npm run b2:cors [-- --apply]');
  process.exit(2);
}

const requiredSettings = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
const missingSettings = requiredSettings.filter((name) => !process.env[name]?.trim());
if (missingSettings.length > 0) {
  console.error(`Missing required backend settings: ${missingSettings.join(', ')}`);
  process.exit(1);
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

function reportFailure(operation, error) {
  const status = error?.$metadata?.httpStatusCode;
  const denied =
    status === 403 ||
    error?.name === 'AccessDenied' ||
    error?.Code === 'AccessDenied';

  if (denied) {
    console.error(`Backblaze denied ${operation} (AccessDenied/403). No permission workaround was attempted.`);
    return;
  }
  console.error(`${operation} failed (${error?.name || 'unknown error'}).`);
}

function printRules(rules) {
  if (!rules?.length) {
    console.log('No bucket CORS rules are configured.');
    return;
  }
  console.log('Current bucket CORS rules:');
  console.log(JSON.stringify(rules, null, 2));
}

function getCodespacesOrigin() {
  const codespaceName = process.env.CODESPACE_NAME?.trim();
  const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN?.trim();
  if (!codespaceName || !forwardingDomain) {
    throw new Error('CODESPACE_NAME and GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN are required to apply the rule.');
  }

  try {
    return new URL(`https://${codespaceName}-8081.${forwardingDomain}`).origin;
  } catch {
    throw new Error('Could not construct the forwarded port-8081 origin from the Codespaces environment.');
  }
}

async function main() {
  let current;
  try {
    current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  } catch (error) {
    const errorCode = `${error?.name ?? ''} ${error?.Code ?? ''}`.toLowerCase();
    if (errorCode.includes('nosuchcorsconfiguration')) {
      current = { CORSRules: [] };
    } else {
      reportFailure('GetBucketCors', error);
      process.exitCode = 1;
      return;
    }
  }
  printRules(current.CORSRules);

  if (!apply) {
    return;
  }

  let corsOrigins;
  try {
    corsOrigins = [
      getCodespacesOrigin(),
      ...(process.env.CORS_ORIGIN ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ];
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const allowedOrigins = [...new Set(corsOrigins)];
  const corsRule = {
    AllowedOrigins: allowedOrigins,
    AllowedMethods: ['GET', 'HEAD', 'PUT'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  };

  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: [corsRule] },
      }),
    );
    console.log('Applied bucket CORS rule:');
    console.log(JSON.stringify(corsRule, null, 2));

    const updated = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    printRules(updated.CORSRules);
  } catch (error) {
    reportFailure('PutBucketCors', error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`B2 CORS command failed (${error?.name || 'unknown error'}).`);
  process.exitCode = 1;
});
