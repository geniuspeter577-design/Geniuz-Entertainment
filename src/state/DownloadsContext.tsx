import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { ContentItem } from '../models/content';
import { supabaseMovieRepository } from '../repositories/SupabaseMovieRepository';
import {
  OfflineDownloadService,
  type OfflineDownloadRecord,
} from '../services/OfflineDownloadService';

function getSafeFileName(item: ContentItem) {
  const sourceId = (item.sourceId ?? item.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const pathExtension = item.mediaPath?.match(/\.([^.\/]+)(?:$|\?)/)?.[1]?.toLowerCase();
  const extension = item.fileExtension ?? pathExtension;
  const normalizedExtension = extension?.replace(/^\./, '').toLowerCase();
  const safeExtension =
    normalizedExtension && /^[a-z0-9]+$/.test(normalizedExtension) ? `.${normalizedExtension}` : '';
  return `geniuz-${sourceId}${safeExtension}`;
}

const service = new OfflineDownloadService(
  AsyncStorage,
  {
    availableDiskSpace: () => Paths.availableDiskSpace,
    getFilePath: (item) => new File(Paths.document, getSafeFileName(item)).uri,
    createDownloadTask: (url, filePath, options) =>
      File.createDownloadTask(url, new File(filePath), options),
    fileExists: (filePath) => new File(filePath).exists,
    getFileSize: (filePath) => new File(filePath).size,
    deleteFile: (filePath) => {
      const file = new File(filePath);
      if (file.exists) {
        file.delete();
      }
    },
  },
  async (item) => {
    if (!supabaseMovieRepository || !item.mediaPath) {
      throw new Error('Connect to the internet to prepare this download.');
    }
    return item.id.startsWith('geniuz:episode:')
      ? supabaseMovieRepository.getEpisodePlaybackUrl(item)
      : supabaseMovieRepository.getPlaybackUrl(item);
  },
);

type DownloadsContextValue = {
  records: OfflineDownloadRecord[];
  isLoading: boolean;
  error?: string;
  download: (item: ContentItem) => Promise<void>;
  downloadSequentially: (items: readonly ContentItem[]) => Promise<void>;
  cancel: (itemId: string) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  dismissError: () => void;
};

const DownloadsContext = createContext<DownloadsContextValue | null>(null);

export function DownloadsProvider({ children }: React.PropsWithChildren) {
  const [records, setRecords] = useState<OfflineDownloadRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const unsubscribe = service.subscribe(setRecords);
    let active = true;
    void service
      .load()
      .catch((loadError: unknown) => {
        console.error('[Downloads] Could not load saved downloads.', loadError);
        if (active) {
          setError('Saved downloads could not be loaded. Check device storage and retry the app.');
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const download = useCallback(async (item: ContentItem) => {
    setError(undefined);
    try {
      await service.download(item);
    } catch (downloadError) {
      console.error('[Downloads] Could not download this title.');
      setError(downloadError instanceof Error ? downloadError.message : 'The download failed. Please retry.');
      throw downloadError;
    }
  }, []);

  const cancel = useCallback(async (itemId: string) => {
    setError(undefined);
    try {
      await service.cancel(itemId);
    } catch (cancelError) {
      console.error('[Downloads] Could not cancel this download.', cancelError);
      setError('The download could not be canceled. Please try again.');
      throw cancelError;
    }
  }, []);

  const downloadSequentially = useCallback(async (items: readonly ContentItem[]) => {
    setError(undefined);
    try {
      await service.downloadSequentially(items);
    } catch (queueError) {
      console.error('[Downloads] Could not complete the queued downloads.');
      setError(
        queueError instanceof Error
          ? queueError.message
          : 'One or more queued downloads failed. Please retry.',
      );
      throw queueError;
    }
  }, []);

  const remove = useCallback(async (itemId: string) => {
    setError(undefined);
    try {
      await service.delete(itemId);
    } catch (deleteError) {
      console.error('[Downloads] Could not delete this download.', deleteError);
      setError('The downloaded file could not be deleted. Please try again.');
      throw deleteError;
    }
  }, []);

  const dismissError = useCallback(() => setError(undefined), []);

  return (
    <DownloadsContext.Provider
      value={{ records, isLoading, error, download, downloadSequentially, cancel, remove, dismissError }}
    >
      {children}
    </DownloadsContext.Provider>
  );
}

export function useDownloads() {
  const context = useContext(DownloadsContext);
  if (!context) {
    throw new Error('useDownloads must be used within DownloadsProvider.');
  }
  return context;
}
