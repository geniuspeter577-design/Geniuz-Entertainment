import { ApiClient } from '../api/ApiClient';
import { GeniuzContentRepository } from '../repositories/GeniuzContentRepository';
import { MockContentRepository } from '../repositories/MockContentRepository';
import { ContentService } from './ContentService';

const geniuzApiUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim();
const mockRepository = new MockContentRepository();

function createContentService() {
  if (!geniuzApiUrl) {
    return new ContentService(mockRepository);
  }

  try {
    const apiClient = new ApiClient({ baseUrl: geniuzApiUrl });
    return new ContentService(new GeniuzContentRepository(apiClient), mockRepository, true);
  } catch (error) {
    console.error('[ContentService] Invalid EXPO_PUBLIC_GENIUZ_API_URL configuration.', error);
    return new ContentService(
      mockRepository,
      mockRepository,
      false,
      'The catalog API URL is invalid. Showing the local development catalog.',
    );
  }
}

export const contentService = createContentService();
