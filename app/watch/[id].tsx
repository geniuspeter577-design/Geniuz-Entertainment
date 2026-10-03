import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import type { ContentItem } from '../../src/models/content';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { useDownloads } from '../../src/state/DownloadsContext';
import { theme } from '../../src/theme';
import { getFileExtension, isVideoFormatLikelySupported } from '../../src/utils/videoFile';

export default function WatchScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const player = useVideoPlayer(null);
  const downloads = useDownloads();
  const localDownload = downloads.records.find(
    (record) => record.item.id === id && record.status === 'downloaded',
  );
  const [movie, setMovie] = useState<ContentItem>();
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [isOfflinePlayback, setIsOfflinePlayback] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const downloadRecord = downloads.records.find((record) => record.item.id === id);
  const isDownloading = downloadRecord?.status === 'downloading';
  const isDownloaded = downloadRecord?.status === 'downloaded';

  useEffect(() => {
    let active = true;

    async function loadPlayback() {
      if (downloads.isLoading) {
        return;
      }

      setIsLoading(true);
      setError(undefined);
      setPlaybackUrl(undefined);
      setMovie(undefined);

      if (localDownload) {
        const extension =
          localDownload.item.fileExtension ?? getFileExtension(localDownload.item.mediaPath ?? '');
        if (
          !isVideoFormatLikelySupported(
            extension,
            Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
              ? Platform.OS
              : 'other',
          )
        ) {
          setError('This video format may not play on this device.');
          setIsLoading(false);
          return;
        }
        setMovie(localDownload.item);
        setIsOfflinePlayback(true);
        setPlaybackUrl(localDownload.filePath);
        setIsLoading(false);
        return;
      }

      if (!supabaseMovieRepository || !id.startsWith('geniuz:movie:')) {
        setError('This movie is not available for streaming.');
        setIsLoading(false);
        return;
      }

      try {
        const movie = await supabaseMovieRepository.getById(id);
        if (!movie?.availability.stream || !movie.mediaPath) {
          throw new Error('This movie is not published for streaming.');
        }

        const extension = movie.fileExtension ?? getFileExtension(movie.mediaPath);
        if (
          !isVideoFormatLikelySupported(
            extension,
            Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
              ? Platform.OS
              : 'other',
          )
        ) {
          throw new Error('This video format may not play on this device.');
        }

        const url = await supabaseMovieRepository.getPlaybackUrl(movie);
        if (active) {
          setMovie(movie);
          setIsOfflinePlayback(false);
          setPlaybackUrl(url);
        }
      } catch (loadError) {
        console.error('[WatchScreen] Could not prepare movie playback.');
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not prepare this movie for playback. Please try again.',
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadPlayback();
    return () => {
      active = false;
    };
  }, [downloads.isLoading, id, localDownload]);

  useEffect(() => {
    if (!playbackUrl) {
      return;
    }

    let active = true;
    void player
      .replaceAsync(playbackUrl)
      .then(() => {
        if (active) {
          player.play();
        }
      })
      .catch(() => {
        console.error('[WatchScreen] Video player could not load the movie.');
        if (active) {
          setError('This video format may not play on this device.');
        }
      });

    return () => {
      active = false;
      player.pause();
    };
  }, [player, playbackUrl]);

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        console.error('[WatchScreen] Video playback failed.');
        setError('This video format may not play on this device.');
        player.pause();
      }
    });
    return () => subscription.remove();
  }, [player]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>
        <Text style={styles.title}>Now playing</Text>
      </View>
      <View style={styles.playerWrap}>
        {playbackUrl ? (
          <VideoView
            player={player}
            style={styles.player}
            nativeControls
            fullscreenOptions={{ enable: true }}
            contentFit="contain"
            allowsPictureInPicture
          />
        ) : null}
        {isLoading ? <ContentNotice message="Preparing secure playback…" /> : null}
        {error ? <ContentNotice message={error} tone="error" /> : null}
      </View>
      {movie?.availability.download ? (
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(isDownloaded)}
          onPress={() => {
            if (isDownloading) {
              void downloads.cancel(movie.id).catch((downloadError: unknown) =>
                Alert.alert(
                  'Download error',
                  downloadError instanceof Error ? downloadError.message : 'Could not cancel this download.',
                ),
              );
            } else {
              void downloads.download(movie).catch((downloadError: unknown) =>
                Alert.alert(
                  'Download error',
                  downloadError instanceof Error ? downloadError.message : 'The download failed. Please retry.',
                ),
              );
            }
          }}
          style={[styles.downloadButton, isDownloaded && styles.disabledButton]}
        >
          <Text style={styles.downloadButtonText}>
            {isDownloaded
              ? 'Downloaded'
              : isDownloading
                ? `Cancel download (${downloadRecord.progress}%)`
                : 'Download'}
          </Text>
        </Pressable>
      ) : null}
      {downloads.error ? <ContentNotice message={downloads.error} tone="error" /> : null}
      <Text style={styles.disclaimer}>
        {isOfflinePlayback
          ? 'Playing the saved file on this device.'
          : 'Playback is available for movies uploaded by an authorized Geniuz+ administrator.'}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
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
  title: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 10,
  },
  playerWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  player: {
    width: '100%',
    height: '100%',
  },
  downloadButton: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderRadius: 999,
    borderWidth: 1,
    marginHorizontal: 18,
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  downloadButtonText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.55,
  },
  disclaimer: {
    color: theme.secondaryText,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
});
