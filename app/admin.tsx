import { router } from 'expo-router';
import { File as ExpoFile, FileMode } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import type { Session } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ContentNotice } from '../src/components/ContentNotice';
import { MAX_VIDEO_FILE_SIZE_BYTES } from '../src/constants/video';
import type { ContentItem } from '../src/models/content';
import { supabaseMovieRepository } from '../src/repositories/SupabaseMovieRepository';
import { uploadVideoToB2 } from '../src/services/B2UploadService';
import {
  isSupabaseConfigured,
  supabase,
  supabaseConfigurationError,
} from '../src/services/supabase';
import { theme } from '../src/theme';
import { detectVideoFileType, validateVideoFileSize } from '../src/utils/videoFile';

type AdminMovie = ContentItem & {
  published: boolean;
  createdAt: string;
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

export default function AdminScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string>();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [year, setYear] = useState('');
  const [genres, setGenres] = useState('');
  const [runtime, setRuntime] = useState('');
  const [contentRating, setContentRating] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<SelectedMovieFile | null>(null);
  const [confirmedRights, setConfirmedRights] = useState(false);
  const [publishImmediately, setPublishImmediately] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [formMessage, setFormMessage] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [movies, setMovies] = useState<AdminMovie[]>([]);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [moviesError, setMoviesError] = useState<string>();
  const [updatingMovieId, setUpdatingMovieId] = useState<string>();
  const uploadAbortController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      uploadAbortController.current?.abort();
    },
    [],
  );

  const loadMovies = useCallback(async () => {
    if (!supabaseMovieRepository) {
      return;
    }

    setMoviesLoading(true);
    setMoviesError(undefined);
    try {
      setMovies(await supabaseMovieRepository.getAdminMovies());
    } catch (error) {
      console.error('[AdminScreen] Could not load movies.', error);
      setMoviesError('The movie catalog could not be loaded. Check your connection and retry.');
    } finally {
      setMoviesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
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
  }, [loadMovies]);

  const isAdmin = session?.user.app_metadata?.role === 'admin';

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
        setAuthError('Sign-in failed. Check your email and password, then try again.');
      } else if (data.user.app_metadata?.role === 'admin') {
        await loadMovies();
      }
    } catch (error) {
      console.error('[AdminScreen] Admin sign-in failed.', error);
      setAuthError('Could not sign in. Check your connection and try again.');
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

  const chooseMovie = useCallback(async () => {
    setFormError(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: false,
        base64: false,
      });
      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      const detectedType = detectVideoFileType(asset.name, asset.mimeType);
      if (!detectedType) {
        setFormError('Choose a video file. Supported formats include MP4, MOV, MKV, AVI, WebM, M4V, 3GP, TS, FLV, and WMV.');
        return;
      }

      const file = asset.file ?? new ExpoFile(asset.uri);
      const fileSize = typeof file.size === 'number' ? file.size : Number.NaN;
      const sizeValidation = validateVideoFileSize(fileSize, MAX_VIDEO_FILE_SIZE_BYTES);
      if (!sizeValidation.valid) {
        setFormError(sizeValidation.message);
        return;
      }

      setSelectedFile({
        file,
        name: asset.name,
        size: fileSize,
        fileExtension: detectedType.originalExtension,
        storageExtension: detectedType.extension,
        mimeType: asset.mimeType?.trim() || detectedType.mimeType,
        contentType: detectedType.mimeType,
      });
    } catch (error) {
      console.error('[AdminScreen] Video picker failed.', error);
      setFormError('Could not open the video picker. Please try again.');
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!supabaseMovieRepository || !supabase || !selectedFile) {
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
    if (
      (parsedYear !== undefined &&
        (!Number.isInteger(parsedYear) || parsedYear < 1888 || parsedYear > 2200)) ||
      (parsedRuntime !== undefined &&
        (!Number.isInteger(parsedRuntime) || parsedRuntime < 1 || parsedRuntime > 1000))
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
    setProgress(0);
    setFormError(undefined);
    setFormMessage(undefined);
    const abortController = new AbortController();
    uploadAbortController.current = abortController;
    try {
      const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionResult.session?.access_token;
      if (sessionError || !accessToken) {
        throw new Error('Your admin session expired. Sign in again before uploading.', {
          cause: sessionError,
        });
      }
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
      if (abortController.signal.aborted) {
        throw new Error('Upload canceled.');
      }
      await supabaseMovieRepository.createB2Movie(
        {
          title,
          description,
          ...(parsedYear === undefined ? {} : { releaseYear: parsedYear }),
          genres: genres
            .split(',')
            .map((genre) => genre.trim())
            .filter(Boolean),
          ...(posterUrl.trim() ? { posterUrl: posterUrl.trim() } : {}),
          ...(parsedRuntime === undefined ? {} : { runtimeMinutes: parsedRuntime }),
          ...(contentRating.trim() ? { contentRating: contentRating.trim() } : {}),
          published: publishImmediately,
          allowDownload,
          fileExtension: selectedFile.fileExtension,
          storageExtension: selectedFile.storageExtension,
          mimeType: selectedFile.mimeType,
          contentType: selectedFile.contentType,
          fileSizeBytes: selectedFile.size,
        },
        storageKey,
      );

      setFormMessage(
        publishImmediately
          ? 'Movie uploaded and published. It is now available in the app.'
          : 'Movie uploaded as a draft. Publish it from the catalog below when it is ready.',
      );
      setSelectedFile(null);
      setTitle('');
      setDescription('');
      setYear('');
      setGenres('');
      setRuntime('');
      setContentRating('');
      setPosterUrl('');
      setConfirmedRights(false);
      setAllowDownload(false);
      setProgress(100);
      await loadMovies();
    } catch (error) {
      console.error('[AdminScreen] Movie upload failed.');
      setFormError(
        error instanceof Error
          ? error.message
          : 'The movie could not be uploaded. Check your connection and retry.',
      );
    } finally {
      if (uploadAbortController.current === abortController) {
        uploadAbortController.current = null;
      }
      setIsUploading(false);
    }
  }, [
    confirmedRights,
    contentRating,
    description,
    genres,
    allowDownload,
    loadMovies,
    posterUrl,
    publishImmediately,
    runtime,
    selectedFile,
    title,
    year,
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
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
            <TextInput
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
            <TextInput
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
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <View style={styles.grow}>
                  <Text style={styles.sectionTitle}>Upload a movie</Text>
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
                    <TextInput
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
              {isUploading ? (
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
                      Uploading {progress}% · {formatFileSize((selectedFile?.size ?? 0) * progress / 100)} of{' '}
                      {formatFileSize(selectedFile?.size ?? 0)}
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
                  {isUploading ? 'Uploading movie…' : 'Upload movie'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.catalogHeader}>
              <Text style={styles.sectionTitle}>Movie catalog</Text>
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
            {!moviesLoading && !moviesError && movies.length === 0 ? (
              <Text style={styles.helper}>No uploaded movies yet.</Text>
            ) : null}
            {movies.map((movie) => (
              <View key={movie.id} style={styles.movieRow}>
                <View style={styles.grow}>
                  <Text style={styles.movieTitle}>{movie.title}</Text>
                  <Text style={styles.helper}>
                    {movie.year ?? 'Year not set'} · {movie.published ? 'Published' : 'Draft'}
                  </Text>
                </View>
                <View style={[styles.statusPill, movie.published ? styles.published : styles.draft]}>
                  <Text style={styles.statusText}>{movie.published ? 'Live' : 'Draft'}</Text>
                </View>
                {movie.mediaPath ? (
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
              </View>
            ))}
          </>
        )}
      </ScrollView>
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
    color: '#FF8D8D',
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
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 14,
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
