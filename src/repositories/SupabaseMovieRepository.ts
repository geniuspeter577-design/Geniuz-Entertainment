import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Upload } from 'tus-js-client';
import type { ContentItem, EpisodeItem, SeasonItem } from '../models/content';
import { supabase } from '../services/supabase';
import { PlaybackError } from '../utils/playbackError';
import { logSupabaseError } from '../utils/supabaseError';

const MOVIE_BUCKET = 'movie-assets';
const MOVIE_COLUMNS =
  'id,title,description,release_year,genres,categories,poster_url,cover_url,runtime_minutes,content_rating,video_path,published,file_extension,mime_type,file_size_bytes,allow_download,storage_provider,storage_key,content_type,trailer_storage_key,trailer_size_bytes,trailer_duration_seconds,trailer_content_type';
const TITLE_IMAGE_BUCKET = 'title-images';
const TUS_STORAGE_PREFIX = '@geniuz/tus-upload/v1/';

type MovieRecord = {
  id: string;
  created_at?: string;
  title: string;
  description: string | null;
  release_year: number | null;
  genres: string[] | null;
  categories?: string[] | null;
  poster_url: string | null;
  cover_url?: string | null;
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
  content_type: 'movie' | 'series' | 'short' | null;
  trailer_storage_key?: string | null;
  trailer_size_bytes?: number | null;
  trailer_duration_seconds?: number | null;
  trailer_content_type?: string | null;
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
  contentKind?: 'movie' | 'short';
  title: string;
  description: string;
  releaseYear?: number;
  genres: string[];
  categories: string[];
  posterUrl?: string;
  coverUrl?: string;
  runtimeMinutes?: number;
  contentRating?: string;
  published: boolean;
  allowDownload: boolean;
  fileExtension: string | null;
  storageExtension: string;
  mimeType: string;
  contentType: string;
  fileSizeBytes: number;
  trailerStorageKey?: string;
  trailerSizeBytes?: number;
  trailerDurationSeconds?: number;
  trailerContentType?: string;
};

export type AdminTitleUpdate = {
  title: string;
  description: string;
  releaseYear?: number;
  categories: string[];
  contentRating?: string;
  posterUrl?: string;
  coverUrl?: string;
  trailerStorageKey?: string;
  trailerSizeBytes?: number;
  trailerDurationSeconds?: number;
  trailerContentType?: string;
  published: boolean;
};

type NewSeries = {
  title: string;
  description: string;
  releaseYear?: number;
  genres: string[];
  categories: string[];
  posterUrl?: string;
  coverUrl?: string;
  contentRating?: string;
  published: boolean;
  trailerStorageKey?: string;
  trailerSizeBytes?: number;
  trailerDurationSeconds?: number;
  trailerContentType?: string;
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
  const isSeries = movie.content_type === 'series';
  const mediaPath = movie.storage_provider === 'b2' ? movie.storage_key : movie.video_path;
  const hasVideo = typeof mediaPath === 'string' && Boolean(mediaPath.trim());
  return {
    id: `geniuz:${isSeries ? 'series' : movie.content_type === 'short' ? 'short' : 'movie'}:${movie.id}`,
    source: 'geniuz',
    sourceId: movie.id,
    title: movie.title,
    ...(movie.created_at ? { createdAt: movie.created_at } : {}),
    type: isSeries ? 'series' : movie.content_type === 'short' ? 'short' : 'movie',
    ...(movie.release_year === null ? {} : { year: movie.release_year }),
    genres: movie.genres ?? [],
    categories: movie.categories ?? [],
    ...(movie.poster_url ? { posterUrl: movie.poster_url } : {}),
    ...(movie.cover_url ? { coverUrl: movie.cover_url, backdropUrl: movie.cover_url } : {}),
    ...(movie.description ? { description: movie.description } : {}),
    ...(movie.runtime_minutes === null ? {} : { runtimeMinutes: movie.runtime_minutes }),
    ...(movie.content_rating ? { contentRating: movie.content_rating } : {}),
    ...(hasVideo ? { mediaPath: mediaPath! } : {}),
    ...(movie.storage_provider ? { storageProvider: movie.storage_provider } : {}),
    ...(movie.storage_key ? { storageKey: movie.storage_key } : {}),
    ...(movie.file_extension ? { fileExtension: movie.file_extension } : {}),
    ...(movie.mime_type ? { mimeType: movie.mime_type } : {}),
    ...(movie.file_size_bytes === null ? {} : { fileSizeBytes: Number(movie.file_size_bytes) }),
    ...(movie.trailer_storage_key ? { trailerStorageKey: movie.trailer_storage_key } : {}),
    ...(movie.trailer_size_bytes == null ? {} : { trailerSizeBytes: Number(movie.trailer_size_bytes) }),
    ...(movie.trailer_duration_seconds == null
      ? {}
      : { trailerDurationSeconds: Number(movie.trailer_duration_seconds) }),
    ...(movie.trailer_content_type ? { trailerContentType: movie.trailer_content_type } : {}),
    availability: {
      discoverable: movie.published && (isSeries || hasVideo),
      stream: movie.published && !isSeries && hasVideo,
      download: movie.allow_download && !isSeries && hasVideo,
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

  async uploadTitleImage(blob: Blob, contentType: string) {
    const extension = contentType === 'image/png' ? 'png' : 'jpg';
    const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}.${extension}`;
    const { error } = await this.client.storage.from(TITLE_IMAGE_BUCKET).upload(path, blob, {
      contentType,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      throw new Error('Could not save the title image. Check the title-images bucket and try again.', {
        cause: error,
      });
    }
    return this.client.storage.from(TITLE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async deleteTitleImage(url: string | undefined) {
    if (!url) {
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    const marker = `/object/public/${TITLE_IMAGE_BUCKET}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) {
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
    } catch (error) {
      throw new Error('The stored title image URL is invalid.', { cause: error });
    }
    if (!path || path.includes('..')) {
      throw new Error('The stored title image path is invalid.');
    }
    const { error } = await this.client.storage.from(TITLE_IMAGE_BUCKET).remove([path]);
    if (error) {
      throw new Error('Could not remove the title image from storage.', { cause: error });
    }
  }

  async getPublishedMovies() {
    const { data, error } = await this.client
      .from('movies')
      .select(`${MOVIE_COLUMNS},created_at`)
      .eq('published', true)
      .eq('content_type', 'movie')
      .or('video_path.not.is.null,storage_key.not.is.null')
      .order('created_at', { ascending: false });

    if (error) {
      logSupabaseError('[SupabaseMovieRepository] Could not load published movies.', error, {
        table: 'movies',
        columns: `${MOVIE_COLUMNS},created_at`,
      });
      throw new Error('Could not load published movies.', { cause: error });
    }

    return (data as MovieRecord[]).map(toContentItem);
  }

  async getPublishedSeries() {
    const { data, error } = await this.client
      .from('movies')
      .select(`${MOVIE_COLUMNS},created_at`)
      .eq('published', true)
      .eq('content_type', 'series')
      .order('created_at', { ascending: false });

    if (error) {
      logSupabaseError('[SupabaseMovieRepository] Could not load published series.', error, {
        table: 'movies',
        columns: `${MOVIE_COLUMNS},created_at`,
      });
      throw new Error('Could not load published series.', { cause: error });
    }

    return (data as MovieRecord[]).map(toContentItem);
  }

  async getPublishedShorts() {
    const { data, error } = await this.client
      .from('movies')
      .select(`${MOVIE_COLUMNS},created_at`)
      .eq('published', true)
      .eq('content_type', 'short')
      .or('video_path.not.is.null,storage_key.not.is.null')
      .order('created_at', { ascending: false });

    if (error) {
      logSupabaseError('[SupabaseMovieRepository] Could not load published shorts.', error, {
        table: 'movies',
        columns: `${MOVIE_COLUMNS},created_at`,
      });
      throw new Error('Could not load published shorts.', { cause: error });
    }

    return (data as MovieRecord[]).map(toContentItem);
  }

  async getPublished() {
    const [moviesResult, seriesResult, shortsResult] = await Promise.allSettled([
      this.getPublishedMovies(),
      this.getPublishedSeries(),
      this.getPublishedShorts(),
    ]);
    const movies = moviesResult.status === 'fulfilled' ? moviesResult.value : [];
    const series = seriesResult.status === 'fulfilled' ? seriesResult.value : [];
    const shorts = shortsResult.status === 'fulfilled' ? shortsResult.value : [];
    if (
      moviesResult.status === 'rejected' &&
      seriesResult.status === 'rejected' &&
      shortsResult.status === 'rejected'
    ) {
      throw new AggregateError(
        [moviesResult.reason, seriesResult.reason, shortsResult.reason],
        'Could not load published titles.',
      );
    }
    return [...movies, ...series, ...shorts].sort((first, second) =>
      (second.createdAt ?? '').localeCompare(first.createdAt ?? ''),
    );
  }

  async searchPublished(query: string, genre?: string, year?: string) {
    const normalizedQuery = query.trim();
    const movies = await this.getPublished();
    const normalized = normalizedQuery.toLocaleLowerCase();
    const normalizedGenre = genre?.toLocaleLowerCase();
    return movies.filter((movie) => {
      const matchesQuery =
        !normalized ||
        movie.title.toLocaleLowerCase().includes(normalized) ||
        movie.genres.some((movieGenre) => movieGenre.toLocaleLowerCase().includes(normalized)) ||
        (movie.year !== undefined && String(movie.year).includes(normalized));
      const matchesGenre =
        !normalizedGenre || movie.genres.some((movieGenre) => movieGenre.toLocaleLowerCase() === normalizedGenre);
      const matchesYear = !year || String(movie.year ?? '') === year;
      return matchesQuery && matchesGenre && matchesYear;
    });
  }

  async getById(id: string) {
    const match = /^geniuz:(?:movie|series|short):(.+)$/.exec(id);
    if (!match) {
      return null;
    }
    const movieId = match[1];

    const { data, error } = await this.client
      .from('movies')
      .select(MOVIE_COLUMNS)
      .eq('id', movieId)
      .maybeSingle();

    if (error) {
      logSupabaseError('[SupabaseMovieRepository] Could not load this movie.', error, {
        table: 'movies',
        columns: MOVIE_COLUMNS,
      });
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
      allowDownload: movie.allow_download,
      createdAt: movie.created_at,
    }));
  }

  async updateAdminTitle(id: string, title: AdminTitleUpdate) {
    const { error } = await this.client
      .from('movies')
      .update({
        title: title.title.trim(),
        description: title.description.trim() || null,
        release_year: title.releaseYear ?? null,
        categories: title.categories,
        content_rating: title.contentRating?.trim() || null,
        poster_url: title.posterUrl?.trim() || null,
        cover_url: title.coverUrl?.trim() || null,
        trailer_storage_key: title.trailerStorageKey ?? null,
        trailer_size_bytes: title.trailerSizeBytes ?? null,
        trailer_duration_seconds: title.trailerDurationSeconds ?? null,
        trailer_content_type: title.trailerContentType ?? null,
        published: title.published,
      })
      .eq('id', id.replace(/^geniuz:(?:movie|series|short):/, ''));
    if (error) {
      throw new Error('Could not update this title.', { cause: error });
    }
  }

  async setDownloadsAllowed(id: string, allowDownload: boolean) {
    const { error } = await this.client
      .from('movies')
      .update({ allow_download: allowDownload })
      .eq('id', id.replace(/^geniuz:(?:movie|series|short):/, ''));
    if (error) {
      throw new Error('Could not update the download setting.', { cause: error });
    }
  }

  async getAdminTitleAssets(id: string) {
    const { data, error } = await this.client
      .from('movies')
      .select('storage_provider,storage_key,video_path,trailer_storage_key,poster_url,cover_url,content_type')
      .eq('id', id.replace(/^geniuz:(?:movie|series|short):/, ''))
      .single();
    if (error) {
      throw new Error('Could not load this title’s stored files.', { cause: error });
    }
    const b2Keys: string[] = [];
    const supabaseVideoPaths: string[] = [];
    if (data.storage_provider === 'b2' && typeof data.storage_key === 'string') {
      b2Keys.push(data.storage_key);
    }
    if (data.storage_provider === 'supabase' && typeof data.video_path === 'string') {
      supabaseVideoPaths.push(data.video_path);
    }
    if (typeof data.trailer_storage_key === 'string') {
      b2Keys.push(data.trailer_storage_key);
    }
    if (data.content_type === 'series') {
      const { data: episodes, error: episodeError } = await this.client
        .from('episodes')
        .select('storage_provider,storage_key,seasons!inner(series_id)')
        .eq('seasons.series_id', id.replace(/^geniuz:series:/, ''));
      if (episodeError) {
        throw new Error('Could not load this series’s stored episodes.', { cause: episodeError });
      }
      for (const episode of episodes ?? []) {
        if (typeof episode.storage_key !== 'string') {
          continue;
        }
        if (episode.storage_provider === 'b2') {
          b2Keys.push(episode.storage_key);
        } else {
          supabaseVideoPaths.push(episode.storage_key);
        }
      }
    }
    return {
      b2Keys,
      supabaseVideoPaths,
      images: [data.poster_url, data.cover_url].filter((url): url is string => typeof url === 'string'),
    };
  }

  async deleteAdminTitleRecord(id: string) {
    const { data, error } = await this.client
      .from('movies')
      .delete()
      .eq('id', id.replace(/^geniuz:(?:movie|series|short):/, ''))
      .select('id')
      .maybeSingle();
    if (error) {
      logSupabaseError('[SupabaseMovieRepository] Title record deletion failed.', error);
      throw new Error('The title record could not be deleted.', { cause: error });
    }
    if (!data) {
      throw new Error('The title record was not deleted. Confirm your admin role and try again.');
    }
  }

  async deleteSupabaseMovieVideo(path: string) {
    const { error } = await this.client.storage.from(MOVIE_BUCKET).remove([path]);
    if (error) {
      throw new Error('Could not remove the title’s Supabase video file.', { cause: error });
    }
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
      categories: movie.categories,
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
    const { data: existing, error: lookupError } = await this.client
      .from('movies')
      .select('id')
      .eq('storage_key', storageKey)
      .maybeSingle();
    if (lookupError) {
      throw new Error('The video uploaded, but its movie record could not be saved.', {
        cause: lookupError,
      });
    }
    if (existing) {
      return existing.id as string;
    }

    const { data, error } = await this.client
      .from('movies')
      .insert({
        title: movie.title.trim(),
        description: movie.description.trim() || null,
        release_year: movie.releaseYear ?? null,
        genres: movie.genres,
        categories: movie.categories,
        poster_url: movie.posterUrl?.trim() || null,
        cover_url: movie.coverUrl?.trim() || null,
        trailer_storage_key: movie.trailerStorageKey ?? null,
        trailer_size_bytes: movie.trailerSizeBytes ?? null,
        trailer_duration_seconds: movie.trailerDurationSeconds ?? null,
        trailer_content_type: movie.trailerContentType ?? null,
        runtime_minutes: movie.runtimeMinutes ?? null,
        content_rating: movie.contentRating?.trim() || null,
        file_extension: movie.fileExtension,
        mime_type: movie.mimeType,
        file_size_bytes: movie.fileSizeBytes,
        allow_download: movie.allowDownload,
        content_type: movie.contentKind ?? 'movie',
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
    return data.id as string;
  }

    async createSeries(series: NewSeries) {
      const { data, error } = await this.client
        .from('movies')
        .insert({
          title: series.title.trim(),
          description: series.description.trim() || null,
          release_year: series.releaseYear ?? null,
          genres: series.genres,
          categories: series.categories,
          poster_url: series.posterUrl?.trim() || null,
          cover_url: series.coverUrl?.trim() || null,
          trailer_storage_key: series.trailerStorageKey ?? null,
          trailer_size_bytes: series.trailerSizeBytes ?? null,
          trailer_duration_seconds: series.trailerDurationSeconds ?? null,
          trailer_content_type: series.trailerContentType ?? null,
          content_rating: series.contentRating?.trim() || null,
          runtime_minutes: null,
          content_type: 'series',
          storage_provider: 'supabase',
          storage_key: null,
          video_path: null,
          allow_download: false,
          published: series.published,
        })
        .select('id')
        .single();
      if (error || !data) {
        throw new Error('Could not create the series record.', { cause: error });
      }
      return `geniuz:series:${data.id}`;
    }

    async createSeason(seriesId: string, seasonNumber: number, releaseYear?: number) {
      const { data, error } = await this.client
        .from('seasons')
        .insert({
          series_id: seriesId.replace(/^geniuz:series:/, ''),
          season_number: seasonNumber,
          release_year: releaseYear ?? null,
          published: true,
        })
        .select('id')
        .single();
      if (error || !data) {
        throw new Error('Could not create the season.', { cause: error });
      }
      return data.id as string;
    }

    async getAdminSeasons() {
      const { data, error } = await this.client
        .from('seasons')
        .select('id,series_id,season_number,release_year,published')
        .order('season_number', { ascending: true });
      if (error) {
        throw new Error('Could not load the season catalog.', { cause: error });
      }
      return (data ?? []) as {
        id: string;
        series_id: string;
        season_number: number;
        release_year: number | null;
        published: boolean;
      }[];
    }

    async createB2Episode(
      episode: {
        seasonId: string;
        episodeNumber: number;
        title: string;
        durationSeconds: number;
        fileExtension: string | null;
        mimeType: string;
        fileSizeBytes: number;
        allowDownload: boolean;
        published: boolean;
      },
      storageKey: string,
    ) {
      const { data, error } = await this.client
        .from('episodes')
        .insert({
          season_id: episode.seasonId,
          episode_number: episode.episodeNumber,
          title: episode.title.trim(),
          duration_seconds: episode.durationSeconds,
          storage_provider: 'b2',
          storage_key: storageKey,
          file_extension: episode.fileExtension,
          mime_type: episode.mimeType,
          file_size_bytes: episode.fileSizeBytes,
          allow_download: episode.allowDownload,
          published: episode.published,
        })
        .select('id')
        .single();
      if (error || !data) {
        throw new Error('The episode video uploaded, but its record could not be saved.', { cause: error });
      }
      return data.id as string;
    }

    async getSeasons(seriesId: string) {
      const normalizedId = seriesId.replace(/^geniuz:series:/, '');
      const { data, error } = await this.client
        .from('seasons')
        .select('id,series_id,season_number,release_year,published')
        .eq('series_id', normalizedId)
        .order('season_number', { ascending: true });
      if (error) {
        logSupabaseError('[SupabaseMovieRepository] Could not load seasons for this series.', error, {
          table: 'seasons',
          columns: 'id,series_id,season_number,release_year,published',
        });
        throw new Error('Could not load seasons for this series.', { cause: error });
      }
      const seasons = (data ?? []) as {
        id: string;
        series_id: string;
        season_number: number;
        release_year: number | null;
        published: boolean;
      }[];
      const episodesResults = await Promise.allSettled(
        seasons.map((season) =>
          this.getEpisodesForSeason(season.id, normalizedId, season.season_number),
        ),
      );
      return seasons.map((season, index): SeasonItem => {
        const episodesResult = episodesResults[index];
        return {
          id: season.id,
          seriesId: season.series_id,
          seasonNumber: season.season_number,
          ...(season.release_year === null ? {} : { year: season.release_year }),
          published: season.published,
          episodes: episodesResult.status === 'fulfilled' ? episodesResult.value : [],
          ...(episodesResult.status === 'rejected'
            ? { episodesError: 'Episodes for this season could not be loaded.' }
            : {}),
        };
      });
    }

    private async getEpisodesForSeason(
      seasonId: string,
      seriesId: string,
      seasonNumber?: number,
    ): Promise<EpisodeItem[]> {
      const { data, error } = await this.client
        .from('episodes')
        .select('id,season_id,episode_number,title,duration_seconds,storage_provider,storage_key,file_extension,mime_type,file_size_bytes,allow_download,published')
        .eq('season_id', seasonId)
        .order('episode_number', { ascending: true });
      if (error) {
        logSupabaseError('[SupabaseMovieRepository] Could not load episodes for this season.', error, {
          table: 'episodes',
          columns:
            'id,season_id,episode_number,title,duration_seconds,storage_provider,storage_key,file_extension,mime_type,file_size_bytes,allow_download,published',
        });
        throw new Error('Could not load episodes for this season.', { cause: error });
      }
      return ((data ?? []) as {
        id: string;
        season_id: string;
        episode_number: number;
        title: string;
        duration_seconds: number;
        storage_provider: 'supabase' | 'b2';
        storage_key: string | null;
        file_extension: string | null;
        mime_type: string | null;
        file_size_bytes: number | null;
        allow_download: boolean;
        published: boolean;
      }[]).flatMap((episode) => {
        if (!episode.storage_key?.trim()) {
          return [];
        }
        return [
          {
            id: `geniuz:episode:${episode.id}`,
            source: 'geniuz',
            title: episode.title,
            type: 'series',
            genres: [],
            mediaPath: episode.storage_key,
            storageKey: episode.storage_key,
            storageProvider: episode.storage_provider,
            ...(episode.file_extension ? { fileExtension: episode.file_extension } : {}),
            ...(episode.mime_type ? { mimeType: episode.mime_type } : {}),
            ...(episode.file_size_bytes === null ? {} : { fileSizeBytes: Number(episode.file_size_bytes) }),
            durationSeconds: episode.duration_seconds,
            runtimeMinutes: Math.max(1, Math.round(episode.duration_seconds / 60)),
            seasonId: episode.season_id,
            ...(seasonNumber === undefined ? {} : { seasonNumber }),
            episodeNumber: episode.episode_number,
            parentSeriesId: seriesId,
            availability: {
              discoverable: episode.published,
              stream: episode.published,
              download: episode.published && episode.allow_download,
              premium: false,
            },
            published: episode.published,
          },
        ];
      });
    }

    async getEpisodeById(id: string) {
      const episodeId = id.replace(/^geniuz:episode:/, '');
      if (episodeId === id) {
        return null;
      }
      const { data, error } = await this.client
        .from('episodes')
        .select('id,season_id,episode_number,title,duration_seconds,storage_provider,storage_key,file_extension,mime_type,file_size_bytes,allow_download,published,seasons!inner(series_id)')
        .eq('id', episodeId)
        .maybeSingle();
      if (error) {
        throw new Error('Could not load this episode.', { cause: error });
      }
      if (!data || typeof data.storage_key !== 'string') {
        return null;
      }
      const season = Array.isArray(data.seasons) ? data.seasons[0] : data.seasons;
      const seriesId =
        typeof season === 'object' && season !== null && 'series_id' in season
          ? String(season.series_id)
          : '';
      const seasons = await this.getEpisodesForSeason(
        String(data.season_id),
        seriesId,
      );
      return seasons.find((episode) => episode.id === `geniuz:episode:${episodeId}`) ?? null;
    }

    async getEpisodePlaybackUrl(episode: Pick<ContentItem, 'id' | 'mediaPath' | 'storageProvider'>) {
      if (!episode.mediaPath?.trim()) {
        throw new PlaybackError('This episode is missing its video file.', 'PLAYBACK_FILE_MISSING', 404);
      }
      if (episode.storageProvider !== 'b2') {
        return this.getSignedPlaybackUrl(episode.mediaPath);
      }
      return this.getApiPlaybackUrl('episodes', episode.id.replace(/^geniuz:episode:/, ''));
    }

  async getSignedPlaybackUrl(path: string) {
    if (!path.trim()) {
      throw new PlaybackError('This movie is missing its video file.', 'PLAYBACK_FILE_MISSING', 404);
    }
    const { data, error } = await this.client.storage
      .from(MOVIE_BUCKET)
      .createSignedUrl(path, 60 * 60);

    if (error) {
      const details = error as { status?: number; statusCode?: string; code?: string; error?: string };
      const status = details.status ?? (Number(details.statusCode) || undefined);
      const isMissing = status === 404 || details.code === 'not_found' || details.error === 'not_found';
      throw new PlaybackError(
        isMissing
          ? 'The video file is missing from storage.'
          : 'Could not prepare the video from storage. Check the file and retry.',
        isMissing ? 'PLAYBACK_FILE_NOT_FOUND' : details.code ?? 'SUPABASE_SIGNED_URL_FAILED',
        status,
        { cause: error },
      );
    }
    const signedUrl = typeof data?.signedUrl === 'string' ? data.signedUrl.trim() : '';
    if (!isHttpUrl(signedUrl)) {
      throw new PlaybackError('Storage returned an invalid playback URL.', 'INVALID_PLAYBACK_URL', 502);
    }
    return signedUrl;
  }

  async getPlaybackUrl(movie: Pick<ContentItem, 'id' | 'mediaPath' | 'storageProvider'>) {
    if (!movie.mediaPath?.trim()) {
      throw new PlaybackError('This movie is missing its video file.', 'PLAYBACK_FILE_MISSING', 404);
    }
    if (movie.storageProvider !== 'b2') {
      return this.getSignedPlaybackUrl(movie.mediaPath);
    }
    return this.getApiPlaybackUrl('movies', movie.id.replace(/^geniuz:(?:movie|series|short):/, ''));
  }

  async getTrailerPlaybackUrl(item: Pick<ContentItem, 'id' | 'trailerStorageKey'>) {
    if (!item.trailerStorageKey?.trim()) {
      throw new PlaybackError('This title does not have an available trailer.', 'TRAILER_NOT_FOUND', 404);
    }
    const resource = item.id.startsWith('geniuz:series:') ? 'series' : 'movies';
    return this.getApiPlaybackUrl(resource, item.id.replace(/^geniuz:(?:movie|series|short):/, ''), 'trailer');
  }

  private async getApiPlaybackUrl(
    resource: 'movies' | 'episodes' | 'series',
    id: string,
    kind: 'video' | 'trailer' = 'video',
  ) {
    const apiBaseUrl = process.env.EXPO_PUBLIC_GENIUZ_API_URL?.trim();
    if (!apiBaseUrl) {
      throw new PlaybackError(
        'The video service is not configured. Restart Expo after setting its API URL.',
        'API_URL_NOT_CONFIGURED',
      );
    }
    const { data, error: sessionError } = await this.client.auth.getSession();
    const accessToken = data.session?.access_token;
    if (sessionError) {
      throw new PlaybackError('Could not verify your session before preparing playback.', 'SESSION_UNAVAILABLE', undefined, {
        cause: sessionError,
      });
    }

    const requestOptions: RequestInit = accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : {};
    let response: Response;
    try {
      response = await fetch(
        `${apiBaseUrl.replace(/\/+$/, '')}/${resource}/${encodeURIComponent(id)}/${kind === 'trailer' ? 'trailer-play-url' : 'play-url'}`,
        requestOptions,
      );
    } catch (fetchError) {
      throw new PlaybackError(
        'Could not reach the video service. Check your connection and retry.',
        'BACKEND_UNREACHABLE',
        undefined,
        { cause: fetchError },
      );
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch (parseError) {
      throw new PlaybackError('The video service returned an invalid response.', 'INVALID_PLAYBACK_RESPONSE', response.status, {
        cause: parseError,
      });
    }
    if (!response.ok) {
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
      const code =
        typeof result === 'object' &&
        result !== null &&
        'error' in result &&
        typeof result.error === 'object' &&
        result.error !== null &&
        'code' in result.error &&
        typeof result.error.code === 'string'
          ? result.error.code
          : 'PLAYBACK_ERROR';
      throw new PlaybackError(message, code, response.status);
    }
    if (typeof result !== 'object' || result === null || !('url' in result) || !isHttpUrl(result.url)) {
      throw new PlaybackError('The video service returned an invalid playback URL.', 'INVALID_PLAYBACK_URL', response.status);
    }
    return result.url;
  }

  async setPublished(movieId: string, published: boolean) {
    const { error } = await this.client
      .from('movies')
      .update({ published })
      .eq('id', movieId.replace(/^geniuz:(?:movie|series|short):/, ''));

    if (error) {
      throw new Error('Could not update movie publishing status.', { cause: error });
    }
  }
}

const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const configuredKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const supabaseMovieRepository =
  supabase && configuredUrl && configuredKey
    ? new SupabaseMovieRepository(supabase, configuredUrl, configuredKey)
    : null;
