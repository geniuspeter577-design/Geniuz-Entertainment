import { router, useLocalSearchParams } from 'expo-router';
import { File as ExpoFile, FileMode } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentNotice } from '../src/components/ContentNotice';
import { KeyboardAwareScrollView, KeyboardAwareTextInput } from '../src/components/KeyboardAwareScrollView';
import { CategoryPicker } from '../src/components/CategoryPicker';
import { useNetwork } from '../src/state/NetworkContext';
import { TitleImage } from '../src/components/TitleImage';
import { MAX_TRAILER_FILE_SIZE_BYTES, MAX_VIDEO_FILE_SIZE_BYTES } from '../src/constants/video';
import { compressTitleImage } from '../src/utils/titleImage';
import { validateTitleImage } from '../src/utils/titleImageValidation';
import type { ContentItem } from '../src/models/content';
import { supabaseMovieRepository } from '../src/repositories/SupabaseMovieRepository';
import { deleteUploadedB2Object, uploadVideoToB2 } from '../src/services/B2UploadService';
import type { AdminTitleUpdate, NewMovie } from '../src/repositories/SupabaseMovieRepository';
import { loadAdminCatalog } from '../src/utils/adminCatalog';
import { deleteOrphanedUpload, retryUploadedMovieSave } from '../src/utils/uploadSaveRecovery';
import {
  isSupabaseConfigured,
  supabase,
  supabaseConfigurationError,
} from '../src/services/supabase';
import { theme } from '../src/theme';
import { detectVideoFileType, validateVideoFileSize } from '../src/utils/videoFile';
import {
  deleteRecordThenCleanup,
  getTitleCleanupFailureMessage,
  logTitleCleanupFailures,
  retryTitleCleanup,
  type PendingTitleCleanup,
  type TitleCleanupAsset,
} from '../src/utils/titleDeletion';
import { TitleCleanupStore } from '../src/services/TitleCleanupStore';
import { getAdminRouteState, isAdminMetadata } from '../src/utils/adminAccess';
import { getFriendlyAuthError } from '../src/utils/accountAuth';
import { backOrReplace } from '../src/utils/navigation';

type AdminMovie = ContentItem & {
  published: boolean;
  createdAt: string;
  allowDownload: boolean;
};

type SelectedMovieFile = {
  file: File | ExpoFile;
  name: string;
  size: number;
  fileExtension: string | null;
  storageExtension: string;
  mimeType: string;
  contentType: string;
};

type SelectedTitleImage = {
  uri: string;
  name: string;
  size: number;
  blob: Blob;
};

type AdminSeasonChoice = {
  id: string;
  series_id: string;
  season_number: number;
  release_year: number | null;
  published: boolean;
};

type UnusedMediaFile = {
  key: string;
  sizeBytes: number;
  lastModified: string;
};

type UnusedMediaScan = {
  scanId: string;
  files: UnusedMediaFile[];
  totalSizeBytes: number;
  minimumAgeHours: number;
};

function parseUnusedMediaScan(value: unknown): UnusedMediaScan | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.scanId !== 'string' || !Array.isArray(candidate.files) || typeof candidate.totalSizeBytes !== 'number' || typeof candidate.minimumAgeHours !== 'number') {
    return undefined;
  }

  const files = candidate.files.flatMap((item) => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.key !== 'string' || typeof record.sizeBytes !== 'number' || typeof record.lastModified !== 'string') {
      return [];
    }
    return [{ key: record.key, sizeBytes: record.sizeBytes, lastModified: record.lastModified }];
  });

  return {
    scanId: candidate.scanId,
    files,
    totalSizeBytes: candidate.totalSizeBytes,
    minimumAgeHours: candidate.minimumAgeHours,
  };
}

const titleCleanupStore = new TitleCleanupStore(AsyncStorage);

async function readVideoPart(
  file: globalThis.File | ExpoFile,
  start: number,
  end: number,
  contentType: string,
) {
  if (file instanceof ExpoFile) {
    const handle = file.open(FileMode.ReadOnly);
    try {
      handle.offset = start;
      const bytes = handle.readBytes(end - start);
      if (bytes.byteLength !== end - start) {
        throw new Error('The selected video file could not be read completely.');
      }
      return new Blob([bytes], { type: contentType });
    } finally {
      handle.close();
    }
  }
  return file.slice(start, end, contentType);
}

const inputFields = [
  { key: 'title', label: 'Movie title', placeholder: 'Enter the movie title' },
  { key: 'description', label: 'Description', placeholder: 'Add a short description', multiline: true },
  { key: 'year', label: 'Release year', placeholder: '2026', keyboardType: 'number-pad' as const },
  { key: 'genres', label: 'Genres', placeholder: 'Drama, Action, Thriller' },
  { key: 'runtime', label: 'Runtime (minutes)', placeholder: '120', keyboardType: 'number-pad' as const },
  { key: 'rating', label: 'Content rating', placeholder: 'PG-13' },
  { key: 'poster', label: 'Poster image URL (optional)', placeholder: 'https://…' },
] as const;

function formatFileSize(bytes: number) {
  if (bytes <= 0) {
    return '0 B';
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AdminTextField({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <KeyboardAwareTextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor={theme.secondaryText}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.multilineInput]}
      />
    </View>
  );
}

function AdminCheckbox({
  checked,
  disabled,
  label,
  onPress,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.checkRow}
    >
      <View style={[styles.checkbox, checked && styles.checkedBox]}>
        {checked ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

function AdminTitleImagePicker({
  label,
  uri,
  disabled,
  hint,
  onChoose,
  onRemove,
}: {
  label: string;
  uri?: string;
  disabled?: boolean;
  hint: string;
  onChoose: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.imagePickerRow}>
      {uri ? <Image source={{ uri }} style={styles.imagePreview} resizeMode="cover" /> : null}
      <View style={styles.grow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.helper}>{hint}</Text>
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onChoose}>
          <Text style={styles.linkText}>{uri ? `Replace ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}</Text>
        </Pressable>
        {uri ? (
          <Pressable accessibilityRole="button" disabled={disabled} onPress={onRemove}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function AdminScreen() {
  const { signin: signinParam } = useLocalSearchParams<{ signin?: string }>();
  const canSignIn = signinParam === '1' || Platform.OS === 'web';
  const { isOnline } = useNetwork();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string>();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [title, setTitle] = useState('');
  const [contentKind, setContentKind] = useState<'movie' | 'short'>('movie');
  const [description, setDescription] = useState('');
  const [year, setYear] = useState('');
  const [genres, setGenres] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [runtime, setRuntime] = useState('');
  const [contentRating, setContentRating] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [posterImage, setPosterImage] = useState<SelectedTitleImage>();
  const [coverImage, setCoverImage] = useState<SelectedTitleImage>();
  const [selectedFile, setSelectedFile] = useState<SelectedMovieFile | null>(null);
  const [selectedTrailer, setSelectedTrailer] = useState<SelectedMovieFile | null>(null);
  const [trailerDuration, setTrailerDuration] = useState('');
  const [uploadingFile, setUploadingFile] = useState<SelectedMovieFile | null>(null);
  const [confirmedRights, setConfirmedRights] = useState(false);
  const [publishImmediately, setPublishImmediately] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadingStage, setUploadingStage] = useState('Uploading video');
  const [formMessage, setFormMessage] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [movies, setMovies] = useState<AdminMovie[]>([]);
  const [selectedTitleIds, setSelectedTitleIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [seasons, setSeasons] = useState<AdminSeasonChoice[]>([]);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [moviesError, setMoviesError] = useState<string>();
  const [seriesError, setSeriesError] = useState<string>();
  const [pendingCleanups, setPendingCleanups] = useState<PendingTitleCleanup[]>([]);
  const [cleanupError, setCleanupError] = useState<string>();
  const [unusedMediaScan, setUnusedMediaScan] = useState<UnusedMediaScan | null>(null);
  const [unusedMediaError, setUnusedMediaError] = useState<string>();
  const [unusedMediaDeleteSummary, setUnusedMediaDeleteSummary] = useState<{ deleted: number; failures: number; skipped: number } | null>(null);
  const [isScanningUnusedMedia, setIsScanningUnusedMedia] = useState(false);
  const [isDeletingUnusedMedia, setIsDeletingUnusedMedia] = useState(false);
  const [retryingCleanupId, setRetryingCleanupId] = useState<string>();
  const [pendingMovieSave, setPendingMovieSave] = useState<{
    movie: NewMovie;
    storageKey: string;
  }>();
  const [isRetryingMovieSave, setIsRetryingMovieSave] = useState(false);
  const [updatingMovieId, setUpdatingMovieId] = useState<string>();
  const [editingMovie, setEditingMovie] = useState<AdminMovie>();
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editRating, setEditRating] = useState('');
  const [editPosterUrl, setEditPosterUrl] = useState('');
  const [editCoverUrl, setEditCoverUrl] = useState('');
  const [editPosterImage, setEditPosterImage] = useState<SelectedTitleImage>();
  const [editCoverImage, setEditCoverImage] = useState<SelectedTitleImage>();
  const [editTrailerFile, setEditTrailerFile] = useState<SelectedMovieFile | null>(null);
  const [editTrailerRemoved, setEditTrailerRemoved] = useState(false);
  const [editTrailerDuration, setEditTrailerDuration] = useState('');
  const [editPublished, setEditPublished] = useState(false);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [editRightsConfirmed, setEditRightsConfirmed] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesDescription, setSeriesDescription] = useState('');
  const [seriesYear, setSeriesYear] = useState('');
  const [seriesGenres, setSeriesGenres] = useState('');
  const [seriesCategories, setSeriesCategories] = useState<string[]>([]);
  const [seriesContentRating, setSeriesContentRating] = useState('');
  const [seriesPosterUrl, setSeriesPosterUrl] = useState('');
  const [seriesPosterImage, setSeriesPosterImage] = useState<SelectedTitleImage>();
  const [seriesCoverImage, setSeriesCoverImage] = useState<SelectedTitleImage>();
  const [seriesTrailer, setSeriesTrailer] = useState<SelectedMovieFile | null>(null);
  const [seriesTrailerDuration, setSeriesTrailerDuration] = useState('');
  const [seriesPublished, setSeriesPublished] = useState(true);
  const [seriesRightsConfirmed, setSeriesRightsConfirmed] = useState(false);
  const [seasonSeriesId, setSeasonSeriesId] = useState('');
  const [seasonNumber, setSeasonNumber] = useState('');
  const [seasonYear, setSeasonYear] = useState('');
  const [episodeSeasonId, setEpisodeSeasonId] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeDuration, setEpisodeDuration] = useState('');
  const [episodeFile, setEpisodeFile] = useState<SelectedMovieFile | null>(null);
  const [episodeRightsConfirmed, setEpisodeRightsConfirmed] = useState(false);
  const [episodeAllowDownload, setEpisodeAllowDownload] = useState(false);
  const [episodePublished, setEpisodePublished] = useState(true);
  const [isSavingSeries, setIsSavingSeries] = useState(false);
  const [isSavingSeason, setIsSavingSeason] = useState(false);
  const uploadAbortController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      uploadAbortController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void titleCleanupStore.load().then((items) => {
      if (active) {
        setPendingCleanups(items);
      }
    }).catch((error: unknown) => {
      console.error('[AdminScreen] Could not load the saved file-cleanup list.', error);
      if (active) {
        setCleanupError('The saved cleanup list could not be loaded. Retry after restarting the app.');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const loadMovies = useCallback(async () => {
    const repository = supabaseMovieRepository;
    if (!repository || !isOnline) {
      return;
    }

    setMoviesLoading(true);
    setMoviesError(undefined);
    setSeriesError(undefined);
    const result = await loadAdminCatalog(
      () => repository.getAdminMovies(),
      () => repository.getAdminSeasons(),
    );
    if ('movies' in result) {
      setMovies(result.movies);
    } else {
      console.error('[AdminScreen] Could not load movies.', result.movieError);
      setMoviesError('The movie catalog could not be loaded. Check your connection and retry.');
    }
    if ('seasons' in result) {
      setSeasons(result.seasons);
    } else {
      console.error('[AdminScreen] Could not load series seasons.', result.seriesError);
      setSeasons([]);
      setSeriesError('Series could not be loaded - Retry');
    }
    setMoviesLoading(false);
  }, [isOnline]);

  const runUnusedMediaScan = async () => {
    if (!supabase) {
      setUnusedMediaError('Supabase is not configured.');
      return;
    }
    setIsScanningUnusedMedia(true);
    setUnusedMediaError(undefined);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token) {
        throw new Error('Admin sign-in is required.');
      }
      if (!isAdminMetadata(data.session.user.app_metadata)) {
        throw new Error('Admin access is required.');
      }
      const apiBaseUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim().replace(/\/+$/, '');
      if (!apiBaseUrl) {
        throw new Error('The backend URL is not configured.');
      }

      const response = await fetch(`${apiBaseUrl}/admin/unused-files`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });

      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'Admin session expired. Sign in again and retry.'
          : 'The unused file scan could not be loaded.');
      }

      const nextScan = parseUnusedMediaScan(await response.json());
      if (!nextScan) {
        throw new Error('The unused file response was invalid.');
      }

      setUnusedMediaScan(nextScan);
      setUnusedMediaDeleteSummary(null);
    } catch (error) {
      setUnusedMediaScan(null);
      setUnusedMediaError(error instanceof Error ? error.message : 'The unused file scan could not be loaded.');
    } finally {
      setIsScanningUnusedMedia(false);
    }
  };

  const deleteUnusedMedia = async () => {
    const client = supabase;
    if (!client || !unusedMediaScan) {
      return;
    }

    const fileCount = unusedMediaScan.files.length;
    Alert.alert(
      'Delete unused files?',
      `This will delete ${fileCount} Backblaze object${fileCount === 1 ? '' : 's'} listed by the scan. Only files older than ${unusedMediaScan.minimumAgeHours} hours and not connected to any title will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingUnusedMedia(true);
            setUnusedMediaError(undefined);
            try {
              const { data, error: sessionError } = await client.auth.getSession();
              if (sessionError || !data.session?.access_token) {
                throw new Error('Admin sign-in is required.');
              }
              if (!isAdminMetadata(data.session.user.app_metadata)) {
                throw new Error('Admin access is required.');
              }
              const apiBaseUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim().replace(/\/+$/, '');
              if (!apiBaseUrl) {
                throw new Error('The backend URL is not configured.');
              }

              const response = await fetch(`${apiBaseUrl}/admin/unused-files/delete`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${data.session.access_token}`,
                },
                body: JSON.stringify({ scanId: unusedMediaScan.scanId }),
              });

              if (!response.ok) {
                throw new Error(response.status === 401 || response.status === 403
                  ? 'Admin session expired. Sign in again and retry.'
                  : response.status === 410
                    ? 'The file list expired. Run a fresh scan before deleting.'
                    : 'Deletion failed. Retry with a fresh scan.');
              }

              const result = await response.json();
              const deleted = Array.isArray(result?.deleted) ? result.deleted.length : 0;
              const failures = Array.isArray(result?.failures) ? result.failures.length : 0;
              const skipped = typeof result?.skipped === 'number' ? result.skipped : 0;
              setUnusedMediaDeleteSummary({ deleted, failures, skipped });
              setUnusedMediaScan(null);
            } catch (error) {
              setUnusedMediaError(error instanceof Error ? error.message : 'Unused files could not be deleted.');
            } finally {
              setIsDeletingUnusedMedia(false);
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (!supabase || !isOnline) {
      return;
    }

    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setAuthLoading(false);
        setAuthError(undefined);
      }
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) {
        return;
      }
      if (error) {
        setAuthError('Could not restore your admin session. Try signing in again.');
      }
      setSession(data.session);
      setAuthLoading(false);
      if (data.session?.user.app_metadata?.role === 'admin') {
        void loadMovies();
      }
    }).catch((error: unknown) => {
      console.error('[AdminScreen] Could not restore the admin session.', error);
      if (active) {
        setAuthError('Could not restore your admin session. Try signing in again.');
        setAuthLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [isOnline, loadMovies]);

  const isAdmin = isAdminMetadata(session?.user.app_metadata);
  const routeState = getAdminRouteState({
    isAdmin,
    isSignedIn: Boolean(session),
    canSignIn,
  });

  const handleSignIn = useCallback(async () => {
    if (!supabase) {
      return;
    }

    setIsSigningIn(true);
    setAuthError(undefined);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setAuthError(getFriendlyAuthError(error));
      } else if (data.user.app_metadata?.role === 'admin') {
        await loadMovies();
      }
    } catch (error) {
      console.error('[AdminScreen] Admin sign-in failed.', error);
      setAuthError(getFriendlyAuthError(error));
    } finally {
      setIsSigningIn(false);
    }
  }, [email, loadMovies, password]);

  const handleSignOut = useCallback(async () => {
    if (!supabase) {
      return;
    }

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('[AdminScreen] Admin sign-out failed.', error);
        setAuthError('Could not sign out. Please try again.');
      }
    } catch (error) {
      console.error('[AdminScreen] Admin sign-out failed.', error);
      setAuthError('Could not sign out. Please try again.');
    }
  }, []);

  const chooseVideoFile = useCallback(async (kind: 'video' | 'trailer' = 'video') => {
    setFormError(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: false,
        base64: false,
      });
      if (result.canceled) {
        return null;
      }

      const asset = result.assets[0];
      const detectedType = detectVideoFileType(asset.name, asset.mimeType);
      if (!detectedType) {
        setFormError('Choose a video file. Supported formats include MP4, MOV, MKV, AVI, WebM, M4V, 3GP, TS, FLV, and WMV.');
        return null;
      }

      const file = asset.file ?? new ExpoFile(asset.uri);
      const fileSize = typeof file.size === 'number' ? file.size : Number.NaN;
      const maxSize = kind === 'trailer' ? MAX_TRAILER_FILE_SIZE_BYTES : MAX_VIDEO_FILE_SIZE_BYTES;
      const sizeValidation = validateVideoFileSize(fileSize, maxSize);
      if (!sizeValidation.valid) {
        setFormError(sizeValidation.message);
        return null;
      }

      return {
        file,
        name: asset.name,
        size: fileSize,
        fileExtension: detectedType.originalExtension,
        storageExtension: detectedType.extension,
        mimeType: asset.mimeType?.trim() || detectedType.mimeType,
        contentType: detectedType.mimeType,
      } satisfies SelectedMovieFile;
    } catch (error) {
      console.error('[AdminScreen] Video picker failed.', error);
      setFormError('Could not open the video picker. Please try again.');
      return null;
    }
  }, []);

  const chooseMovie = useCallback(async () => {
    const file = await chooseVideoFile();
    if (file) {
      setSelectedFile(file);
    }
  }, [chooseVideoFile]);

  const chooseTrailer = useCallback(async (series = false) => {
    const file = await chooseVideoFile('trailer');
    if (file) {
      (series ? setSeriesTrailer : setSelectedTrailer)(file);
    }
  }, [chooseVideoFile]);

  const chooseEpisodeFile = useCallback(async () => {
    const file = await chooseVideoFile();
    if (file) {
      setEpisodeFile(file);
    }
  }, [chooseVideoFile]);

  const chooseTitleImage = useCallback(async (kind: 'poster' | 'cover', series = false) => {
    setFormError(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      const sourceFile = asset.file ?? new ExpoFile(asset.uri);
      const size = typeof asset.size === 'number' ? asset.size : sourceFile.size;
      const validation = validateTitleImage(asset.name, asset.mimeType, size);
      if (!validation.valid) {
        setFormError(validation.message);
        return;
      }
      const compressed = await compressTitleImage(
        asset.uri,
        kind === 'poster' ? 600 : 1280,
        kind === 'poster' ? 900 : 720,
      );
      const selected = { uri: compressed.uri, name: asset.name, size: compressed.blob.size, blob: compressed.blob };
      if (series) {
        (kind === 'poster' ? setSeriesPosterImage : setSeriesCoverImage)(selected);
      } else {
        (kind === 'poster' ? setPosterImage : setCoverImage)(selected);
      }
      if (compressed.blob.size > 500 * 1024) {
        setFormMessage('Image optimized, but remains above 500 KB. Supabase allows up to 5 MB per image.');
      }
    } catch (error) {
      console.error('[AdminScreen] Title image selection failed.', error);
      setFormError(error instanceof Error ? error.message : 'Could not prepare the image. Choose another file.');
    }
  }, []);

  const handleUpload = useCallback(async () => {
    const repository = supabaseMovieRepository;
    if (!repository || !supabase || !selectedFile) {
      setFormError('Connect Supabase and choose a video before uploading.');
      return;
    }
    const sizeValidation = validateVideoFileSize(selectedFile.size, MAX_VIDEO_FILE_SIZE_BYTES);
    if (!sizeValidation.valid) {
      setFormError(sizeValidation.message);
      return;
    }
    if (!title.trim()) {
      setFormError('Enter a movie title.');
      return;
    }
    if (!confirmedRights) {
      setFormError('Confirm that you have the rights to distribute this movie.');
      return;
    }

    const parsedYear = year.trim() ? Number(year) : undefined;
    const parsedRuntime = runtime.trim() ? Number(runtime) : undefined;
    const parsedTrailerDuration = trailerDuration.trim() ? Number(trailerDuration) : undefined;
    if (
      (parsedYear !== undefined &&
        (!Number.isInteger(parsedYear) || parsedYear < 1888 || parsedYear > 2200)) ||
      (parsedRuntime !== undefined &&
        (!Number.isInteger(parsedRuntime) || parsedRuntime < 1 || parsedRuntime > 1000)) ||
      (parsedTrailerDuration !== undefined &&
        (!Number.isInteger(parsedTrailerDuration) || parsedTrailerDuration < 1 || parsedTrailerDuration > 86400))
    ) {
      setFormError('Enter a valid release year and runtime.');
      return;
    }
    if (posterUrl.trim()) {
      try {
        if (new URL(posterUrl.trim()).protocol !== 'https:') {
          throw new Error('The poster URL must use HTTPS.');
        }
      } catch {
        setFormError('Enter a valid HTTPS poster image URL.');
        return;
      }
    }

    setIsUploading(true);
    setUploadingFile(selectedFile);
    setUploadingStage('Uploading video');
    setProgress(0);
    setFormError(undefined);
    setFormMessage(undefined);
    const abortController = new AbortController();
    uploadAbortController.current = abortController;
    const uploadedImages: string[] = [];
    let preserveImagesForRetry = false;
    let trailerStorageKey: string | undefined;
    let accessTokenForCleanup: string | undefined;
    try {
      const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionResult.session?.access_token;
      if (sessionError || !accessToken) {
        throw new Error('Your admin session expired. Sign in again before uploading.', {
          cause: sessionError,
        });
      }
      accessTokenForCleanup = accessToken;
      const storedPosterUrl = posterImage
        ? await repository.uploadTitleImage(posterImage.blob, 'image/jpeg')
        : posterUrl.trim() || undefined;
      if (posterImage && storedPosterUrl) {
        uploadedImages.push(storedPosterUrl);
      }
      const storedCoverUrl = coverImage
        ? await repository.uploadTitleImage(coverImage.blob, 'image/jpeg')
        : undefined;
      if (coverImage && storedCoverUrl) {
        uploadedImages.push(storedCoverUrl);
      }
      if (selectedTrailer) {
        setUploadingStage('Uploading trailer');
        setUploadingFile(selectedTrailer);
        trailerStorageKey = await uploadVideoToB2({
          apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
          accessToken,
          file: {
            size: selectedTrailer.size,
            readPart: (start, end, contentType) =>
              readVideoPart(selectedTrailer.file, start, end, contentType),
          },
          fileName: selectedTrailer.name,
          contentType: selectedTrailer.contentType,
          kind: 'trailer',
          signal: abortController.signal,
          onProgress: setProgress,
        });
      }
      setUploadingStage('Uploading video');
      setUploadingFile(selectedFile);
      setProgress(0);
      const storageKey = await uploadVideoToB2({
        apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
        accessToken,
        file: {
          size: selectedFile.size,
          readPart: (start, end, contentType) =>
            readVideoPart(selectedFile.file, start, end, contentType),
        },
        fileName: selectedFile.name,
        contentType: selectedFile.contentType,
        signal: abortController.signal,
        onProgress: setProgress,
      });
      const movieDraft: NewMovie = {
          contentKind,
          title,
          description,
          ...(parsedYear === undefined ? {} : { releaseYear: parsedYear }),
          genres: genres
            .split(',')
            .map((genre) => genre.trim())
            .filter(Boolean),
          categories,
          ...(storedPosterUrl ? { posterUrl: storedPosterUrl } : {}),
          ...(storedCoverUrl ? { coverUrl: storedCoverUrl } : {}),
          ...(parsedRuntime === undefined ? {} : { runtimeMinutes: parsedRuntime }),
          ...(contentRating.trim() ? { contentRating: contentRating.trim() } : {}),
          published: publishImmediately,
          allowDownload,
          fileExtension: selectedFile.fileExtension,
          storageExtension: selectedFile.storageExtension,
          mimeType: selectedFile.mimeType,
          contentType: selectedFile.contentType,
          fileSizeBytes: selectedFile.size,
          ...(trailerStorageKey
            ? {
                trailerStorageKey,
                trailerSizeBytes: selectedTrailer?.size,
                trailerDurationSeconds: parsedTrailerDuration,
                trailerContentType: selectedTrailer?.contentType,
              }
            : {}),
        };
      const pending = { movie: movieDraft, storageKey };
      setPendingMovieSave(pending);
      preserveImagesForRetry = true;
      await retryUploadedMovieSave(pending, (movie, key) =>
        repository.createB2Movie(movie, key),
      );
      setPendingMovieSave(undefined);

      const uploadedKind = contentKind === 'short' ? 'Short video' : 'Movie';
      setFormMessage(
        publishImmediately
          ? `${uploadedKind} uploaded and published. It is now available in the app.`
          : `${uploadedKind} uploaded as a draft. Publish it from the catalog below when it is ready.`,
      );
      setSelectedFile(null);
      setSelectedTrailer(null);
      setTrailerDuration('');
      setTitle('');
      setDescription('');
      setYear('');
      setGenres('');
      setCategories(contentKind === 'short' ? ['Shorts'] : []);
      setRuntime('');
      setContentRating('');
      setPosterUrl('');
      setPosterImage(undefined);
      setCoverImage(undefined);
      setConfirmedRights(false);
      setAllowDownload(false);
      setProgress(100);
      await loadMovies();
    } catch (error) {
      console.error('[AdminScreen] Movie upload failed.');
      if (!preserveImagesForRetry) {
        if (trailerStorageKey && accessTokenForCleanup) {
          await deleteUploadedB2Object({
            apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
            accessToken: accessTokenForCleanup,
            key: trailerStorageKey,
          }).catch((cleanupError: unknown) => {
            console.error('[AdminScreen] Could not clean up an unused trailer.', cleanupError);
          });
        }
        await Promise.all(
          uploadedImages.map((url) => repository.deleteTitleImage(url).catch((cleanupError: unknown) => {
            console.error('[AdminScreen] Could not clean up an unused title image.', cleanupError);
          })),
        );
      }
      setFormError(
        error instanceof Error
          ? error.message
          : 'The movie could not be uploaded. Check your connection and retry.',
      );
    } finally {
      if (uploadAbortController.current === abortController) {
        uploadAbortController.current = null;
      }
      setUploadingFile(null);
      setIsUploading(false);
    }
  }, [
    confirmedRights,
    contentKind,
    contentRating,
    description,
    genres,
    categories,
    allowDownload,
    loadMovies,
    posterUrl,
    posterImage,
    coverImage,
    selectedTrailer,
    trailerDuration,
    publishImmediately,
    runtime,
    selectedFile,
    title,
    year,
  ]);

  const retryMovieSave = useCallback(async () => {
    const repository = supabaseMovieRepository;
    if (!repository || !pendingMovieSave) {
      return;
    }
    setIsRetryingMovieSave(true);
    setFormError(undefined);
    try {
      await retryUploadedMovieSave(pendingMovieSave, (movie, key) =>
        repository.createB2Movie(movie, key),
      );
      setPendingMovieSave(undefined);
      setFormMessage('Movie record saved. The uploaded video was not uploaded again.');
      setSelectedFile(null);
      setPosterImage(undefined);
      setCoverImage(undefined);
      await loadMovies();
    } catch (error) {
      console.error('[AdminScreen] Could not retry saving the uploaded movie.', error);
      setFormError(error instanceof Error ? error.message : 'The movie record could not be saved. Retry.');
    } finally {
      setIsRetryingMovieSave(false);
    }
  }, [loadMovies, pendingMovieSave]);

  const deleteOrphanedMovieUpload = useCallback(async () => {
    const repository = supabaseMovieRepository;
    if (!repository || !supabase || !pendingMovieSave) {
      return;
    }
    setIsRetryingMovieSave(true);
    setFormError(undefined);
    try {
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        throw new Error('Your admin session expired. Sign in again before deleting the orphaned upload.');
      }
      await deleteOrphanedUpload(pendingMovieSave, (key) =>
        deleteUploadedB2Object({
          apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
          accessToken,
          key,
        }),
      );
      if (pendingMovieSave.movie.trailerStorageKey) {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          throw new Error('Your admin session expired. Sign in again before deleting the orphaned trailer.');
        }
        await deleteUploadedB2Object({
          apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
          accessToken,
          key: pendingMovieSave.movie.trailerStorageKey,
        });
      }
      await Promise.all([
        repository.deleteTitleImage(pendingMovieSave.movie.posterUrl),
        repository.deleteTitleImage(pendingMovieSave.movie.coverUrl),
      ]);
      setPendingMovieSave(undefined);
      setSelectedFile(null);
      setFormMessage('Orphaned B2 video deleted.');
    } catch (error) {
      console.error('[AdminScreen] Could not delete the orphaned video.', error);
      setFormError(error instanceof Error ? error.message : 'The orphaned video could not be deleted. Retry.');
    } finally {
      setIsRetryingMovieSave(false);
    }
  }, [pendingMovieSave]);

  const handleCreateSeries = useCallback(async () => {
    const repository = supabaseMovieRepository;
    if (!repository) {
      setFormError('Connect Supabase before creating a series.');
      return;
    }
    if (!seriesTitle.trim()) {
      setFormError('Enter a series title.');
      return;
    }
    if (!seriesRightsConfirmed) {
      setFormError('Confirm that you have the rights to distribute this series.');
      return;
    }
    const parsedYear = seriesYear.trim() ? Number(seriesYear) : undefined;
    const parsedTrailerDuration = seriesTrailerDuration.trim() ? Number(seriesTrailerDuration) : undefined;
    if (parsedYear !== undefined && (!Number.isInteger(parsedYear) || parsedYear < 1888 || parsedYear > 2200)) {
      setFormError('Enter a valid series release year.');
      return;
    }
    if (
      parsedTrailerDuration !== undefined &&
      (!Number.isInteger(parsedTrailerDuration) || parsedTrailerDuration < 1 || parsedTrailerDuration > 86400)
    ) {
      setFormError('Enter a valid trailer duration in seconds.');
      return;
    }
    if (seriesPosterUrl.trim()) {
      try {
        if (new URL(seriesPosterUrl.trim()).protocol !== 'https:') {
          throw new Error('Invalid poster URL.');
        }
      } catch {
        setFormError('Enter a valid HTTPS poster image URL.');
        return;
      }
    }

    setIsSavingSeries(true);
    setFormError(undefined);
    const uploadedImages: string[] = [];
    let trailerStorageKey: string | undefined;
    const trailerAbortController = new AbortController();
    uploadAbortController.current = trailerAbortController;
    try {
      const storedPosterUrl = seriesPosterImage
        ? await repository.uploadTitleImage(seriesPosterImage.blob, 'image/jpeg')
        : seriesPosterUrl.trim() || undefined;
      if (seriesPosterImage && storedPosterUrl) {
        uploadedImages.push(storedPosterUrl);
      }
      const storedCoverUrl = seriesCoverImage
        ? await repository.uploadTitleImage(seriesCoverImage.blob, 'image/jpeg')
        : undefined;
      if (seriesCoverImage && storedCoverUrl) {
        uploadedImages.push(storedCoverUrl);
      }
      if (seriesTrailer) {
        if (!supabase) {
          throw new Error('Connect Supabase before uploading a trailer.');
        }
        const { data, error } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (error || !accessToken) {
          throw new Error('Your admin session expired. Sign in again before uploading a trailer.');
        }
        setIsUploading(true);
        setUploadingFile(seriesTrailer);
        setUploadingStage('Uploading trailer');
        setProgress(0);
        trailerStorageKey = await uploadVideoToB2({
          apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
          accessToken,
          file: {
            size: seriesTrailer.size,
            readPart: (start, end, contentType) =>
              readVideoPart(seriesTrailer.file, start, end, contentType),
          },
          fileName: seriesTrailer.name,
          contentType: seriesTrailer.contentType,
          kind: 'trailer',
          signal: trailerAbortController.signal,
          onProgress: setProgress,
        });
      }
      const seriesId = await repository.createSeries({
        title: seriesTitle,
        description: seriesDescription,
        ...(parsedYear === undefined ? {} : { releaseYear: parsedYear }),
        genres: seriesGenres.split(',').map((genre) => genre.trim()).filter(Boolean),
        categories: seriesCategories,
        ...(storedPosterUrl ? { posterUrl: storedPosterUrl } : {}),
        ...(storedCoverUrl ? { coverUrl: storedCoverUrl } : {}),
        ...(seriesContentRating.trim() ? { contentRating: seriesContentRating.trim() } : {}),
        published: seriesPublished,
        ...(trailerStorageKey
          ? {
              trailerStorageKey,
              trailerSizeBytes: seriesTrailer?.size,
              trailerDurationSeconds: parsedTrailerDuration,
              trailerContentType: seriesTrailer?.contentType,
            }
          : {}),
      });
      setSeriesTitle('');
      setSeriesDescription('');
      setSeriesYear('');
      setSeriesGenres('');
      setSeriesCategories([]);
      setSeriesContentRating('');
      setSeriesPosterUrl('');
      setSeriesPosterImage(undefined);
      setSeriesCoverImage(undefined);
      setSeriesTrailer(null);
      setSeriesTrailerDuration('');
      setSeriesRightsConfirmed(false);
      setSeasonSeriesId(seriesId.replace(/^geniuz:series:/, ''));
      setFormMessage('Series created. Add seasons and episodes below.');
      await loadMovies();
    } catch (error) {
      if (trailerStorageKey && supabase) {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (accessToken) {
          await deleteUploadedB2Object({
            apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
            accessToken,
            key: trailerStorageKey,
          }).catch((cleanupError: unknown) => {
            console.error('[AdminScreen] Could not clean up an unused series trailer.', cleanupError);
          });
        }
      }
      await Promise.all(
        uploadedImages.map((url) => repository.deleteTitleImage(url).catch((cleanupError: unknown) => {
          console.error('[AdminScreen] Could not clean up an unused series image.', cleanupError);
        })),
      );
      console.error('[AdminScreen] Could not create series.', error);
      setFormError(error instanceof Error ? error.message : 'The series could not be created. Retry.');
    } finally {
      if (uploadAbortController.current === trailerAbortController) {
        uploadAbortController.current = null;
      }
      setUploadingFile(null);
      setIsUploading(false);
      setIsSavingSeries(false);
    }
  }, [loadMovies, seriesCategories, seriesContentRating, seriesDescription, seriesGenres, seriesPosterUrl, seriesPosterImage, seriesCoverImage, seriesTrailer, seriesTrailerDuration, seriesPublished, seriesRightsConfirmed, seriesTitle, seriesYear]);

  const handleCreateSeason = useCallback(async () => {
    if (!supabaseMovieRepository || !seasonSeriesId) {
      setFormError('Choose a series before adding a season.');
      return;
    }
    const parsedNumber = Number(seasonNumber);
    const parsedYear = seasonYear.trim() ? Number(seasonYear) : undefined;
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
      setFormError('Enter a valid season number.');
      return;
    }
    if (parsedYear !== undefined && (!Number.isInteger(parsedYear) || parsedYear < 1888 || parsedYear > 2200)) {
      setFormError('Enter a valid season year.');
      return;
    }

    setIsSavingSeason(true);
    setFormError(undefined);
    try {
      const seasonId = await supabaseMovieRepository.createSeason(
        seasonSeriesId,
        parsedNumber,
        parsedYear,
      );
      setSeasonNumber('');
      setSeasonYear('');
      setEpisodeSeasonId(seasonId);
      setFormMessage(`Season ${parsedNumber} created.`);
      await loadMovies();
    } catch (error) {
      console.error('[AdminScreen] Could not create season.', error);
      setFormError(error instanceof Error ? error.message : 'The season could not be created. Retry.');
    } finally {
      setIsSavingSeason(false);
    }
  }, [loadMovies, seasonNumber, seasonSeriesId, seasonYear]);

  const handleUploadEpisode = useCallback(async () => {
    if (!supabaseMovieRepository || !supabase || !episodeFile) {
      setFormError('Choose a video before uploading the episode.');
      return;
    }
    if (!episodeSeasonId) {
      setFormError('Choose a season for this episode.');
      return;
    }
    if (!episodeTitle.trim()) {
      setFormError('Enter an episode title.');
      return;
    }
    const parsedNumber = Number(episodeNumber);
    const parsedDuration = Number(episodeDuration);
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
      setFormError('Enter a valid episode number.');
      return;
    }
    if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 86400) {
      setFormError('Enter a valid episode duration in seconds.');
      return;
    }
    if (!episodeRightsConfirmed) {
      setFormError('Confirm that you have the rights to distribute this episode.');
      return;
    }
    const sizeValidation = validateVideoFileSize(episodeFile.size, MAX_VIDEO_FILE_SIZE_BYTES);
    if (!sizeValidation.valid) {
      setFormError(sizeValidation.message);
      return;
    }

    setIsUploading(true);
    setUploadingFile(episodeFile);
    setProgress(0);
    setFormError(undefined);
    setFormMessage(undefined);
    const abortController = new AbortController();
    uploadAbortController.current = abortController;
    try {
      const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionResult.session?.access_token;
      if (sessionError || !accessToken) {
        throw new Error('Your admin session expired. Sign in again before uploading.', { cause: sessionError });
      }
      const storageKey = await uploadVideoToB2({
        apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
        accessToken,
        file: {
          size: episodeFile.size,
          readPart: (start, end, contentType) =>
            readVideoPart(episodeFile.file, start, end, contentType),
        },
        fileName: episodeFile.name,
        contentType: episodeFile.contentType,
        objectType: 'episode',
        signal: abortController.signal,
        onProgress: setProgress,
      });
      if (abortController.signal.aborted) {
        throw new Error('Upload canceled.');
      }
      await supabaseMovieRepository.createB2Episode(
        {
          seasonId: episodeSeasonId,
          episodeNumber: parsedNumber,
          title: episodeTitle,
          durationSeconds: parsedDuration,
          fileExtension: episodeFile.fileExtension,
          mimeType: episodeFile.mimeType,
          fileSizeBytes: episodeFile.size,
          allowDownload: episodeAllowDownload,
          published: episodePublished,
        },
        storageKey,
      );
      setEpisodeFile(null);
      setEpisodeTitle('');
      setEpisodeNumber('');
      setEpisodeDuration('');
      setEpisodeRightsConfirmed(false);
      setEpisodeAllowDownload(false);
      setFormMessage('Episode uploaded and saved.');
      setProgress(100);
      await loadMovies();
    } catch (error) {
      console.error('[AdminScreen] Episode upload failed.');
      setFormError(error instanceof Error ? error.message : 'The episode could not be uploaded. Retry.');
    } finally {
      if (uploadAbortController.current === abortController) {
        uploadAbortController.current = null;
      }
      setUploadingFile(null);
      setIsUploading(false);
    }
  }, [
    episodeAllowDownload,
    episodeDuration,
    episodeFile,
    episodeNumber,
    episodePublished,
    episodeRightsConfirmed,
    episodeSeasonId,
    episodeTitle,
    loadMovies,
  ]);

  const handleTogglePublishing = useCallback(
    async (movie: AdminMovie) => {
      if (!supabaseMovieRepository) {
        return;
      }

      setUpdatingMovieId(movie.id);
      setMoviesError(undefined);
      try {
        await supabaseMovieRepository.setPublished(movie.id, !movie.published);
        await loadMovies();
      } catch (error) {
        console.error('[AdminScreen] Could not change movie publishing status.', error);
        setMoviesError('The movie status could not be updated. Please retry.');
      } finally {
        setUpdatingMovieId(undefined);
      }
    },
    [loadMovies],
  );

  const openEditTitle = useCallback((movie: AdminMovie) => {
    setEditingMovie(movie);
    setEditTitle(movie.title);
    setEditDescription(movie.description ?? '');
    setEditYear(movie.year === undefined ? '' : String(movie.year));
    setEditRating(movie.contentRating ?? '');
    setEditPosterUrl(movie.posterUrl ?? '');
    setEditCoverUrl(movie.coverUrl ?? '');
    setEditPosterImage(undefined);
    setEditCoverImage(undefined);
    setEditTrailerFile(null);
    setEditTrailerRemoved(false);
    setEditTrailerDuration(movie.trailerDurationSeconds ? String(movie.trailerDurationSeconds) : '');
    setEditPublished(movie.published);
    setEditCategories(movie.categories ?? []);
    setEditRightsConfirmed(false);
    setEditError(undefined);
  }, []);

  const chooseEditImage = useCallback(async (kind: 'poster' | 'cover') => {
    setEditError(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const asset = result.assets[0];
      const sourceFile = asset.file ?? new ExpoFile(asset.uri);
      const size = typeof asset.size === 'number' ? asset.size : sourceFile.size;
      const validation = validateTitleImage(asset.name, asset.mimeType, size);
      if (!validation.valid) {
        setEditError(validation.message);
        return;
      }
      const compressed = await compressTitleImage(
        asset.uri,
        kind === 'poster' ? 600 : 1280,
        kind === 'poster' ? 900 : 720,
      );
      const image = { uri: compressed.uri, name: asset.name, size: compressed.blob.size, blob: compressed.blob };
      if (kind === 'poster') {
        setEditPosterImage(image);
      } else {
        setEditCoverImage(image);
      }
    } catch (error) {
      console.error('[AdminScreen] Edit image selection failed.', error);
      setEditError(error instanceof Error ? error.message : 'Could not prepare this image.');
    }
  }, []);

  const saveEditedTitle = useCallback(async () => {
    const repository = supabaseMovieRepository;
    if (!repository || !editingMovie) {
      return;
    }
    if (!editTitle.trim()) {
      setEditError('Enter a title.');
      return;
    }
    const parsedYear = editYear.trim() ? Number(editYear) : undefined;
    const parsedTrailerDuration = editTrailerDuration.trim()
      ? Number(editTrailerDuration)
      : undefined;
    if (parsedYear !== undefined && (!Number.isInteger(parsedYear) || parsedYear < 1888 || parsedYear > 2200)) {
      setEditError('Enter a valid release year.');
      return;
    }
    if (
      parsedTrailerDuration !== undefined &&
      (!Number.isInteger(parsedTrailerDuration) || parsedTrailerDuration < 1 || parsedTrailerDuration > 86400)
    ) {
      setEditError('Enter a valid trailer duration in seconds.');
      return;
    }
    if ((editPosterImage || editCoverImage || editTrailerFile) && !editRightsConfirmed) {
      setEditError('Confirm that you have the legal rights to distribute the replacement image or trailer.');
      return;
    }

    setEditSaving(true);
    setEditError(undefined);
    let uploadedPosterUrl: string | undefined;
    let uploadedCoverUrl: string | undefined;
    let uploadedTrailerKey: string | undefined;
    let updateSucceeded = false;
    const controller = new AbortController();
    uploadAbortController.current = controller;
    try {
      if (editPosterImage) {
        uploadedPosterUrl = await repository.uploadTitleImage(editPosterImage.blob, 'image/jpeg');
      }
      if (editCoverImage) {
        uploadedCoverUrl = await repository.uploadTitleImage(editCoverImage.blob, 'image/jpeg');
      }
      let trailerStorageKey = editTrailerRemoved ? undefined : editingMovie.trailerStorageKey;
      let trailerSizeBytes = editTrailerRemoved ? undefined : editingMovie.trailerSizeBytes;
      let trailerContentType = editTrailerRemoved ? undefined : editingMovie.trailerContentType;
      let trailerDurationSeconds = editTrailerRemoved ? undefined : editingMovie.trailerDurationSeconds;
      if (editTrailerFile) {
        if (!supabase) {
          throw new Error('Connect Supabase before replacing a trailer.');
        }
        const { data, error } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (error || !accessToken) {
          throw new Error('Your admin session expired. Sign in again before replacing a trailer.');
        }
        setIsUploading(true);
        setUploadingFile(editTrailerFile);
        setUploadingStage('Uploading trailer');
        setProgress(0);
        trailerStorageKey = await uploadVideoToB2({
          apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
          accessToken,
          file: {
            size: editTrailerFile.size,
            readPart: (start, end, contentType) =>
              readVideoPart(editTrailerFile.file, start, end, contentType),
          },
          fileName: editTrailerFile.name,
          contentType: editTrailerFile.contentType,
          kind: 'trailer',
          signal: controller.signal,
          onProgress: setProgress,
        });
        uploadedTrailerKey = trailerStorageKey;
        trailerSizeBytes = editTrailerFile.size;
        trailerContentType = editTrailerFile.contentType;
        trailerDurationSeconds = parsedTrailerDuration;
      }

      const update: AdminTitleUpdate = {
        title: editTitle,
        description: editDescription,
        ...(parsedYear === undefined ? {} : { releaseYear: parsedYear }),
        categories: editCategories,
        ...(editRating.trim() ? { contentRating: editRating.trim() } : {}),
        posterUrl: uploadedPosterUrl ?? (editPosterUrl.trim() || undefined),
        coverUrl: uploadedCoverUrl ?? (editCoverUrl.trim() || undefined),
        ...(trailerStorageKey ? { trailerStorageKey } : {}),
        ...(trailerSizeBytes === undefined ? {} : { trailerSizeBytes }),
        ...(trailerDurationSeconds === undefined ? {} : { trailerDurationSeconds }),
        ...(trailerContentType ? { trailerContentType } : {}),
        published: editPublished,
      };
      await repository.updateAdminTitle(editingMovie.id, update);
      updateSucceeded = true;
      setEditingMovie(undefined);
      await loadMovies();

      const oldImages = [editingMovie.posterUrl, editingMovie.coverUrl];
      const nextImages = [update.posterUrl, update.coverUrl];
      const cleanup: Promise<void>[] = [];
      oldImages.forEach((oldUrl, index) => {
        if (oldUrl && oldUrl !== nextImages[index]) {
          cleanup.push(repository.deleteTitleImage(oldUrl));
        }
      });
      const oldTrailer = editingMovie.trailerStorageKey;
      if (oldTrailer && oldTrailer !== trailerStorageKey && supabase) {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          throw new Error('Title saved, but sign in again to remove the replaced trailer.');
        }
        cleanup.push(
          deleteUploadedB2Object({
            apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
            accessToken,
            key: oldTrailer,
          }),
        );
      }
      await Promise.all(cleanup);
    } catch (error) {
      if (!updateSucceeded) {
        const cleanup: Promise<unknown>[] = [];
        if (uploadedPosterUrl) {
          cleanup.push(repository.deleteTitleImage(uploadedPosterUrl));
        }
        if (uploadedCoverUrl) {
          cleanup.push(repository.deleteTitleImage(uploadedCoverUrl));
        }
        if (uploadedTrailerKey && supabase) {
          const { data } = await supabase.auth.getSession();
          const accessToken = data.session?.access_token;
          if (accessToken) {
            cleanup.push(
              deleteUploadedB2Object({
                apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
                accessToken,
                key: uploadedTrailerKey,
              }),
            );
          }
        }
        await Promise.all(
          cleanup.map((operation) =>
            operation.catch((cleanupError: unknown) => {
              console.error('[AdminScreen] Edit cleanup failed.', cleanupError);
            }),
          ),
        );
        setEditError(error instanceof Error ? error.message : 'Could not save this title. Retry.');
      } else {
        console.error('[AdminScreen] Title saved but old files could not be removed.', error);
        setMoviesError('Title saved, but one or more replaced files could not be removed. Retry cleanup from Backblaze or Supabase.');
      }
    } finally {
      if (uploadAbortController.current === controller) {
        uploadAbortController.current = null;
      }
      setUploadingFile(null);
      setIsUploading(false);
      setEditSaving(false);
    }
  }, [
    editCoverImage,
    editCoverUrl,
    editCategories,
    editDescription,
    editPublished,
    editPosterImage,
    editPosterUrl,
    editRating,
    editRightsConfirmed,
    editTitle,
    editTrailerDuration,
    editTrailerFile,
    editTrailerRemoved,
    editYear,
    editingMovie,
    loadMovies,
  ]);

  const toggleTitleDownloads = useCallback(async (movie: AdminMovie, enabled: boolean) => {
    const repository = supabaseMovieRepository;
    if (!repository) {
      return;
    }
    setUpdatingMovieId(movie.id);
    setEditError(undefined);
    try {
      await repository.setDownloadsAllowed(movie.id, enabled);
      setMovies((current) => current.map((item) => item.id === movie.id
        ? { ...item, allowDownload: enabled }
        : item));
      setEditingMovie((current) => current?.id === movie.id
        ? { ...current, allowDownload: enabled }
        : current);
    } catch (error) {
      console.error('[AdminScreen] Could not update download setting.', error);
      const message = 'Could not update the download setting. Check your connection and retry.';
      setEditError(message);
      setMoviesError(message);
    } finally {
      setUpdatingMovieId(undefined);
    }
  }, []);

  const removeTitleCleanupAsset = useCallback(
    async (asset: TitleCleanupAsset, accessToken: string) => {
      const repository = supabaseMovieRepository;
      if (!repository) {
        throw new Error('Supabase is not configured.');
      }
      if (asset.kind === 'b2') {
        await deleteUploadedB2Object({
          apiBaseUrl: process.env.EXPO_PUBLIC_GENIUZ_API_URL ?? '',
          accessToken,
          key: asset.key,
        });
      } else if (asset.kind === 'supabase-video') {
        await repository.deleteSupabaseMovieVideo(asset.path);
      } else {
        await repository.deleteTitleImage(asset.url);
      }
    },
    [],
  );

  const savePendingCleanups = useCallback(async (items: PendingTitleCleanup[]) => {
    await titleCleanupStore.save(items);
    setPendingCleanups(items);
    setCleanupError(undefined);
  }, []);

  const retryCleanup = useCallback(async (job: PendingTitleCleanup) => {
    if (!supabase) {
      setCleanupError('Supabase is not configured; cleanup cannot be retried.');
      return;
    }
    setRetryingCleanupId(job.titleId);
    setCleanupError(undefined);
    try {
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        throw new Error('Your admin session expired. Sign in again before retrying cleanup.');
      }
      const result = await retryTitleCleanup(job, (asset) =>
        removeTitleCleanupAsset(asset, accessToken),
      );
      logTitleCleanupFailures(result.failures);
      const next = pendingCleanups.filter((item) => item.titleId !== job.titleId);
      if (result.pending) {
        next.push(result.pending);
      }
      await savePendingCleanups(next);
      if (result.pending) {
        const failedKinds = [...new Set(result.pending.assets.map((asset) => getTitleCleanupFailureMessage(asset.kind)))];
        setCleanupError(`Cleanup still needs attention: ${failedKinds.join(', ')} could not be removed.`);
      }
    } catch (error) {
      console.error('[AdminScreen] Could not retry title file cleanup.', error);
      setCleanupError(error instanceof Error ? error.message : 'Cleanup could not be retried.');
    } finally {
      setRetryingCleanupId(undefined);
    }
  }, [pendingCleanups, removeTitleCleanupAsset, savePendingCleanups]);

  const deleteAdminTitle = useCallback(async (movie: AdminMovie) => {
    const repository = supabaseMovieRepository;
    if (!repository || !supabase) {
      return;
    }
    setUpdatingMovieId(movie.id);
    setMoviesError(undefined);
    try {
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        throw new Error('Your admin session expired. Sign in again before deleting a title.');
      }
      let assets;
      try {
        assets = await repository.getAdminTitleAssets(movie.id);
      } catch (error) {
        console.error('[AdminScreen] Could not inspect title files before deletion.', error);
        throw new Error('Files step failed: the title files could not be listed, so the record was left unchanged.');
      }
      const cleanupAssets: TitleCleanupAsset[] = [
        ...assets.b2Keys.map((key) => ({ kind: 'b2' as const, key })),
        ...assets.supabaseVideoPaths.map((path) => ({ kind: 'supabase-video' as const, path })),
        ...assets.images.map((url) => ({ kind: 'image' as const, url })),
      ];
      let result;
      try {
        result = await deleteRecordThenCleanup(
          { titleId: movie.id, title: movie.title, assets: cleanupAssets },
          () => repository.deleteAdminTitleRecord(movie.id),
          (asset) => removeTitleCleanupAsset(asset, accessToken),
        );
      } catch (error) {
        console.error('[AdminScreen] Title record deletion failed.', error);
        throw new Error(
          `Record step failed: ${error instanceof Error ? error.message : 'the title record was not deleted'}`,
        );
      }
      logTitleCleanupFailures(result.failures);
      if (result.pending) {
        const next = [
          ...pendingCleanups.filter((item) => item.titleId !== movie.id),
          result.pending,
        ];
        await savePendingCleanups(next);
        const failedKinds = [...new Set(result.pending.assets.map((asset) => getTitleCleanupFailureMessage(asset.kind)))];
        setCleanupError(`The title was deleted, but cleanup failed for its ${failedKinds.join(' and ')}. Retry cleanup below.`);
      } else {
        await savePendingCleanups(pendingCleanups.filter((item) => item.titleId !== movie.id));
      }
      await loadMovies();
    } catch (error) {
      console.error('[AdminScreen] Could not delete title and its files.', error);
      setMoviesError(error instanceof Error ? error.message : 'Could not delete this title. Retry.');
    } finally {
      setUpdatingMovieId(undefined);
    }
  }, [loadMovies, pendingCleanups, removeTitleCleanupAsset, savePendingCleanups]);

  const adminSeries = movies.filter((movie) => movie.type === 'series');
  const availableSeasons = seasons.filter((season) => season.series_id === seasonSeriesId);

  const toggleTitleSelection = (movieId: string) => {
    setSelectedTitleIds((current) => current.includes(movieId)
      ? current.filter((id) => id !== movieId)
      : [...current, movieId]);
  };

  const deleteSelectedTitles = useCallback(async () => {
    const selectedMovies = movies.filter((movie) => selectedTitleIds.includes(movie.id));
    if (!selectedMovies.length) {
      return;
    }

    Alert.alert(
      'Delete selected titles?',
      `This permanently removes ${selectedMovies.length} title(s): ${selectedMovies.map(({ title }) => title).join(', ')}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete selected (${selectedMovies.length})`,
          style: 'destructive',
          onPress: async () => {
            for (const movie of selectedMovies) {
              await deleteAdminTitle(movie);
            }
            setSelectedTitleIds([]);
            setSelectMode(false);
          },
        },
      ],
    );
  }, [deleteAdminTitle, movies, selectedTitleIds]);

  if (!authLoading && routeState === 'not-found') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.sectionTitle}>Page not found</Text>
        <Pressable accessibilityRole="button" onPress={() => backOrReplace('/(tabs)/profile')} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!authLoading && routeState === 'sign-in') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <Pressable accessibilityRole="button" onPress={() => backOrReplace('/(tabs)/profile')} style={styles.backButton}>
            <Text style={styles.backText}>‹  Back</Text>
          </Pressable>
          <Text style={styles.header}>Admin sign in</Text>
          <View style={styles.card}>
            <Text style={styles.helper}>Use the administrator account configured in Supabase.</Text>
            <KeyboardAwareTextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={theme.secondaryText}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              style={styles.input}
            />
            <KeyboardAwareTextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.secondaryText}
              autoCapitalize="none"
              autoComplete="password"
              secureTextEntry
              textContentType="password"
              style={styles.input}
            />
            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={isSigningIn || !email.trim() || !password}
              onPress={() => void handleSignIn()}
              style={[styles.primaryButton, (isSigningIn || !email.trim() || !password) && styles.disabledButton]}
            >
              <Text style={styles.primaryButtonText}>{isSigningIn ? 'Signing in…' : 'Sign in'}</Text>
            </Pressable>
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    );
  }

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Pressable accessibilityRole="button" onPress={() => backOrReplace('/(tabs)/profile')} style={styles.backButton}>
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>
        <Text style={styles.header}>Admin console</Text>
        <ContentNotice message="Admin tools need an internet connection. Your saved videos and local downloads are unchanged." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={moviesLoading}
            onRefresh={() => void loadMovies()}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <Pressable accessibilityRole="button" onPress={() => backOrReplace('/(tabs)/profile')} style={styles.backButton}>
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>
        <Text style={styles.header}>Admin console</Text>
        <Text style={styles.subtitle}>Upload and manage movies you have rights to distribute.</Text>

        {!isSupabaseConfigured ? (
          <ContentNotice
            message={
              supabaseConfigurationError ??
              'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to your local .env file, then restart Expo.'
            }
            tone="warning"
          />
        ) : authLoading ? (
          <ContentNotice message="Checking your admin session…" />
        ) : !session ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Admin sign in</Text>
            <Text style={styles.helper}>
              Admin accounts are created in the Supabase dashboard. Public sign-up is disabled.
            </Text>
            <KeyboardAwareTextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={theme.secondaryText}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              style={styles.input}
            />
            <KeyboardAwareTextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.secondaryText}
              autoCapitalize="none"
              autoComplete="password"
              secureTextEntry
              textContentType="password"
              style={styles.input}
            />
            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={isSigningIn || !email.trim() || !password}
              onPress={() => void handleSignIn()}
              style={[styles.primaryButton, (isSigningIn || !email.trim() || !password) && styles.disabledButton]}
            >
              <Text style={styles.primaryButtonText}>{isSigningIn ? 'Signing in…' : 'Sign in'}</Text>
            </Pressable>
          </View>
        ) : !isAdmin ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Admin access required</Text>
            <Text style={styles.helper}>
              This account is not assigned the admin role. Ask a project owner to grant the admin
              role in Supabase, then sign out and back in.
            </Text>
            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => void handleSignOut()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/admin-status')}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>System status</Text>
            </Pressable>
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <View style={styles.grow}>
                  <Text style={styles.sectionTitle}>Upload a {contentKind === 'short' ? 'short video' : 'movie'}</Text>
                  <Text style={styles.helper}>
                    Videos upload directly to private Backblaze storage in 16 MiB parts.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={isUploading}
                  onPress={() => void handleSignOut()}
                >
                  <Text style={styles.linkText}>Sign out</Text>
                </Pressable>
              </View>

              <View style={styles.contentKindRow}>
                {(['movie', 'short'] as const).map((kind) => (
                  <Pressable
                    key={kind}
                    accessibilityRole="button"
                    accessibilityState={{ selected: contentKind === kind }}
                    disabled={isUploading}
                    onPress={() => {
                      setContentKind(kind);
                      if (kind === 'short') {
                        setCategories((current) => current.includes('Shorts') ? current : [...current, 'Shorts']);
                      } else {
                        setCategories((current) => current.filter((category) => category !== 'Shorts'));
                      }
                    }}
                    style={[styles.contentKindButton, contentKind === kind && styles.contentKindButtonSelected]}
                  >
                    <Text style={[styles.contentKindText, contentKind === kind && styles.contentKindTextSelected]}>
                      {kind === 'short' ? 'Short video' : 'Movie'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {inputFields.map((field) => {
                const value =
                  field.key === 'title'
                    ? title
                    : field.key === 'description'
                      ? description
                      : field.key === 'year'
                        ? year
                        : field.key === 'genres'
                          ? genres
                          : field.key === 'runtime'
                            ? runtime
                            : field.key === 'rating'
                              ? contentRating
                              : posterUrl;
                const onChangeText =
                  field.key === 'title'
                    ? setTitle
                    : field.key === 'description'
                      ? setDescription
                      : field.key === 'year'
                        ? setYear
                        : field.key === 'genres'
                          ? setGenres
                          : field.key === 'runtime'
                            ? setRuntime
                            : field.key === 'rating'
                              ? setContentRating
                              : setPosterUrl;

                return (
                  <View key={field.key} style={styles.field}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <KeyboardAwareTextInput
                      value={value}
                      onChangeText={onChangeText}
                      placeholder={field.placeholder}
                      placeholderTextColor={theme.secondaryText}
                      style={[styles.input, 'multiline' in field && field.multiline && styles.multilineInput]}
                      keyboardType={'keyboardType' in field ? field.keyboardType : 'default'}
                      multiline={'multiline' in field && field.multiline}
                      textAlignVertical={'multiline' in field && field.multiline ? 'top' : 'center'}
                      accessibilityLabel={field.label}
                      editable={!isUploading}
                    />
                  </View>
                );
              })}

              <View style={styles.filePicker}>
                <Text style={styles.filePickerTitle}>{selectedTrailer?.name ?? 'Optional trailer'}</Text>
                <Text style={styles.helper}>
                  {selectedTrailer
                    ? formatFileSize(selectedTrailer.size)
                    : 'Common video formats up to 300 MB; trailers are not downloadable.'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isUploading}
                  onPress={() => void chooseTrailer()}
                >
                  <Text style={styles.linkText}>{selectedTrailer ? 'Replace trailer' : 'Choose trailer'}</Text>
                </Pressable>
                {selectedTrailer ? (
                  <Pressable accessibilityRole="button" disabled={isUploading} onPress={() => setSelectedTrailer(null)}>
                    <Text style={styles.removeText}>Remove trailer</Text>
                  </Pressable>
                ) : null}
                <AdminTextField
                  label="Trailer duration (seconds, optional)"
                  value={trailerDuration}
                  onChangeText={setTrailerDuration}
                  keyboardType="number-pad"
                />
                {isUploading && uploadingFile === seriesTrailer ? (
                  <>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.helper}>Uploading trailer {progress}%</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => uploadAbortController.current?.abort()}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>Cancel trailer upload</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
              <AdminTitleImagePicker
                label="Poster"
                uri={posterImage?.uri ?? (posterUrl || undefined)}
                disabled={isUploading}
                hint="Portrait 2:3 (about 600×900). JPG, PNG, or WebP; up to 5 MB, optimized to about 500 KB. Your legal-rights confirmation is required."
                onChoose={() => void chooseTitleImage('poster')}
                onRemove={() => {
                  setPosterImage(undefined);
                  setPosterUrl('');
                }}
              />
              <CategoryPicker selected={categories} onChange={setCategories} disabled={isUploading} />
              <AdminTitleImagePicker
                label="Cover"
                uri={coverImage?.uri}
                disabled={isUploading}
                hint="Landscape 16:9 (about 1280×720). JPG, PNG, or WebP; up to 5 MB, optimized to about 500 KB. Your legal-rights confirmation is required."
                onChoose={() => void chooseTitleImage('cover')}
                onRemove={() => setCoverImage(undefined)}
              />

              <Pressable
                accessibilityRole="button"
                disabled={isUploading}
                onPress={() => void chooseMovie()}
                style={styles.filePicker}
              >
                <Text style={styles.filePickerTitle}>
                  {selectedFile ? selectedFile.name : 'Choose a video'}
                </Text>
                <Text style={styles.helper}>
                  {selectedFile
                    ? formatFileSize(selectedFile.size)
                    : 'Select a video file from your phone or computer.'}
                </Text>
              </Pressable>
              <Text style={styles.helper}>
                Any video format up to 1 GB. MP4 plays on every device; MKV and other formats may not play on iPhones.
              </Text>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: confirmedRights }}
                disabled={isUploading}
                onPress={() => setConfirmedRights((current) => !current)}
                style={styles.checkRow}
              >
                <View style={[styles.checkbox, confirmedRights && styles.checkedBox]}>
                  {confirmedRights ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={styles.checkLabel}>
                  I confirm I have the legal rights to distribute this movie.
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: publishImmediately }}
                disabled={isUploading}
                onPress={() => setPublishImmediately((current) => !current)}
                style={styles.checkRow}
              >
                <View style={[styles.checkbox, publishImmediately && styles.checkedBox]}>
                  {publishImmediately ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={styles.checkLabel}>Publish when the upload completes.</Text>
              </Pressable>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allowDownload }}
                disabled={isUploading}
                onPress={() => setAllowDownload((current) => !current)}
                style={styles.checkRow}
              >
                <View style={[styles.checkbox, allowDownload && styles.checkedBox]}>
                  {allowDownload ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={styles.checkLabel}>Allow users to download this title.</Text>
              </Pressable>

              {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
              {formMessage ? <Text style={styles.successText}>{formMessage}</Text> : null}
              {pendingMovieSave ? (
                <View>
                  <Text style={styles.helper}>
                    The video is safely in Backblaze, but its catalog record was not saved. Retry saving without re-uploading, or delete the orphaned video.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isRetryingMovieSave}
                    onPress={() => void retryMovieSave()}
                    style={[styles.primaryButton, isRetryingMovieSave && styles.disabledButton]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {isRetryingMovieSave ? 'Saving…' : 'Retry saving'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isRetryingMovieSave}
                    onPress={() =>
                      Alert.alert(
                        'Delete orphaned video?',
                        'This permanently deletes the uploaded B2 video. No movie record will be created.',
                        [
                          { text: 'Keep video', style: 'cancel' },
                          {
                            text: 'Delete video',
                            style: 'destructive',
                            onPress: () => void deleteOrphanedMovieUpload(),
                          },
                        ],
                      )
                    }
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>Delete orphaned video</Text>
                  </Pressable>
                </View>
              ) : null}
              {isUploading && uploadingFile ? (
                <>
                  <View
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: 100, now: progress }}
                    style={styles.progressWrap}
                  >
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.helper}>
                      {uploadingStage} {progress}% · {formatFileSize(uploadingFile.size * progress / 100)} of{' '}
                      {formatFileSize(uploadingFile.size)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => uploadAbortController.current?.abort()}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>Cancel upload</Text>
                  </Pressable>
                </>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={isUploading || !selectedFile || !title.trim()}
                onPress={() => void handleUpload()}
                style={[
                  styles.primaryButton,
                  (isUploading || !selectedFile || !title.trim()) && styles.disabledButton,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isUploading ? 'Uploading…' : 'Upload movie'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Add series</Text>
              <Text style={styles.helper}>Create a series title before adding seasons and episodes.</Text>
              <AdminTextField label="Series title" value={seriesTitle} onChangeText={setSeriesTitle} />
              <AdminTextField label="Description" value={seriesDescription} onChangeText={setSeriesDescription} multiline />
              <AdminTextField label="Release year" value={seriesYear} onChangeText={setSeriesYear} keyboardType="number-pad" />
              <AdminTextField label="Genres" value={seriesGenres} onChangeText={setSeriesGenres} />
              <CategoryPicker selected={seriesCategories} onChange={setSeriesCategories} disabled={isSavingSeries} />
              <AdminTextField label="Content rating" value={seriesContentRating} onChangeText={setSeriesContentRating} />
              <AdminTextField label="Poster image URL (optional)" value={seriesPosterUrl} onChangeText={setSeriesPosterUrl} />
              <View style={styles.filePicker}>
                <Text style={styles.filePickerTitle}>{seriesTrailer?.name ?? 'Optional series trailer'}</Text>
                <Text style={styles.helper}>
                  {seriesTrailer
                    ? formatFileSize(seriesTrailer.size)
                    : 'Common video formats up to 300 MB; trailers are not downloadable.'}
                </Text>
                <Pressable accessibilityRole="button" disabled={isSavingSeries} onPress={() => void chooseTrailer(true)}>
                  <Text style={styles.linkText}>{seriesTrailer ? 'Replace trailer' : 'Choose trailer'}</Text>
                </Pressable>
                {seriesTrailer ? (
                  <Pressable accessibilityRole="button" disabled={isSavingSeries} onPress={() => setSeriesTrailer(null)}>
                    <Text style={styles.removeText}>Remove trailer</Text>
                  </Pressable>
                ) : null}
                <AdminTextField
                  label="Trailer duration (seconds, optional)"
                  value={seriesTrailerDuration}
                  onChangeText={setSeriesTrailerDuration}
                  keyboardType="number-pad"
                />
              </View>
              <AdminTitleImagePicker
                label="Poster"
                uri={seriesPosterImage?.uri ?? (seriesPosterUrl || undefined)}
                disabled={isSavingSeries}
                hint="Portrait 2:3 (about 600×900). JPG, PNG, or WebP; up to 5 MB, optimized to about 500 KB. Your legal-rights confirmation is required."
                onChoose={() => void chooseTitleImage('poster', true)}
                onRemove={() => {
                  setSeriesPosterImage(undefined);
                  setSeriesPosterUrl('');
                }}
              />
              <AdminTitleImagePicker
                label="Cover"
                uri={seriesCoverImage?.uri}
                disabled={isSavingSeries}
                hint="Landscape 16:9 (about 1280×720). JPG, PNG, or WebP; up to 5 MB, optimized to about 500 KB. Your legal-rights confirmation is required."
                onChoose={() => void chooseTitleImage('cover', true)}
                onRemove={() => setSeriesCoverImage(undefined)}
              />
              <AdminCheckbox
                checked={seriesRightsConfirmed}
                disabled={isSavingSeries}
                label="I confirm I have the legal rights to distribute this series."
                onPress={() => setSeriesRightsConfirmed((current) => !current)}
              />
              <AdminCheckbox
                checked={seriesPublished}
                disabled={isSavingSeries}
                label="Publish this series."
                onPress={() => setSeriesPublished((current) => !current)}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isSavingSeries || !seriesTitle.trim()}
                onPress={() => void handleCreateSeries()}
                style={[styles.primaryButton, (isSavingSeries || !seriesTitle.trim()) && styles.disabledButton]}
              >
                <Text style={styles.primaryButtonText}>{isSavingSeries ? 'Saving series…' : 'Add series'}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Add season</Text>
              <Text style={styles.helper}>Choose a series and create a numbered season.</Text>
              <Text style={styles.fieldLabel}>Series</Text>
              <View style={styles.choiceList}>
                {adminSeries.map((series) => {
                  const seriesId = series.id.replace(/^geniuz:series:/, '');
                  const selected = seasonSeriesId === seriesId;
                  return (
                    <Pressable
                      key={series.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      disabled={isSavingSeason}
                      onPress={() => {
                        setSeasonSeriesId(seriesId);
                        setEpisodeSeasonId('');
                      }}
                      style={[styles.choiceButton, selected && styles.selectedChoice]}
                    >
                      <Text style={[styles.choiceText, selected && styles.selectedChoiceText]}>{series.title}</Text>
                    </Pressable>
                  );
                })}
                {!adminSeries.length ? <Text style={styles.helper}>Create a series first.</Text> : null}
              </View>
              <AdminTextField label="Season number" value={seasonNumber} onChangeText={setSeasonNumber} keyboardType="number-pad" />
              <AdminTextField label="Season year (optional)" value={seasonYear} onChangeText={setSeasonYear} keyboardType="number-pad" />
              <Pressable
                accessibilityRole="button"
                disabled={isSavingSeason || !seasonSeriesId || !seasonNumber}
                onPress={() => void handleCreateSeason()}
                style={[styles.primaryButton, (isSavingSeason || !seasonSeriesId || !seasonNumber) && styles.disabledButton]}
              >
                <Text style={styles.primaryButtonText}>{isSavingSeason ? 'Saving season…' : 'Add season'}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Add episode</Text>
              <Text style={styles.helper}>Episode videos upload to private Backblaze storage in 16 MiB parts.</Text>
              <Text style={styles.fieldLabel}>Season</Text>
              <View style={styles.choiceList}>
                {availableSeasons.map((season) => {
                  const series = adminSeries.find((item) => item.id.endsWith(season.series_id));
                  const selected = episodeSeasonId === season.id;
                  return (
                    <Pressable
                      key={season.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      disabled={isUploading}
                      onPress={() => setEpisodeSeasonId(season.id)}
                      style={[styles.choiceButton, selected && styles.selectedChoice]}
                    >
                      <Text style={[styles.choiceText, selected && styles.selectedChoiceText]}>
                        {series?.title ?? 'Series'} · Season {season.season_number}
                      </Text>
                    </Pressable>
                  );
                })}
                {!availableSeasons.length ? (
                  <Text style={styles.helper}>Choose a series and add a season first.</Text>
                ) : null}
              </View>
              <AdminTextField label="Episode number" value={episodeNumber} onChangeText={setEpisodeNumber} keyboardType="number-pad" />
              <AdminTextField label="Episode title" value={episodeTitle} onChangeText={setEpisodeTitle} />
              <AdminTextField label="Duration (seconds)" value={episodeDuration} onChangeText={setEpisodeDuration} keyboardType="number-pad" />
              <Pressable
                accessibilityRole="button"
                disabled={isUploading}
                onPress={() => void chooseEpisodeFile()}
                style={styles.filePicker}
              >
                <Text style={styles.filePickerTitle}>{episodeFile?.name ?? 'Choose episode video'}</Text>
                <Text style={styles.helper}>
                  {episodeFile
                    ? formatFileSize(episodeFile.size)
                    : 'Any video format up to 1 GB. MP4 is the most compatible.'}
                </Text>
              </Pressable>
              <AdminCheckbox
                checked={episodeRightsConfirmed}
                disabled={isUploading}
                label="I confirm I have the legal rights to distribute this episode."
                onPress={() => setEpisodeRightsConfirmed((current) => !current)}
              />
              <AdminCheckbox
                checked={episodePublished}
                disabled={isUploading}
                label="Publish this episode when upload completes."
                onPress={() => setEpisodePublished((current) => !current)}
              />
              <AdminCheckbox
                checked={episodeAllowDownload}
                disabled={isUploading}
                label="Allow users to download this episode."
                onPress={() => setEpisodeAllowDownload((current) => !current)}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isUploading || !episodeFile || !episodeTitle.trim() || !episodeSeasonId}
                onPress={() => void handleUploadEpisode()}
                style={[styles.primaryButton, (isUploading || !episodeFile || !episodeTitle.trim() || !episodeSeasonId) && styles.disabledButton]}
              >
                <Text style={styles.primaryButtonText}>{isUploading ? 'Uploading…' : 'Add episode'}</Text>
              </Pressable>
            </View>

            <View style={styles.catalogHeader}>
              <Text style={styles.sectionTitle}>Content catalog</Text>
              <Pressable accessibilityRole="button" onPress={() => void loadMovies()}>
                <Text style={styles.linkText}>Refresh</Text>
              </Pressable>
            </View>
            {moviesLoading ? <ContentNotice message="Loading uploaded movies…" /> : null}
            {moviesError ? (
              <ContentNotice
                message={moviesError}
                tone="error"
                actionLabel="Retry"
                onAction={() => void loadMovies()}
              />
            ) : null}
            {seriesError ? (
              <ContentNotice
                message={seriesError}
                tone="warning"
                actionLabel="Retry"
                onAction={() => void loadMovies()}
              />
            ) : null}
            {cleanupError ? (
              <ContentNotice
                message={cleanupError}
                tone="warning"
              />
            ) : null}
            {pendingCleanups.map((job) => (
              <View key={job.titleId} style={styles.cleanupRow}>
                <View style={styles.grow}>
                  <Text style={styles.movieTitle}>Cleanup needed · {job.title}</Text>
                  <Text style={styles.helper}>
                    {job.assets.map((asset) => getTitleCleanupFailureMessage(asset.kind)).join(', ')}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Retry cleanup for ${job.title}`}
                  disabled={retryingCleanupId === job.titleId}
                  onPress={() => void retryCleanup(job)}
                  style={styles.smallButton}
                >
                  <Text style={styles.smallButtonText}>
                    {retryingCleanupId === job.titleId ? 'Retrying…' : 'Retry cleanup'}
                  </Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Backblaze cleanup</Text>
              <Text style={styles.helper}>
                Finds media older than {unusedMediaScan?.minimumAgeHours ?? '24'} hours that is no longer referenced by any title.
              </Text>
              {unusedMediaError ? <ContentNotice message={unusedMediaError} tone="error" /> : null}
              {unusedMediaDeleteSummary ? (
                <Text style={styles.successText}>
                  Deleted {unusedMediaDeleteSummary.deleted} file{unusedMediaDeleteSummary.deleted === 1 ? '' : 's'}.
                  {unusedMediaDeleteSummary.failures ? ` ${unusedMediaDeleteSummary.failures} failed.` : ''}
                  {unusedMediaDeleteSummary.skipped ? ` ${unusedMediaDeleteSummary.skipped} were left alone.` : ''}
                </Text>
              ) : null}
              {unusedMediaScan ? (
                <View style={styles.cleanupRow}>
                  <View style={styles.grow}>
                    <Text style={styles.movieTitle}>{unusedMediaScan.files.length} unused files</Text>
                    <Text style={styles.helper}>{formatFileSize(unusedMediaScan.totalSizeBytes)} total</Text>
                    {unusedMediaScan.files.slice(0, 10).map((file) => (
                      <Text key={file.key} style={styles.helper}>{file.key}</Text>
                    ))}
                    {unusedMediaScan.files.length > 10 ? (
                      <Text style={styles.helper}>…and {unusedMediaScan.files.length - 10} more</Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
              <View style={styles.bulkActionsRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isScanningUnusedMedia}
                  onPress={() => void runUnusedMediaScan()}
                  style={[styles.secondaryButton, isScanningUnusedMedia && styles.disabledButton]}
                >
                  <Text style={styles.secondaryButtonText}>{isScanningUnusedMedia ? 'Finding…' : 'Find unused files'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!unusedMediaScan || isDeletingUnusedMedia}
                  onPress={() => void deleteUnusedMedia()}
                  style={[styles.primaryButton, (!unusedMediaScan || isDeletingUnusedMedia) && styles.disabledButton]}
                >
                  <Text style={styles.primaryButtonText}>{isDeletingUnusedMedia ? 'Deleting…' : 'Delete unused files'}</Text>
                </Pressable>
              </View>
            </View>
            {!moviesLoading && !moviesError && movies.length === 0 ? (
              <Text style={styles.helper}>No uploaded movies yet.</Text>
            ) : null}
            {movies.length ? (
              <View style={styles.bulkActionsRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSelectMode((current) => !current)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>{selectMode ? 'Cancel select' : 'Select titles'}</Text>
                </Pressable>
                {selectMode ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={selectedTitleIds.length === 0}
                    onPress={() => void deleteSelectedTitles()}
                    style={[styles.primaryButton, selectedTitleIds.length === 0 && styles.disabledButton]}
                  >
                    <Text style={styles.primaryButtonText}>Delete selected ({selectedTitleIds.length})</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {movies.map((movie) => (
              <View key={movie.id} style={styles.movieRow}>
                {selectMode ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedTitleIds.includes(movie.id) }}
                    onPress={() => toggleTitleSelection(movie.id)}
                    style={[styles.selectionBox, selectedTitleIds.includes(movie.id) && styles.selectionBoxSelected]}
                  >
                    {selectedTitleIds.includes(movie.id) ? <Text style={styles.selectionCheck}>✓</Text> : null}
                  </Pressable>
                ) : null}
                <TitleImage uri={movie.posterUrl} style={styles.catalogPoster} iconSize={18} />
                <View style={styles.grow}>
                  <Text style={styles.movieTitle}>{movie.title}</Text>
                  <Text style={styles.helper}>
                    {movie.year ?? 'Year not set'} · {movie.published ? 'Published' : 'Draft'}
                  </Text>
                  <View style={styles.badgeRow}>
                    <Text style={styles.catalogBadge}>{movie.posterUrl ? 'Has poster' : 'No poster'}</Text>
                    <Text style={styles.catalogBadge}>{movie.coverUrl ? 'Has cover' : 'No cover'}</Text>
                    <Text style={styles.catalogBadge}>{movie.trailerStorageKey ? 'Has trailer' : 'No trailer'}</Text>
                    <Text style={styles.catalogBadge}>
                      Downloads {movie.allowDownload ? 'on' : 'off'}
                    </Text>
                  </View>
                </View>

                <View style={[styles.statusPill, movie.published ? styles.published : styles.draft]}>
                  <Text style={styles.statusText}>{movie.published ? 'Live' : 'Draft'}</Text>
                </View>
                {movie.mediaPath || movie.type === 'series' ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={updatingMovieId === movie.id}
                    onPress={() => void handleTogglePublishing(movie)}
                  >
                    <Text style={styles.linkText}>
                      {updatingMovieId === movie.id
                        ? 'Saving…'
                        : movie.published
                          ? 'Unpublish'
                          : 'Publish'}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" onPress={() => openEditTitle(movie)}>
                  <Text style={styles.linkText}>Edit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={updatingMovieId === movie.id}
                  onPress={() =>
                    Alert.alert(
                      'Delete title?',
                      `This permanently deletes "${movie.title}", its video/trailer, images, and series episodes.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete title',
                          style: 'destructive',
                          onPress: () => void deleteAdminTitle(movie),
                        },
                      ],
                    )
                  }
                >
                  <Text style={styles.removeText}>
                    {updatingMovieId === movie.id ? 'Deleting…' : 'Delete'}
                  </Text>
                </Pressable>
              </View>
            ))}
            <Modal
              visible={Boolean(editingMovie)}
              transparent
              animationType="slide"
              onRequestClose={() => {
                if (!editSaving) {
                  setEditingMovie(undefined);
                }
              }}
            >
              <View style={styles.editBackdrop}>
                <KeyboardAwareScrollView contentContainerStyle={styles.editPanel}>
                  <View style={styles.catalogHeader}>
                    <Text style={styles.sectionTitle}>Edit title</Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={editSaving}
                      onPress={() => setEditingMovie(undefined)}
                    >
                      <Text style={styles.linkText}>Close</Text>
                    </Pressable>
                  </View>
                  <AdminTextField label="Title" value={editTitle} onChangeText={setEditTitle} />
                  <AdminTextField label="Description" value={editDescription} onChangeText={setEditDescription} multiline />
                  <AdminTextField label="Release year" value={editYear} onChangeText={setEditYear} keyboardType="number-pad" />
                  <CategoryPicker selected={editCategories} onChange={setEditCategories} disabled={editSaving} />
                  <AdminTextField label="Content rating" value={editRating} onChangeText={setEditRating} />
                  <AdminTextField label="Poster image URL (optional)" value={editPosterUrl} onChangeText={setEditPosterUrl} />
                  <AdminTitleImagePicker
                    label="Poster"
                    uri={editPosterImage?.uri ?? (editPosterUrl || undefined)}
                    disabled={editSaving}
                    hint="Portrait 2:3; JPG, PNG, or WebP, up to 5 MB."
                    onChoose={() => void chooseEditImage('poster')}
                    onRemove={() => {
                      setEditPosterImage(undefined);
                      setEditPosterUrl('');
                    }}
                  />
                  <AdminTitleImagePicker
                    label="Cover"
                    uri={editCoverImage?.uri ?? (editCoverUrl || undefined)}
                    disabled={editSaving}
                    hint="Landscape 16:9; JPG, PNG, or WebP, up to 5 MB."
                    onChoose={() => void chooseEditImage('cover')}
                    onRemove={() => {
                      setEditCoverImage(undefined);
                      setEditCoverUrl('');
                    }}
                  />
                  <View style={styles.filePicker}>
                    <Text style={styles.filePickerTitle}>
                      {editTrailerFile?.name ?? (editingMovie?.trailerStorageKey ? 'Trailer attached' : 'No trailer')}
                    </Text>
                    <Text style={styles.helper}>Common video formats, up to 300 MB. Trailers are never downloadable.</Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={editSaving}
                      onPress={() =>
                        void chooseVideoFile('trailer').then((file) => {
                          if (file) {
                            setEditTrailerFile(file);
                            setEditTrailerRemoved(false);
                          }
                        })
                      }
                    >
                      <Text style={styles.linkText}>Replace trailer</Text>
                    </Pressable>
                    {editingMovie?.trailerStorageKey || editTrailerFile ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={editSaving}
                        onPress={() => {
                          setEditTrailerFile(null);
                          setEditTrailerRemoved(true);
                        }}
                      >
                        <Text style={styles.removeText}>Remove trailer</Text>
                      </Pressable>
                    ) : null}
                    <AdminTextField
                      label="Trailer duration (seconds, optional)"
                      value={editTrailerDuration}
                      onChangeText={setEditTrailerDuration}
                      keyboardType="number-pad"
                    />
                  </View>
                  {editTrailerFile && editSaving ? (
                    <>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress}%` }]} />
                      </View>
                      <Text style={styles.helper}>Uploading trailer {progress}%</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => uploadAbortController.current?.abort()}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryButtonText}>Cancel trailer upload</Text>
                      </Pressable>
                    </>
                  ) : null}
                  <AdminCheckbox
                    checked={editPublished}
                    disabled={editSaving}
                    label="Published (Live)"
                    onPress={() => setEditPublished((current) => !current)}
                  />
                  {editingMovie ? (
                    <AdminCheckbox
                      checked={editingMovie.allowDownload}
                      disabled={updatingMovieId === editingMovie.id}
                      label="Allow downloads (updates immediately)"
                      onPress={() => void toggleTitleDownloads(editingMovie, !editingMovie.allowDownload)}
                    />
                  ) : null}
                  <AdminCheckbox
                    checked={editRightsConfirmed}
                    disabled={editSaving}
                    label="I confirm I have the legal rights to distribute any replacement image or trailer."
                    onPress={() => setEditRightsConfirmed((current) => !current)}
                  />
                  {editError ? <Text style={styles.errorText}>{editError}</Text> : null}
                  <Pressable
                    accessibilityRole="button"
                    disabled={editSaving || !editingMovie}
                    onPress={() => void saveEditedTitle()}
                    style={[styles.primaryButton, editSaving && styles.disabledButton]}
                  >
                    <Text style={styles.primaryButtonText}>{editSaving ? 'Saving…' : 'Save changes'}</Text>
                  </Pressable>
                </KeyboardAwareScrollView>
              </View>
            </Modal>
          </>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 40,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: 12,
  },
  backText: {
    color: theme.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  header: {
    color: theme.text,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 8,
    letterSpacing: -0.8,
  },
  subtitle: {
    color: theme.secondaryText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 18,
  },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  contentKindRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  contentKindButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: theme.border },
  contentKindButtonSelected: { backgroundColor: theme.accent, borderColor: theme.accent },
  contentKindText: { color: theme.secondaryText, fontWeight: '700', fontSize: 13 },
  contentKindTextSelected: { color: theme.background },
  sectionTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '800',
  },
  helper: {
    color: theme.secondaryText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  field: {
    marginTop: 10,
  },
  fieldLabel: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },
  input: {
    color: theme.text,
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  multilineInput: {
    minHeight: 96,
  },
  choiceList: {
    gap: 8,
    marginTop: 6,
  },
  choiceButton: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  selectedChoice: {
    borderColor: theme.accent,
    backgroundColor: theme.surfaceAlt,
  },
  choiceText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  selectedChoiceText: {
    color: theme.accent,
  },
  filePicker: {
    marginTop: 16,
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    padding: 15,
  },
  filePickerTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  imagePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 14,
    padding: 12,
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
  },
  imagePreview: {
    width: 74,
    height: 100,
    borderRadius: 8,
    backgroundColor: theme.surfaceAlt,
  },
  removeText: {
    color: theme.error,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.secondaryText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkedBox: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  checkMark: {
    color: theme.background,
    fontSize: 15,
    fontWeight: '900',
  },
  checkLabel: {
    color: theme.muted,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: theme.accent,
    borderRadius: 999,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  disabledButton: {
    opacity: 0.48,
  },
  primaryButtonText: {
    color: theme.background,
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: theme.text,
    fontWeight: '700',
  },
  errorText: {
    color: theme.error,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  successText: {
    color: theme.success,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  progressWrap: {
    marginTop: 16,
  },
  progressTrack: {
    backgroundColor: theme.surfaceSoft,
    borderRadius: 5,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: theme.accent,
    height: '100%',
  },
  catalogHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  linkText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  movieRow: {
    alignItems: 'center',
    flexWrap: 'wrap',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 14,
  },
  bulkActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  selectionBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.background,
  },
  selectionBoxSelected: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  selectionCheck: {
    color: theme.background,
    fontSize: 14,
    fontWeight: '900',
  },
  cleanupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  smallButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: theme.accent,
  },
  smallButtonText: {
    color: theme.background,
    fontSize: 12,
    fontWeight: '800',
  },
  catalogPoster: {
    width: 42,
    height: 60,
    borderRadius: 7,
    backgroundColor: theme.surfaceAlt,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 6,
  },
  catalogBadge: {
    overflow: 'hidden',
    color: theme.secondaryText,
    backgroundColor: theme.background,
    borderRadius: 999,
    fontSize: 9,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  editBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  editPanel: {
    maxHeight: '94%',
    backgroundColor: theme.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
  },
  grow: {
    flex: 1,
  },
  movieTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  published: {
    backgroundColor: 'rgba(88,214,141,0.15)',
  },
  draft: {
    backgroundColor: 'rgba(244,201,93,0.15)',
  },
  statusText: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '700',
  },
});
