import { ensureRequiredBackendEnv, loadConfig } from './config/config';
import { createApiServer } from './http/server';
import { TMDBContentRepository } from './repositories/TMDBContentRepository';
import { HttpTMDBProvider } from './providers/TMDBProvider';
import { ContentService } from './services/ContentService';

ensureRequiredBackendEnv(process.env);

const config = loadConfig();
const provider = new HttpTMDBProvider(config);
const contentRepository = new TMDBContentRepository(
  provider,
  config.cacheTtlSeconds * 1_000,
);
const contentService = new ContentService(contentRepository, config.cacheTtlSeconds * 1_000);
const server = createApiServer(config, contentService);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[Geniuz API] Listening on port ${config.port}.`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error('[Geniuz API] Failed to shut down cleanly.');
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
