import type { SupabaseClient } from '@supabase/supabase-js';
import { Upload } from 'tus-js-client';

import type { ContentItem } from '../models/content';
import { supabase } from '../services/supabase';

const MOVIE_BUCKET = 'movie-assets';
const MOVIE_COLUMNS =
  'id,title,description,release_year,genres,poster_url,runtime_minutes,content_rating,video_path,published';

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
    ...(movie.video_path ? { mediaPath: movie.video_path } : {}),
    availability: {
      discoverable: movie.published && movie.video_path !== null,
      stream: movie.published && movie.video_path !== null,
      download: false,
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
      .not('video_path', 'is', null)
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
  ) {
    const { data: draft, error: draftError } = await this.client
      .from('movies')
      .insert({
        title: movie.title.trim(),
        description: movie.description.trim() || null,
        release_year: movie.releaseYear ?? null,
        genres: movie.genres,
        poster_url: movie.posterUrl?.trim() || null,
        runtime_minutes: movie.runtimeMinutes ?? null,
        content_rating: movie.contentRating?.trim() || null,
        published: false,
      })
      .select('id')
      .single();

    if (draftError) {
      throw new Error('Could not create the movie record.', { cause: draftError });
    }

    const path = `movies/${draft.id}.mp4`;
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
            contentType: 'video/mp4',
            cacheControl: '3600',
          },
          chunkSize: 6 * 1024 * 1024,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
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

        upload.start();
      });

      uploaded = true;
      const { error: updateError } = await this.client
        .from('movies')
        .update({ video_path: path, published: movie.published })
        .eq('id', draft.id);

      if (updateError) {
        throw new Error('The video uploaded, but its movie record could not be published.', {
          cause: updateError,
        });
      }
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      if (uploaded) {
        const { error } = await this.client.storage.from(MOVIE_BUCKET).remove([path]);
        if (error) {
          cleanupErrors.push(error);
        }
      }

      const { error: deleteError } = await this.client.from('movies').delete().eq('id', draft.id);
      if (deleteError) {
        cleanupErrors.push(deleteError);
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

  async getSignedPlaybackUrl(path: string) {
    const { data, error } = await this.client.storage
      .from(MOVIE_BUCKET)
      .createSignedUrl(path, 60 * 60);

    if (error) {
      throw new Error('Could not prepare this movie for playback.', { cause: error });
    }

    return data.signedUrl;
  }

  async setPublished(movieId: string, published: boolean) {
    const { error } = await this.client
      .from('movies')
      .update({ published })
      .eq('id', movieId.replace(/^geniuz:movie:/, ''))
      .not('video_path', 'is', null);

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
