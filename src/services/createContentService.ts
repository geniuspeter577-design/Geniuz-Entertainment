import { ApiClient } from '../api/ApiClient';
import { GeniuzContentRepository } from '../repositories/GeniuzContentRepository';
import { MockContentRepository } from '../repositories/MockContentRepository';
import { logger } from '../utils/logger';
import { ContentService } from './ContentService';

const geniuzApiUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim();
const mockRepository = new MockContentRepository();
let apiWakeupClient: ApiClient | undefined;

function createContentService() {
  if (!geniuzApiUrl) {
    return new ContentService(mockRepository);
  }

  try {
    const apiClient = new ApiClient({ baseUrl: geniuzApiUrl });
    apiWakeupClient = new ApiClient({ baseUrl: geniuzApiUrl });
    return new ContentService(new GeniuzContentRepository(apiClient), mockRepository, true);
  } catch {
    logger.warn('[ContentService] Invalid EXPO_PUBLIC_GENIUZ_API_URL configuration.');
    return new ContentService(
      mockRepository,
      mockRepository,
      false,
      'The catalog API URL is invalid.',
    );
  }
}

export function prewarmContentApi() {
  void apiWakeupClient?.get('/health').catch(() => undefined);
}

export const contentService = createContentService();
