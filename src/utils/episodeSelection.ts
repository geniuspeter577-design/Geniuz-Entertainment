import type { EpisodeItem, SeasonItem } from '../models/content';

type OrderableEpisode = Pick<EpisodeItem, 'id' | 'episodeNumber' | 'seasonNumber'>;

export function orderEpisodes<T extends OrderableEpisode>(episodes: readonly T[]) {
  return [...episodes].sort(
    (left, right) =>
      (left.seasonNumber ?? 0) - (right.seasonNumber ?? 0) ||
      left.episodeNumber - right.episodeNumber,
  );
}

export function selectEpisodes(episodes: readonly EpisodeItem[], selectedIds: readonly string[]) {
  const selected = new Set(selectedIds);
  return orderEpisodes(episodes.filter((episode) => selected.has(episode.id)));
}

export function totalEpisodeSize(episodes: readonly EpisodeItem[]) {
  return episodes.reduce((total, episode) => total + (episode.fileSizeBytes ?? 0), 0);
}

export function nextEpisodeInSeason(season: SeasonItem, currentId: string) {
  const episodes = orderEpisodes(season.episodes);
  const index = episodes.findIndex((episode) => episode.id === currentId);
  return index >= 0 ? episodes[index + 1] : undefined;
}

export function nextEpisodeInSeries<T extends OrderableEpisode>(
  episodes: readonly T[],
  currentId: string,
) {
  const ordered = orderEpisodes(episodes);
  const index = ordered.findIndex((episode) => episode.id === currentId);
  return index >= 0 ? ordered[index + 1] : undefined;
}
