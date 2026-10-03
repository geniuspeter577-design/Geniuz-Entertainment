import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Upload } from 'tus-js-client';

import type { ContentItem } from '../models/content';
import { supabase } from '../services/supabase';

const MOVIE_BUCKET = 'movie-assets';
const MOVIE_COLUMNS =
  'id,title,description,release_year,genres,poster_url,runtime_minutes,content_rating,video_path,published,file_extension,mime_type,file_size_bytes,allow_download,storage_provider,storage_key';
const TUS_STORAGE_PREFIX = '@geniuz/tus-upload/v1/';

type MovieRecord = {
  id: string;
  title: string;
  description: string | null;
  release_year: number | null;
  genres: string[] | null;
  poster_url: string | null;
  runtime_minutes: number | null;
  content_rating: string | null;
  video_path: string | null;
  published: boolean;
  file_extension: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  allow_download: boolean;
  storage_provider: 'supabase' | 'b2' | null;
  storage_key: string | null;
};

type StoredTusUpload = {
  size: number | null;
  metadata: Record<string, string>;
  creationTime: string;
  urlStorageKey: string;
  uploadUrl: string | null;
  parallelUploadUrls: string[] | null;
};

export type NewMovie = {
  title: string;
  description: string;
  releaseYear?: number;
  genres: string[];
  posterUrl?: string;
  runtimeMinutes?: number;
  contentRating?: string;
  published: boolean;
  allowDownload: boolean;
  fileExtension: string | null;
  storageExtension: string;
  mimeType: string;
  contentType: string;
  fileSizeBytes: number;
};

type PublishMovieOptions = {
  draftId?: string;
  onDraftCreated?: (draftId: string | undefined) => void;
};

const tusUrlStorage = {
  async findAllUploads() {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(TUS_STORAGE_PREFIX));
    const values = await AsyncStorage.multiGet(keys);
    return values.flatMap(([, value]) =>
      value === null ? [] : (JSON.parse(value) as StoredTusUpload[]),
    );
  },
  async findUploadsByFingerprint(fingerprint: string) {
    const value = await AsyncStorage.getItem(`${TUS_STORAGE_PREFIX}${encodeURIComponent(fingerprint)}`);
    return value === null ? [] : (JSON.parse(value) as StoredTusUpload[]);
  },
  async removeUpload(urlStorageKey: string) {
    await AsyncStorage.removeItem(urlStorageKey);
  },
  async addUpload(fingerprint: string, upload: StoredTusUpload) {
    const key = `${TUS_STORAGE_PREFIX}${encodeURIComponent(fingerprint)}`;
    await AsyncStorage.setItem(key, JSON.stringify([{ ...upload, urlStorageKey: key }]));
    return key;
  },
};

function toContentItem(movie: MovieRecord): ContentItem {
  return {
    id: `geniuz:movie:${movie.id}`,
    source: 'geniuz',
    sourceId: movie.id,
    title: movie.title,
    type: 'movie',
    ...(movie.release_year === null ? {} : { year: movie.release_year }),
    genres: movie.genres ?? [],
    ...(movie.poster_url ? { posterUrl: movie.poster_url, backdropUrl: movie.poster_url } : {}),
    ...(movie.description ? { description: movie.description } : {}),
    ...(movie.runtime_minutes === null ? {} : { runtimeMinutes: movie.runtime_minutes }),
    ...(movie.content_rating ? { contentRating: movie.content_rating } : {}),
    ...((movie.storage_provider === 'b2' ? movie.storage_key : movie.video_path)
      ? { mediaPath: movie.storage_provider === 'b2' ? movie.storage_key! : movie.video_path! }
      : {}),
    ...(movie.storage_provider ? { storageProvider: movie.storage_provider } : {}),
    ...(movie.storage_key ? { storageKey: movie.storage_key } : {}),
    ...(movie.file_extension ? { fileExtension: movie.file_extension } : {}),
    ...(movie.mime_type ? { mimeType: movie.mime_type } : {}),
    ...(movie.file_size_bytes === null ? {} : { fileSizeBytes: Number(movie.file_size_bytes) }),
    availability: {
      discoverable:
        movie.published &&
        (movie.storage_provider === 'b2' ? movie.storage_key !== null : movie.video_path !== null),
      stream:
        movie.published &&
        (movie.storage_provider === 'b2' ? movie.storage_key !== null : movie.video_path !== null),
      download: movie.allow_download,
      premium: false,
    },
  };
}

function getProjectRef(url: string) {
  const parsedUrl = new URL(url);
  const parts = parsedUrl.hostname.split('.');
  return parts.length > 2 && parts[1] === 'supabase' ? parts[0] : undefined;
}

export class SupabaseMovieRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly projectUrl: string,
    private readonly publishableKey: string,
  ) {}

  async getPublished() {
    const { data, error } = await this.client
      .from('movies')
      .select(MOVIE_COLUMNS)
      .eq('published', true)
      .or('video_path.not.is.null,storage_key.not.is.null')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('Could not load published movies.', { cause: error });
    }

    return (data as MovieRecord[]).map(toContentItem);
  }

  async searchPublished(query: string, genre?: string) {
    const normalizedQuery = query.trim();
    const movies = await this.getPublished();
    const normalized = normalizedQuery.toLocaleLowerCase();
    const normalizedGenre = genre?.toLocaleLowerCase();
    return movies.filter((movie) => {
      const matchesQuery =
        !normalized ||
        movie.title.toLocaleLowerCase().includes(normalized) ||
        movie.genres.some((movieGenre) => movieGenre.toLocaleLowerCase().includes(normalized));
      const matchesGenre =
        !normalizedGenre || movie.genres.some((movieGenre) => movieGenre.toLocaleLowerCase() === normalizedGenre);
      return matchesQuery && matchesGenre;
    });
  }

  async getById(id: string) {
    const movieId = id.replace(/^geniuz:movie:/, '');
    if (movieId === id) {
      return null;
    }

    const { data, error } = await this.client
      .from('movies')
      .select(MOVIE_COLUMNS)
      .eq('id', movieId)
      .maybeSingle();

    if (error) {
      throw new Error('Could not load this movie.', { cause: error });
    }

    if (!data) {
      return null;
    }

    const movie = toContentItem(data as MovieRecord);
    return movie.availability.discoverable ? movie : null;
  }

  async getAdminMovies() {
    const { data, error } = await this.client
      .from('movies')
      .select(`${MOVIE_COLUMNS},created_at`)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('Could not load the admin movie catalog.', { cause: error });
    }

    return (data as (MovieRecord & { created_at: string })[]).map((movie) => ({
      ...toContentItem(movie),
      published: movie.published,
      createdAt: movie.created_at,
    }));
  }

  async publishMovie(
    movie: NewMovie,
    file: Blob,
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
    options: PublishMovieOptions = {},
  ) {
    const movieFields = {
      title: movie.title.trim(),
      description: movie.description.trim() || null,
      release_year: movie.releaseYear ?? null,
      genres: movie.genres,
      poster_url: movie.posterUrl?.trim() || null,
      runtime_minutes: movie.runtimeMinutes ?? null,
      content_rating: movie.contentRating?.trim() || null,
      file_extension: movie.fileExtension,
      mime_type: movie.mimeType,
      file_size_bytes: movie.fileSizeBytes,
      allow_download: movie.allowDownload,
      published: false,
    };
    let draftId = options.draftId;
    if (draftId) {
      const { data, error } = await this.client
        .from('movies')
        .update(movieFields)
        .eq('id', draftId)
        .is('video_path', null)
        .select('id')
        .maybeSingle();
      if (error || !data) {
        throw new Error('Could not resume the movie upload. Start a new upload and try again.', {
          cause: error,
        });
      }
    } else {
      const { data: draft, error: draftError } = await this.client
        .from('movies')
        .insert(movieFields)
        .select('id')
        .single();
      if (draftError) {
        throw new Error('Could not create the movie record.', { cause: draftError });
      }
      draftId = draft.id;
      options.onDraftCreated?.(draftId);
    }

    const path = `movies/${draftId}${movie.storageExtension ? `.${movie.storageExtension}` : ''}`;
    let uploaded = false;

    try {
      const { data: sessionResult, error: sessionError } = await this.client.auth.getSession();
      if (sessionError) {
        throw new Error('Could not read the authenticated session.', { cause: sessionError });
      }
      if (!sessionResult.session) {
        throw new Error('Your admin session expired. Sign in again before uploading.');
      }

      const projectRef = getProjectRef(this.projectUrl);
      const uploadEndpoint = projectRef
        ? `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
        : `${this.projectUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable`;

      await new Promise<void>((resolve, reject) => {
        const upload = new Upload(file, {
          endpoint: uploadEndpoint,
          headers: {
            apikey: this.publishableKey,
            authorization: `Bearer ${sessionResult.session.access_token}`,
          },
          metadata: {
            bucketName: MOVIE_BUCKET,
            objectName: path,
            contentType: movie.contentType,
            cacheControl: '3600',
          },
          chunkSize: 6 * 1024 * 1024,
          retryDelays: [0, 3000, 5000, 10000, 20000, 30000, 60000, 120000, 300000, 600000],
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          urlStorage: tusUrlStorage,
          onProgress: (bytesUploaded, bytesTotal) => {
            onProgress(Math.round((bytesUploaded / bytesTotal) * 100));
          },
          onError: (error) => {
            signal?.removeEventListener('abort', abortUpload);
            reject(error);
          },
          onSuccess: () => {
            signal?.removeEventListener('abort', abortUpload);
            resolve();
          },
        });
        const abortUpload = () => {
          void upload
            .abort(true)
            .then(() => reject(new Error('Movie upload canceled.')))
            .catch(reject);
        };

        if (signal?.aborted) {
          reject(new Error('Movie upload canceled.'));
          return;
        }
        signal?.addEventListener('abort', abortUpload, { once: true });

        void upload
          .findPreviousUploads()
          .then((previousUploads) => {
            if (signal?.aborted) {
              return;
            }
            if (previousUploads.length) {
              upload.resumeFromPreviousUpload(previousUploads[0]);
            }
            upload.start();
          })
          .catch((error: unknown) => {
            signal?.removeEventListener('abort', abortUpload);
            reject(error);
          });
      });

      uploaded = true;
      const { error: updateError } = await this.client
        .from('movies')
        .update({ video_path: path, published: movie.published })
        .eq('id', draftId);

      if (updateError) {
        throw new Error('The video uploaded, but its movie record could not be published.', {
          cause: updateError,
        });
      }
      options.onDraftCreated?.(undefined);
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      if (uploaded) {
        const { error } = await this.client.storage.from(MOVIE_BUCKET).remove([path]);
        if (error) {
          cleanupErrors.push(error);
        }
      }

      const canceled = signal?.aborted || (error instanceof Error && error.message === 'Movie upload canceled.');
      if (uploaded || canceled) {
        const { error: deleteError } = await this.client.from('movies').delete().eq('id', draftId);
        if (deleteError) {
          cleanupErrors.push(deleteError);
        } else {
          options.onDraftCreated?.(undefined);
        }
      }

      if (cleanupErrors.length) {
        console.error('[SupabaseMovieRepository] Upload cleanup failed.', cleanupErrors);
        throw new Error(
          'Movie upload failed and automatic cleanup was incomplete. Check the Supabase admin catalog before retrying.',
          { cause: error },
        );
      }

      throw error;
    }
  }

  async createB2Movie(movie: NewMovie, storageKey: string) {
    const { data, error } = await this.client
      .from('movies')
      .insert({
        title: movie.title.trim(),
        description: movie.description.trim() || null,
        release_year: movie.releaseYear ?? null,
        genres: movie.genres,
        poster_url: movie.posterUrl?.trim() || null,
        runtime_minutes: movie.runtimeMinutes ?? null,
        content_rating: movie.contentRating?.trim() || null,
        file_extension: movie.fileExtension,
        mime_type: movie.mimeType,
        file_size_bytes: movie.fileSizeBytes,
        allow_download: movie.allowDownload,
        storage_provider: 'b2',
        storage_key: storageKey,
        video_path: null,
        published: movie.published,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error('The video uploaded, but its movie record could not be saved.', {
        cause: error,
      });
    }
  }

  async getSignedPlaybackUrl(path: string) {
    const { data, error } = await this.client.storage
      .from(MOVIE_BUCKET)
      .createSignedUrl(path, 60 * 60);

    if (error) {
      throw new Error('Could not prepare this movie for playback.', { cause: error });
    }

    return data.signedUrl;
  }

  async getPlaybackUrl(movie: Pick<ContentItem, 'id' | 'mediaPath' | 'storageProvider'>) {
    if (!movie.mediaPath) {
      throw new Error('This movie does not have an available video file.');
    }
    if (movie.storageProvider !== 'b2') {
      return this.getSignedPlaybackUrl(movie.mediaPath);
    }

    const apiBaseUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim();
    if (!apiBaseUrl) {
      throw new Error('The Geniuz API is not configured. Restart the app after setting its URL.');
    }
    const { data, error: sessionError } = await this.client.auth.getSession();
    const accessToken = data.session?.access_token;
    if (sessionError || !accessToken) {
      throw new Error('Sign in with an authorized account to prepare this video.', {
        cause: sessionError,
      });
    }

    let response: Response;
    try {
      response = await fetch(
        `${apiBaseUrl.replace(/\/+$/, '')}/movies/${encodeURIComponent(
          movie.id.replace(/^geniuz:movie:/, ''),
        )}/play-url`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
    } catch (fetchError) {
      throw new Error('Could not reach the video service. Check your connection and retry.', {
        cause: fetchError,
      });
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch (parseError) {
      throw new Error('The video service returned an invalid response.', { cause: parseError });
    }
    if (!response.ok || typeof result !== 'object' || result === null || !('url' in result)) {
      const message =
        typeof result === 'object' &&
        result !== null &&
        'error' in result &&
        typeof result.error === 'object' &&
        result.error !== null &&
        'message' in result.error &&
        typeof result.error.message === 'string'
          ? result.error.message
          : 'Could not prepare this movie for playback.';
      throw new Error(message);
    }
    if (typeof result.url !== 'string') {
      throw new Error('The video service returned an invalid playback URL.');
    }
    return result.url;
  }

  async setPublished(movieId: string, published: boolean) {
    const { error } = await this.client
      .from('movies')
      .update({ published })
      .eq('id', movieId.replace(/^geniuz:movie:/, ''))
      .or('video_path.not.is.null,storage_key.not.is.null');

    if (error) {
      throw new Error('Could not update movie publishing status.', { cause: error });
    }
  }
}

const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const configuredKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseMovieRepository =
  supabase && configuredUrl && configuredKey
    ? new SupabaseMovieRepository(supabase, configuredUrl, configuredKey)
    : null;
