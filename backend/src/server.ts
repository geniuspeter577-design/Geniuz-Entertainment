import { ensureRequiredBackendEnv, loadConfig } from './config/config';
import { createApiServer } from './http/server';
import { TMDBContentRepository } from './repositories/TMDBContentRepository';
import { HttpTMDBProvider } from './providers/TMDBProvider';
import { ContentService } from './services/ContentService';
import { MembershipService } from './services/MembershipService';

ensureRequiredBackendEnv(process.env);

const config = loadConfig();
const provider = new HttpTMDBProvider(config);
const contentRepository = new TMDBContentRepository(
  provider,
  config.cacheTtlSeconds * 1_000,
);
const contentService = new ContentService(contentRepository, config.cacheTtlSeconds * 1_000);
const membershipService = new MembershipService(config);
const server = createApiServer(config, contentService, { membershipService });

let membershipMaintenanceTimer: NodeJS.Timeout | undefined;
if (config.paystackSecretKey?.startsWith('sk_test_') && config.supabaseServiceRoleKey) {
  const runDailyMaintenance = () => {
    void membershipService.runDailyMaintenance().catch((error: unknown) => {
      console.error('[Membership] Daily maintenance failed.', {
        code: error instanceof Error ? error.name : 'UNKNOWN',
      });
    });
  };
  runDailyMaintenance();
  membershipMaintenanceTimer = setInterval(runDailyMaintenance, 24 * 60 * 60 * 1_000);
  membershipMaintenanceTimer.unref();
}

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[Geniuz API] Listening on port ${config.port}.`);
});

function shutdown() {
  if (membershipMaintenanceTimer) {
    clearInterval(membershipMaintenanceTimer);
  }
  server.close((error) => {
    if (error) {
      console.error('[Geniuz API] Failed to shut down cleanly.');
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
