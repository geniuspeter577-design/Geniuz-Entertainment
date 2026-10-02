import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { ContentNotice } from '../../src/components/ContentNotice';
import { supabaseMovieRepository } from '../../src/repositories/SupabaseMovieRepository';
import { theme } from '../../src/theme';

export default function WatchScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const player = useVideoPlayer(null);
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    async function loadPlayback() {
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

        const url = await supabaseMovieRepository.getSignedPlaybackUrl(movie.mediaPath);
        if (active) {
          setPlaybackUrl(url);
        }
      } catch (loadError) {
        console.error('[WatchScreen] Could not prepare movie playback.', loadError);
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
  }, [id]);

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
      .catch((playerError: unknown) => {
        console.error('[WatchScreen] Video player could not load the movie.', playerError);
        if (active) {
          setError('The video could not be played on this device.');
        }
      });

    return () => {
      active = false;
      player.pause();
    };
  }, [player, playbackUrl]);

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
      <Text style={styles.disclaimer}>
        Playback is available for movies uploaded by an authorized Geniuz+ administrator. Downloads
        and DRM are not enabled.
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
  disclaimer: {
    color: theme.secondaryText,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
});
