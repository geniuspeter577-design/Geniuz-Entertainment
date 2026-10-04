import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { backOrReplace } from '../../src/utils/navigation';
import { Paths } from 'expo-file-system';

import { ContentNotice } from '../../src/components/ContentNotice';
import { OfflineState } from '../../src/components/OfflineState';
import { TitleImage } from '../../src/components/TitleImage';
import {
  ActionChips,
  DetailSkeleton,
  DetailTabs,
  FloatingDownloadCTA,
  MetaRow,
  PosterGrid,
  PremiumBanner,
  QuickBuzzTeaser,
  TitleRow,
  VersionsCard,
} from '../../src/components/detail/DetailComponents';
import { DownloadSheet } from '../../src/components/detail/DownloadSheet';
import { TitleTrailerHero } from '../../src/components/detail/TitleTrailerHero';
import { EpisodeChips, SeasonSheet, SeriesDownloadSheet } from '../../src/components/detail/SeriesComponents';
import { useContentQuery } from '../../src/hooks/useContentQuery';
import type { ContentItem, SeasonItem } from '../../src/models/content';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { contentService } from '../../src/services/createContentService';
import { formatBytes } from '../../src/services/OfflineDownloadService';
import { useDownloads } from '../../src/state/DownloadsContext';
import { useLibrary } from '../../src/state/LibraryContext';
import { useNetwork } from '../../src/state/NetworkContext';
import { theme } from '../../src/theme';
import { formatRuntime } from '../../src/utils/contentPresentation';
import { getDownloadUnavailableReason } from '../../src/utils/downloadAvailability';
import { getFileExtension, isVideoFormatLikelySupported } from '../../src/utils/videoFile';

export default function ContentDetailsScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const library = useLibrary();
  const downloads = useDownloads();
  const { isOnline, retryConnection } = useNetwork();
  const localDownload = downloads.records.find(
    (record) => record.item.id === id && record.status === 'downloaded',
  );
  const fallbackItem =
    library.watchlist.find((item) => item.id === id) ??
    library.continueWatching.find((entry) => entry.item.id === id)?.item;
  const loadContent = useCallback(
    () => {
      if (!isOnline) {
        return Promise.resolve({
          data: localDownload?.item ?? null,
          source: 'local' as const,
        });
      }
      return /^(?:geniuz:movie:|geniuz:series:|geniuz:short:)/.test(id) && supabaseMovieRepository
        ? supabaseMovieRepository.getById(id).then((data) => ({ data, source: 'supabase' as const }))
        : contentService.getById(id, fallbackItem);
    },
    [fallbackItem, id, isOnline, localDownload?.item],
  );
  const content = useContentQuery<ContentItem | null>(
    `content:${id}`,
    loadContent,
    isOnline || Boolean(localDownload),
  );
  const media = isOnline ? content.data : localDownload?.item ?? null;
  const [showDownloadSheet, setShowDownloadSheet] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [activeTab, setActiveTab] = useState<'similar' | 'comments'>('similar');
  const [similar, setSimilar] = useState<{
    itemId: string;
    items: ContentItem[];
    error?: string;
  }>();
  const [similarAttempt, setSimilarAttempt] = useState(0);
  const [seasonState, setSeasonState] = useState<{
    seriesId: string;
    seasons: SeasonItem[];
    error?: string;
  }>();
  const [seasonAttempt, setSeasonAttempt] = useState(0);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>();
  const [showSeasonSheet, setShowSeasonSheet] = useState(false);
  const [showSeriesDownloadSheet, setShowSeriesDownloadSheet] = useState(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    let active = true;
    if (!isOnline || !media || !supabaseMovieRepository) {
      return;
    }
    void supabaseMovieRepository
      .getPublished()
      .then((items) => {
        if (!active) {
          return;
        }
        setSimilar({
          itemId: media.id,
          items: items.filter(
            (candidate) =>
              candidate.id !== media.id &&
              candidate.genres.some((genre) =>
                media.genres.some((currentGenre) => currentGenre.toLocaleLowerCase() === genre.toLocaleLowerCase()),
              ),
          ),
        });
      })
      .catch((error: unknown) => {
        console.error('[ContentDetails] Could not load related titles.', error);
        if (active) {
          setSimilar({
            itemId: media.id,
            items: [],
            error: 'Related titles could not be loaded. Retry to try again.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [isOnline, media, similarAttempt]);

  useEffect(() => {
    let active = true;
    if (!isOnline || !media || media.type !== 'series' || !supabaseMovieRepository) {
      return;
    }
    void supabaseMovieRepository
      .getSeasons(media.id)
      .then((seasons) => {
        if (active) {
          setSeasonState({ seriesId: media.id, seasons });
        }
      })
      .catch((error: unknown) => {
        console.error('[ContentDetails] Could not load series seasons.', error);
        if (active) {
          setSeasonState({
            seriesId: media.id,
            seasons: [],
            error: 'Seasons could not be loaded. Retry to try again.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [isOnline, media, seasonAttempt]);

  const saved = media ? library.isInWatchlist(media.id) : false;
  const downloadRecord = downloads.records.find((record) => record.item.id === media?.id);
  const isDownloading = downloadRecord?.status === 'downloading';
  const isQueued = downloadRecord?.status === 'queued';
  const isDownloaded = downloadRecord?.status === 'downloaded';
  const downloadPlatform =
    Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
      ? Platform.OS
      : 'other';
  const downloadUnavailableReason = media
    ? getDownloadUnavailableReason({
        allowed: media.availability.download,
        platform: downloadPlatform,
        supported: isVideoFormatLikelySupported(
          media.fileExtension ?? getFileExtension(media.mediaPath ?? ''),
          downloadPlatform,
        ),
        availableBytes: Paths.availableDiskSpace,
        fileSize: media.fileSizeBytes,
      })
    : undefined;
  const downloadLabel = isDownloaded
    ? 'Downloaded'
    : isDownloading
      ? `${downloadRecord.progress}%`
      : isQueued
        ? 'Queued'
      : downloadRecord?.status === 'failed'
        ? 'Retry download'
        : 'Download';
  if (content.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView>
          <DetailSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (content.error && isOnline) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ContentNotice message={content.error} tone="error" actionLabel="Retry" onAction={content.retry} />
        <Pressable style={styles.homeButton} onPress={() => router.replace('/')}>
          <Text style={styles.homeButtonText}>Back to Geniuz+</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!media) {
    if (!isOnline) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <OfflineState
            onRetry={() => void retryConnection()}
            message="This title is not saved on this device. Only downloaded titles can open offline."
          />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.safeArea}>
        <ContentNotice message="This title could not be found in the available catalog." />
        <Pressable style={styles.homeButton} onPress={() => router.replace('/')}>
          <Text style={styles.homeButtonText}>Back to Geniuz+</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const sizeLabel = media.fileSizeBytes ? formatBytes(media.fileSizeBytes) : 'size unavailable';
  const seasons = seasonState?.seriesId === media.id ? seasonState.seasons : [];
  const selectedSeason =
    seasons.find((season) => season.id === selectedSeasonId) ?? seasons[0];
  const isSeries = media.type === 'series';
  const seriesHasDownloads = seasons.some((season) =>
    season.episodes.some((episode) => episode.availability.download),
  );
  const playTitle = () => router.push({ pathname: '/watch/[id]', params: { id: media.id } });
  const playHeroTitle = () => {
    const firstEpisode = selectedSeason?.episodes[0];
    if (isSeries && firstEpisode) {
      router.push({ pathname: '/watch/[id]', params: { id: firstEpisode.id } });
      return;
    }
    playTitle();
  };
  const playTrailer = () =>
    router.push({ pathname: '/watch/[id]', params: { id: media.id, trailer: '1' } });
  const handleShare = async () => {
    try {
      await Share.share({
        title: media.title,
        message: `${media.title}\nhttps://example.invalid/title/${encodeURIComponent(media.id)}`,
        url: `https://example.invalid/title/${encodeURIComponent(media.id)}`,
      });
    } catch (error) {
      console.error('[ContentDetails] Could not share this title.', error);
      Alert.alert('Share unavailable', 'This title could not be shared right now.');
    }
  };
  const handleDownload = () => {
    if (isDownloading || isQueued) {
      void downloads.cancel(media.id).catch((error: unknown) =>
        Alert.alert('Download error', error instanceof Error ? error.message : 'Could not cancel this download.'),
      );
      return;
    }
    if (isDownloaded) {
      playTitle();
      return;
    }
    if (downloadUnavailableReason) {
      return;
    }
    void downloads.download(media).catch(() => undefined);
  };

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => backOrReplace('/')} style={styles.homeButton}>
            <Text style={styles.homeButtonText}>‹  Back</Text>
          </Pressable>
          <TitleImage uri={media.posterUrl} style={styles.offlinePoster} />
          <Text style={styles.offlineTitle}>{media.title}</Text>
          <Text style={styles.offlineDescription}>
            {media.description || 'No description is available for this title.'}
          </Text>
          {localDownload ? (
            <Pressable onPress={playTitle} style={styles.homeButton}>
              <Text style={styles.homeButtonText}>Play downloaded title</Text>
            </Pressable>
          ) : null}
          <OfflineState onRetry={() => void retryConnection()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(event) => setIsScrolled(event.nativeEvent.contentOffset.y > 480)}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={content.isRefreshing}
            onRefresh={() => {
              content.retry();
              setSimilarAttempt((attempt) => attempt + 1);
              if (media.type === 'series') {
                setSeasonAttempt((attempt) => attempt + 1);
              }
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <TitleTrailerHero
          item={media}
          saved={saved}
          onPlay={playHeroTitle}
          onManualTrailer={playTrailer}
          onToggleList={() => void library.toggleWatchlist(media)}
          onShare={() => void handleShare()}
          canPlay={
            isSeries
              ? Boolean(selectedSeason?.episodes[0])
              : media.availability.stream && Boolean(media.mediaPath)
          }
        />

        <View style={styles.contentWrap}>
          {content.warning ? (
            <ContentNotice
              message={content.warning}
              tone="warning"
              actionLabel="Retry"
              onAction={content.retry}
            />
          ) : null}
          {library.error ? <ContentNotice message={library.error} tone="error" /> : null}
          {downloads.error ? <ContentNotice message={downloads.error} tone="error" /> : null}
          <PremiumBanner />
          <TitleRow title={media.title} onInfo={() => setShowInfo(true)} />
          <MetaRow item={media} extra={isSeries ? `${seasons.length} seasons` : undefined} />

          <View style={styles.primaryActions}>
            {isSeries && selectedSeason?.episodes[0] ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => router.push({ pathname: '/watch/[id]', params: { id: selectedSeason.episodes[0].id } })}
              >
                <Ionicons name="play" size={18} color={theme.background} />
                <Text style={styles.primaryButtonText}>Play first episode</Text>
              </Pressable>
            ) : media.availability.stream && media.mediaPath ? (
              <Pressable style={styles.primaryButton} onPress={playTitle}>
                <Ionicons name="play" size={18} color={theme.background} />
                <Text style={styles.primaryButtonText}>Play</Text>
              </Pressable>
            ) : (
              <View style={[styles.primaryButton, styles.disabledButton]}>
                <Text style={styles.primaryButtonText}>Playback unavailable</Text>
              </View>
            )}
          </View>
          <ActionChips
            saved={saved}
            downloadLabel={isSeries ? 'Download season' : downloadLabel}
            onToggleList={() => void library.toggleWatchlist(media)}
            onShare={() => void handleShare()}
            onDownload={() =>
              isSeries ? setShowSeriesDownloadSheet(true) : setShowDownloadSheet(true)
            }
            onMyDownloads={() => router.push('/(tabs)/downloads')}
          />
          {!isSeries && !media.availability.download ? (
            <Text style={styles.helperText}>Downloads are not available for this title.</Text>
          ) : null}

          {media.description ? <Text style={styles.description}>{media.description}</Text> : null}
          {media.genres.length ? (
            <View style={styles.pillRow}>
              {media.genres.map((genre) => (
                <View key={genre} style={styles.genrePill}>
                  <Text style={styles.genreText}>{genre}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {media.type === 'movie' && media.mediaPath ? (
            <VersionsCard
              item={media}
              onDownload={() => setShowDownloadSheet(true)}
            />
          ) : null}

          {isSeries ? (
            <View style={styles.seriesControls}>
              <View style={styles.seriesPill}>
                <Ionicons name="volume-medium-outline" size={17} color={theme.accent} />
                <Text style={styles.seriesPillText}>Original audio</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={!seasons.length}
                onPress={() => setShowSeasonSheet(true)}
                style={[styles.seriesPill, !seasons.length && styles.disabledPill]}
              >
                <Text style={styles.seriesPillText}>
                  {selectedSeason ? `Season ${selectedSeason.seasonNumber}` : 'No seasons'}
                </Text>
                <Ionicons name="chevron-down" size={17} color={theme.text} />
              </Pressable>
            </View>
          ) : null}
          {isSeries && seasonState?.seriesId === media.id && seasonState.error ? (
            <ContentNotice
              message={seasonState.error}
              tone="error"
              actionLabel="Retry"
              onAction={() => setSeasonAttempt((attempt) => attempt + 1)}
            />
          ) : null}
          {isSeries && selectedSeason ? (
            <>
              <EpisodeChips
                episodes={selectedSeason.episodes}
                records={downloads.records}
                selectedId={selectedEpisodeId}
                onPlay={(episode) => {
                  setSelectedEpisodeId(episode.id);
                  router.push({ pathname: '/watch/[id]', params: { id: episode.id } });
                }}
                onDownload={(episode) => {
                  const record = downloads.records.find(
                    (candidate) => candidate.item.id === episode.id,
                  );
                  if (record?.status === 'queued' || record?.status === 'downloading') {
                    void downloads.cancel(episode.id).catch((error: unknown) =>
                      Alert.alert(
                        'Download error',
                        error instanceof Error ? error.message : 'The episode download could not be canceled.',
                      ),
                    );
                  } else if (record?.status === 'downloaded') {
                    router.push({ pathname: '/watch/[id]', params: { id: episode.id } });
                  } else {
                    void downloads.download(episode).catch((error: unknown) =>
                      Alert.alert(
                        'Download error',
                        error instanceof Error ? error.message : 'The episode could not be downloaded.',
                      ),
                    );
                  }
                }}
              />
              {selectedSeason.episodes.length === 0 ? (
                <Text style={styles.emptyText}>No published episodes are available in this season.</Text>
              ) : null}
            </>
          ) : null}

          <DetailTabs selected={activeTab} onChange={setActiveTab} />
          {activeTab === 'similar' ? (
            <>
              {similar?.itemId === media.id && similar.error ? (
                <ContentNotice
                  message={similar.error}
                  tone="error"
                  actionLabel="Retry"
                  onAction={() => setSimilarAttempt((attempt) => attempt + 1)}
                />
              ) : similar?.itemId === media.id && similar.items.length ? (
                <PosterGrid items={similar.items} currentId={media.id} />
              ) : similar?.itemId !== media.id ? (
                <Text style={styles.emptyText}>Loading related titles…</Text>
              ) : (
                <Text style={styles.emptyText}>No related published titles are available yet.</Text>
              )}
            </>
          ) : (
            <Text style={styles.emptyText}>No comments yet.</Text>
          )}

          <QuickBuzzTeaser />
        </View>
      </ScrollView>
      <FloatingDownloadCTA
        visible={
          isScrolled &&
          (isSeries ? seriesHasDownloads : media.availability.download && !isDownloaded)
        }
        label={isSeries ? `Download Season ${selectedSeason?.seasonNumber ?? 1}` : 'Download'}
        sizeLabel={isSeries ? undefined : isDownloading ? `${downloadRecord.progress}%` : sizeLabel}
        onPress={() =>
          isSeries ? setShowSeriesDownloadSheet(true) : setShowDownloadSheet(true)
        }
      />
      <DownloadSheet
        visible={showDownloadSheet && !isSeries}
        item={media}
        record={downloadRecord}
        error={downloads.error}
        unavailableReason={downloadUnavailableReason}
        onClose={() => setShowDownloadSheet(false)}
        onDownload={() => handleDownload()}
        onCancel={() => void downloads.cancel(media.id).catch(() => undefined)}
        onPlayOffline={playTitle}
      />
      {isSeries && selectedSeason ? (
        <>
          <SeasonSheet
            visible={showSeasonSheet}
            seasons={seasons}
            selectedSeasonId={selectedSeason.id}
            onClose={() => setShowSeasonSheet(false)}
            onSelect={(season) => {
              setSelectedSeasonId(season.id);
              setShowSeasonSheet(false);
              setSelectedEpisodeId(undefined);
            }}
          />
          <SeriesDownloadSheet
            key={selectedSeason.id}
            visible={showSeriesDownloadSheet}
            season={selectedSeason}
            records={downloads.records}
            onClose={() => setShowSeriesDownloadSheet(false)}
            onCancel={(episodeId) =>
              void downloads.cancel(episodeId).catch((error: unknown) =>
                Alert.alert(
                  'Download error',
                  error instanceof Error ? error.message : 'The episode download could not be canceled.',
                ),
              )
            }
            onQueue={(episodes) => {
              void downloads.downloadSequentially(episodes).catch((error: unknown) =>
                Alert.alert(
                  'Download error',
                  error instanceof Error ? error.message : 'The episode queue could not be started.',
                ),
              );
            }}
          />
        </>
      ) : null}
      <Modal
        visible={showInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfo(false)}
      >
        <View style={styles.infoBackdrop}>
          <Pressable style={styles.infoDismissArea} onPress={() => setShowInfo(false)} />
          <View style={styles.infoPanel}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>Title information</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close information"
                onPress={() => setShowInfo(false)}
                style={styles.infoClose}
              >
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
            <Text style={styles.infoBody}>{media.description || 'No description is available for this title yet.'}</Text>
            <InfoLine label="Year" value={media.year ? String(media.year) : undefined} />
            <InfoLine label="Genres" value={media.genres.length ? media.genres.join(', ') : undefined} />
            <InfoLine label="Runtime" value={media.runtimeMinutes ? formatRuntime(media) : undefined} />
            <InfoLine label="Content rating" value={media.contentRating} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InfoLine({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.background },
  scrollContent: { paddingBottom: 96 },
  offlinePoster: { width: 180, height: 270, borderRadius: 14, alignSelf: 'center', marginTop: 20 },
  offlineTitle: { color: theme.text, fontSize: 26, fontWeight: '800', marginHorizontal: 20, marginTop: 18 },
  offlineDescription: { color: theme.muted, fontSize: 15, lineHeight: 23, marginHorizontal: 20, marginTop: 10 },
  contentWrap: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  primaryActions: { flexDirection: 'row', marginTop: 16 },
  primaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 22,
  },
  disabledButton: { backgroundColor: theme.surfaceSoft },
  primaryButtonText: { color: theme.background, fontSize: 15, fontWeight: '800' },
  helperText: { color: theme.secondaryText, fontSize: 14, marginTop: -8, marginBottom: 12 },
  description: { color: theme.muted, fontSize: 15, lineHeight: 23, marginTop: 6, marginBottom: 16 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  genrePill: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  genreText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  emptyText: { color: theme.secondaryText, fontSize: 14, lineHeight: 20, paddingVertical: 18 },
  seriesControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  seriesPill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 14,
  },
  disabledPill: { opacity: 0.6 },
  seriesPillText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  homeButton: {
    alignSelf: 'center',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 18,
    marginTop: 8,
  },
  homeButtonText: { color: theme.background, fontSize: 14, fontWeight: '800' },
  infoBackdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: theme.scrim },
  infoDismissArea: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  infoPanel: { backgroundColor: theme.surface, borderRadius: 16, padding: 18 },
  infoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  infoTitle: { color: theme.text, fontSize: 19, fontWeight: '800' },
  infoClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  infoBody: { color: theme.muted, fontSize: 14, lineHeight: 21, marginBottom: 16 },
  infoLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7 },
  infoLabel: { color: theme.secondaryText, fontSize: 14 },
  infoValue: { color: theme.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
