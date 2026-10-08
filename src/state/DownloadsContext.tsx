import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { ContentItem } from '../models/content';
import { supabaseMovieRepository } from '../repositories/SupabaseMovieRepository';
import { getUserAppSettings } from '../services/TrailerAutoplayPreference';
import { useAuth } from './AuthContext';
import { useNetwork } from './NetworkContext';
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
    getPosterFilePath: (item) => {
      const extension = item.posterUrl?.match(/\.(jpe?g|png|webp)(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? 'jpg';
      return `${new File(Paths.document, getSafeFileName(item)).uri}.poster.${extension}`;
    },
    downloadPoster: async (url, filePath, signal) => {
      const task = File.createDownloadTask(url, new File(filePath), {
        signal,
        onProgress: () => undefined,
      });
      const result = await task.downloadAsync();
      if (!result) {
        throw new Error('The poster image download did not complete.');
      }
    },
  },
  async (item) => {
    if (!supabaseMovieRepository || !item.mediaPath) {
      throw new Error('Connect to the internet to prepare this download.');
    }
    return supabaseMovieRepository.getDownloadUrl(item);
  },
);

type DownloadsContextValue = {
  records: OfflineDownloadRecord[];
  availableSpaceBytes: number | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: string;
  download: (item: ContentItem) => Promise<void>;
  downloadSequentially: (items: readonly ContentItem[]) => Promise<void>;
  registerReceived: (item: ContentItem, filePath: string, size: number) => Promise<void>;
  cancel: (itemId: string) => Promise<void>;
  pause: (itemId: string) => Promise<void>;
  resume: (itemId: string) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
  dismissError: () => void;
};

const DownloadsContext = createContext<DownloadsContextValue | null>(null);

export function DownloadsProvider({ children }: React.PropsWithChildren) {
  const auth = useAuth();
  const network = useNetwork();
  const [records, setRecords] = useState<OfflineDownloadRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const enforceWifiPreference = useCallback(async () => {
    if (!auth.session) {
      return;
    }
    const settings = await getUserAppSettings(auth.session.user.id);
    if (settings.wifiOnlyDownloads && !network.isReady) {
      throw new Error('Checking network connection. Please retry the download shortly.');
    }
    if (settings.wifiOnlyDownloads && !network.isWifi) {
      throw new Error('Wi-Fi only downloads are enabled. Connect to Wi-Fi to download titles.');
    }
  }, [auth.session, network.isReady, network.isWifi]);

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

  const pause = useCallback(async (itemId: string) => {
    setError(undefined);
    try {
      await service.pause(itemId);
    } catch (pauseError) {
      console.error('[Downloads] Could not pause this download.', pauseError);
      setError(pauseError instanceof Error ? pauseError.message : 'The download could not be paused.');
      throw pauseError;
    }
  }, []);

  const resume = useCallback(async (itemId: string) => {
    setError(undefined);
    try {
      await enforceWifiPreference();
      await service.resume(itemId);
    } catch (resumeError) {
      console.error('[Downloads] Could not resume this download.', resumeError);
      setError(resumeError instanceof Error ? resumeError.message : 'The download could not be resumed.');
      throw resumeError;
    }
  }, [enforceWifiPreference]);

  const download = useCallback(async (item: ContentItem) => {
    setError(undefined);
    try {
      await enforceWifiPreference();
      await service.download(item);
    } catch (downloadError) {
      console.error('[Downloads] Could not download this title.', downloadError);
      setError(downloadError instanceof Error ? downloadError.message : 'The download failed. Please retry.');
      throw downloadError;
    }
  }, [enforceWifiPreference]);

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
      await enforceWifiPreference();
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
  }, [enforceWifiPreference]);

  const registerReceived = useCallback(async (item: ContentItem, filePath: string, size: number) => {
    setError(undefined);
    try {
      await service.registerReceived(item, filePath, size);
    } catch (registerError) {
      console.error('[Downloads] Could not register a received file.', registerError);
      setError(
        registerError instanceof Error
          ? registerError.message
          : 'The received file could not be added to Downloads.',
      );
      throw registerError;
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

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(undefined);
    try {
      await service.load();
    } catch (loadError) {
      console.error('[Downloads] Could not refresh saved downloads.', loadError);
      setError('Saved downloads could not be refreshed. Check device storage and retry.');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return (
    <DownloadsContext.Provider
      value={{
        records,
        availableSpaceBytes: Number.isFinite(Paths.availableDiskSpace)
          ? Paths.availableDiskSpace
          : null,
        isLoading,
        isRefreshing,
        error,
        download,
        downloadSequentially,
        registerReceived,
        cancel,
        pause,
        resume,
        remove,
        refresh,
        dismissError,
      }}
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
