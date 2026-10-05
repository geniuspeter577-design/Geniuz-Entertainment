import type { SupabaseClient } from '@supabase/supabase-js';

import type { Config } from '../config/config';
import { HttpError } from '../http/errors';
import type { B2StorageService } from '../storage/B2StorageService';
import { collectReferencedMediaKeys, isManagedMediaKey } from '../storage/unusedMediaCleanup';

type StoredTitle = Record<string, unknown>;
type StoredEpisode = Record<string, unknown>;
type StorageAsset = { bucket: 'movie-assets' | 'title-images'; key: string };

type DeletionAudit = {
  id: string;
};

function stringField(record: StoredTitle | StoredEpisode, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function exactStoragePath(value: string, bucket: StorageAsset['bucket']) {
  const path = value.trim();
  if (
    !path || path.startsWith('/') || path.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    /[\u0000-\u001f\u007f\\]/.test(path)
  ) {
    return undefined;
  }
  return { bucket, key: path } satisfies StorageAsset;
}

function publicStoragePath(value: string, config: Config, bucket: StorageAsset['bucket']) {
  let fileUrl: URL;
  let supabaseUrl: URL;
  try {
    fileUrl = new URL(value);
    supabaseUrl = new URL(config.supabaseUrl ?? '');
  } catch {
    return undefined;
  }
  if (fileUrl.origin !== supabaseUrl.origin) {
    return undefined;
  }
  const marker = `/storage/v1/object/public/${bucket}/`;
  const markerIndex = fileUrl.pathname.indexOf(marker);
  if (markerIndex < 0) {
    return undefined;
  }
  let path: string;
  try {
    path = fileUrl.pathname.slice(markerIndex + marker.length).split('/').map(decodeURIComponent).join('/');
  } catch {
    return undefined;
  }
  return exactStoragePath(path, bucket);
}

function getTitleAssets(movie: StoredTitle, episodes: readonly StoredEpisode[], config: Config) {
  const b2Keys = new Set<string>();
  const supabaseAssets = new Map<string, StorageAsset>();
  const addB2References = (record: StoredTitle | StoredEpisode, fields: readonly string[]) => {
    const references = Object.fromEntries(fields.map((field) => [field, record[field]]));
    for (const key of collectReferencedMediaKeys(references)) {
      b2Keys.add(key);
    }
  };
  addB2References(movie, [
    'storage_key',
    'trailer_storage_key',
    'poster_url',
    'cover_url',
    'subtitles',
    'subtitle_tracks',
    'subtitle_key',
    'subtitle_url',
  ]);

  const addSupabaseAsset = (asset: StorageAsset | undefined) => {
    if (asset) {
      supabaseAssets.set(`${asset.bucket}/${asset.key}`, asset);
    }
  };
  if (movie.storage_provider === 'supabase') {
    const videoPath = stringField(movie, 'video_path');
    if (videoPath) {
      addSupabaseAsset(exactStoragePath(videoPath, 'movie-assets'));
    }
  }
  addSupabaseAsset(publicStoragePath(stringField(movie, 'poster_url') ?? '', config, 'title-images'));
  addSupabaseAsset(publicStoragePath(stringField(movie, 'cover_url') ?? '', config, 'title-images'));

  for (const episode of episodes) {
    addB2References(episode, ['storage_key', 'subtitle_tracks', 'subtitles', 'subtitle_key', 'subtitle_url']);
    if (episode.storage_provider === 'supabase') {
      addSupabaseAsset(exactStoragePath(stringField(episode, 'storage_key') ?? '', 'movie-assets'));
    }
  }

  return {
    b2Keys: [...b2Keys].filter(isManagedMediaKey).sort(),
    supabaseAssets: [...supabaseAssets.values()].sort((first, second) => `${first.bucket}/${first.key}`.localeCompare(`${second.bucket}/${second.key}`)),
  };
}

async function updateAudit(client: SupabaseClient, auditId: string, values: Record<string, unknown>) {
  const { error } = await client.from('admin_media_deletion_audit').update(values).eq('id', auditId);
  if (error) {
    console.error('[AdminTitleDeletion] Could not update persistent deletion audit.', {
      auditId,
      errorCode: typeof error.code === 'string' ? error.code : undefined,
    });
  }
}

export async function deleteAdminTitle(
  client: SupabaseClient,
  storage: Pick<B2StorageService, 'deleteObject'>,
  config: Config,
  titleId: string,
  userId: string,
  now = new Date(),
) {
  const { data: audit, error: auditError } = await client
    .from('admin_media_deletion_audit')
    .insert({
      actor_user_id: userId,
      title_id: titleId,
      result: 'started',
      files_removed: [],
      files_failed: [],
    })
    .select('id')
    .single();
  if (auditError || !audit) {
    throw new HttpError(503, 'DELETION_AUDIT_UNAVAILABLE', 'The deletion audit could not be written; no title files or records were changed. Apply the pending audit migration and retry.');
  }
  const auditId = (audit as DeletionAudit).id;

  const { data: movie, error: movieError } = await client
    .from('movies')
    .select('*')
    .eq('id', titleId)
    .maybeSingle();
  if (movieError || !movie) {
    await updateAudit(client, auditId, { result: 'title_lookup_failed', completed_at: now.toISOString() });
    throw new HttpError(movieError ? 502 : 404, movieError ? 'TITLE_LOOKUP_FAILED' : 'TITLE_NOT_FOUND', 'The title could not be loaded; no files or records were changed.');
  }

  const movieRecord = movie as StoredTitle;
  const movieTitle = stringField(movieRecord, 'title') ?? titleId;
  const protectedDraftNames = new Set(['Run', 'NIGERIA']);
  if (!movieRecord.published && protectedDraftNames.has(movieTitle.trim())) {
    await updateAudit(client, auditId, {
      title_name: movieTitle,
      result: 'files_failed',
      completed_at: now.toISOString(),
    });
    throw new HttpError(409, 'TITLE_PROTECTED', `The draft title "${movieTitle}" is protected from automated deletion.`);
  }
  const contentType = movieRecord.content_type;
  let seasons: StoredTitle[] = [];
  let episodes: StoredEpisode[] = [];
  if (contentType === 'series') {
    const { data, error } = await client
      .from('seasons')
      .select('*')
      .eq('series_id', titleId)
      .order('season_number', { ascending: true });
    if (error) {
      await updateAudit(client, auditId, { title_name: movieTitle, result: 'asset_lookup_failed', completed_at: now.toISOString() });
      throw new HttpError(502, 'TITLE_ASSET_LOOKUP_FAILED', 'The series seasons could not be loaded; no files or records were changed.');
    }
    seasons = (data ?? []) as StoredTitle[];
    const seasonIds = seasons.flatMap((season) => {
      const id = stringField(season, 'id');
      return id ? [id] : [];
    });
    if (seasonIds.length) {
      const { data: episodeData, error: episodeError } = await client
        .from('episodes')
        .select('*')
        .in('season_id', seasonIds);
      if (episodeError) {
        await updateAudit(client, auditId, { title_name: movieTitle, result: 'asset_lookup_failed', completed_at: now.toISOString() });
        throw new HttpError(502, 'TITLE_ASSET_LOOKUP_FAILED', 'The series episodes could not be loaded; no files or records were changed.');
      }
      episodes = (episodeData ?? []) as StoredEpisode[];
    }
  }

  const assets = getTitleAssets(movieRecord, episodes, config);
  const removed: string[] = [];
  const failures: string[] = [];
  for (const key of assets.b2Keys) {
    try {
      await storage.deleteObject(key);
      removed.push(key);
    } catch {
      failures.push(key);
    }
  }
  for (const asset of assets.supabaseAssets) {
    const label = `${asset.bucket}/${asset.key}`;
    try {
      const { error } = await client.storage.from(asset.bucket).remove([asset.key]);
      if (error) {
        throw error;
      }
      removed.push(label);
    } catch {
      failures.push(label);
    }
  }

  if (failures.length) {
    await updateAudit(client, auditId, {
      title_name: movieTitle,
      files_removed: removed,
      files_failed: failures,
      result: 'files_failed',
      completed_at: now.toISOString(),
    });
    const message = `The title was kept because these files could not be deleted: ${failures.join(', ')}`;
    console.error('[AdminTitleDeletion] Title deletion stopped because file removal failed.', {
      actorUserId: userId,
      titleId,
      filesRemoved: removed,
      filesFailed: failures,
      result: 'files_failed',
    });
    throw new HttpError(409, 'TITLE_FILE_DELETE_FAILED', message);
  }

  const episodeIds = episodes.flatMap((episode) => {
    const id = stringField(episode, 'id');
    return id ? [id] : [];
  });
  if (episodeIds.length) {
    const { error } = await client.from('episodes').delete().in('id', episodeIds);
    if (error) {
      await updateAudit(client, auditId, { title_name: movieTitle, files_removed: removed, result: 'record_delete_failed', completed_at: now.toISOString() });
      throw new HttpError(502, 'TITLE_RECORD_DELETE_FAILED', 'All title files were removed, but episode rows could not be deleted. The title record was kept.');
    }
  }
  const seasonIds = seasons.flatMap((season) => {
    const id = stringField(season, 'id');
    return id ? [id] : [];
  });
  if (seasonIds.length) {
    const { error } = await client.from('seasons').delete().in('id', seasonIds);
    if (error) {
      await updateAudit(client, auditId, { title_name: movieTitle, files_removed: removed, result: 'record_delete_failed', completed_at: now.toISOString() });
      throw new HttpError(502, 'TITLE_RECORD_DELETE_FAILED', 'All title files were removed, but season rows could not be deleted. The title record was kept.');
    }
  }
  const { data: deletedTitle, error: deleteError } = await client
    .from('movies')
    .delete()
    .eq('id', titleId)
    .select('id')
    .maybeSingle();
  if (deleteError || !deletedTitle) {
    await updateAudit(client, auditId, { title_name: movieTitle, files_removed: removed, result: 'record_delete_failed', completed_at: now.toISOString() });
    throw new HttpError(502, 'TITLE_RECORD_DELETE_FAILED', 'All title files were removed, but the title record could not be deleted.');
  }

  await updateAudit(client, auditId, {
    title_name: movieTitle,
    files_removed: removed,
    files_failed: [],
    result: 'success',
    completed_at: now.toISOString(),
  });
  console.info('[AdminTitleDeletion] Title deleted.', {
    actorUserId: userId,
    titleId,
    filesRemoved: removed,
    result: 'success',
  });
  return { deleted: true, titleId, filesRemoved: removed };
}
