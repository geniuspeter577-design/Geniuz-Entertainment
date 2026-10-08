export const EPISODE_WATCHED_PROGRESS_PERCENT = 95;
export const NEXT_EPISODE_COUNTDOWN_SECONDS = 10;

export function isEpisodeWatchedAtPosition(
  itemId: string,
  positionSeconds: number,
  durationSeconds: number,
) {
  if (
    !itemId.startsWith('geniuz:episode:') ||
    !Number.isFinite(positionSeconds) ||
    positionSeconds < 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return false;
  }
  return (positionSeconds / durationSeconds) * 100 >= EPISODE_WATCHED_PROGRESS_PERCENT;
}

export function markEpisodeWatched(
  watchedEpisodeIds: readonly string[],
  itemId: string,
  positionSeconds: number,
  durationSeconds: number,
) {
  if (!isEpisodeWatchedAtPosition(itemId, positionSeconds, durationSeconds)) {
    return watchedEpisodeIds;
  }
  return watchedEpisodeIds.includes(itemId)
    ? watchedEpisodeIds
    : [...watchedEpisodeIds, itemId];
}
