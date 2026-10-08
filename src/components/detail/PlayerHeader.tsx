import { Ionicons } from '@expo/vector-icons';
import * as Brightness from 'expo-brightness';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import { theme } from '../../theme';
import {
  PLAYER_SPEED_OPTIONS,
  accumulateSkipSeconds,
  clampPlayerValue,
  formatPlaybackTime,
  getPlayerFitLabel,
  getPlayerSpeedLabel,
  getPlayerTapZone,
  getSeekBarTarget,
  getSwipeValue,
  type PlayerFitMode,
} from '../../utils/playerControls';

type PlayerHeaderProps = {
  player: ReturnType<typeof useVideoPlayer>;
  playbackUrl?: string;
  title: string;
  isLoading: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  bufferedPosition: number;
  error?: string;
  showControls: boolean;
  isLandscape: boolean;
  isLocked: boolean;
  playbackSpeed: number;
  speedMenuOpen: boolean;
  fitMode: PlayerFitMode;
  isRotateLocked: boolean;
  subtitleText?: string;
  subtitlesEnabled: boolean;
  onBack: () => void;
  onToggleControls: () => void;
  onToggleLock: () => void;
  onToggleSpeedMenu: () => void;
  onSelectSpeed: (speed: number) => void;
  onCycleFit: () => void;
  onToggleRotate: () => void;
  onOpenSubtitles: () => void;
  onPlayPause: () => void;
  onSeekBy: (seconds: number) => void;
  onSeekTo: (seconds: number) => void;
  onSeekingChange: (isSeeking: boolean) => void;
  onRetry: () => void;
};

export function PlayerHeader({
  player,
  playbackUrl,
  title,
  isLoading,
  isBuffering,
  isPlaying,
  currentTime,
  duration,
  bufferedPosition,
  error,
  showControls,
  isLandscape,
  isLocked,
  playbackSpeed,
  speedMenuOpen,
  fitMode,
  isRotateLocked,
  subtitleText,
  subtitlesEnabled,
  onBack,
  onToggleControls,
  onToggleLock,
  onToggleSpeedMenu,
  onSelectSpeed,
  onCycleFit,
  onToggleRotate,
  onOpenSubtitles,
  onPlayPause,
  onSeekBy,
  onSeekTo,
  onSeekingChange,
  onRetry,
}: PlayerHeaderProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const seekBarWidth = useRef(0);
  const [gestureSize, setGestureSize] = useState({ width: 1, height: 1 });
  const gestureSizeRef = useRef(gestureSize);
  const isLockedRef = useRef(isLocked);
  const brightnessValueRef = useRef(1);
  const volumeValueRef = useRef(1);
  const lastTapTimestamp = useRef(0);
  const lastTapZone = useRef<'left' | 'right' | 'center'>('center');
  const singleTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipDeltaRef = useRef(0);
  const holdPreviousSpeedRef = useRef<number | null>(null);
  const hold2xTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brightnessStartRef = useRef(1);
  const volumeStartRef = useRef(1);
  const swipeZoneRef = useRef<'left' | 'right' | 'center'>('center');
  const brightnessOriginalRef = useRef<number | null>(null);
  const [lockTapVisible, setLockTapVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [gestureHud, setGestureHud] = useState<{ kind: 'brightness' | 'volume' | 'hold' | 'skip'; side?: 'left' | 'right'; value?: number; label?: string } | null>(null);
  const [brightnessValue, setBrightnessValue] = useState(1);
  const [volumeValue, setVolumeValue] = useState(() => clampPlayerValue(player.volume ?? 1));
  const [activePlaybackRate, setActivePlaybackRate] = useState(playbackSpeed);
  const progress = duration > 0 ? clampPlayerValue(currentTime / duration) : 0;
  const bufferedProgress = duration > 0 ? clampPlayerValue(bufferedPosition / duration) : 0;

  useEffect(() => {
    gestureSizeRef.current = gestureSize;
  }, [gestureSize]);

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  useEffect(() => {
    brightnessValueRef.current = brightnessValue;
  }, [brightnessValue]);

  useEffect(() => {
    volumeValueRef.current = volumeValue;
  }, [volumeValue]);

  useEffect(() => {
    let active = true;
    void Brightness.getBrightnessAsync().then((brightness) => {
      if (active) {
        brightnessOriginalRef.current = brightness;
        setBrightnessValue(brightness);
      }
    }).catch(() => {
      if (active) {
        brightnessOriginalRef.current = 1;
      }
    });
    return () => {
      active = false;
      if (brightnessOriginalRef.current !== null) {
        void Brightness.setBrightnessAsync(brightnessOriginalRef.current).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivePlaybackRate(playbackSpeed);
  }, [playbackSpeed]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.playbackRate = activePlaybackRate;
  }, [activePlaybackRate, player]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.volume = volumeValue;
  }, [player, volumeValue]);

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }
    const timeout = setTimeout(() => setToastMessage(null), 800);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    return () => {
      if (singleTapTimeoutRef.current) {
        clearTimeout(singleTapTimeoutRef.current);
      }
      if (hold2xTimerRef.current) {
        clearTimeout(hold2xTimerRef.current);
      }
      if (skipDeltaRef.current !== 0) {
        skipDeltaRef.current = 0;
      }
    };
  }, []);

  const showGestureHud = (kind: 'brightness' | 'volume' | 'hold' | 'skip', value?: number, side?: 'left' | 'right', label?: string) => {
    setGestureHud({ kind, value, side, label });
    if (kind === 'hold' && hold2xTimerRef.current) {
      clearTimeout(hold2xTimerRef.current);
    }
    if (kind === 'skip' || kind === 'brightness' || kind === 'volume') {
      hold2xTimerRef.current = setTimeout(() => setGestureHud(null), 1000);
    }
  };

  const triggerSkip = (zone: 'left' | 'right') => {
    const direction = zone === 'right' ? 1 : -1;
    const nextDelta = direction * 10;
    skipDeltaRef.current = accumulateSkipSeconds(skipDeltaRef.current, nextDelta);
    const displaySeconds = Math.abs(skipDeltaRef.current);
    setGestureHud({ kind: 'skip', side: zone, label: `${displaySeconds} seconds` });
    onSeekBy(skipDeltaRef.current);
    if (hold2xTimerRef.current) {
      clearTimeout(hold2xTimerRef.current);
    }
    hold2xTimerRef.current = setTimeout(() => {
      skipDeltaRef.current = 0;
      setGestureHud(null);
    }, 650);
  };

  const seekFromEvent = (event: GestureResponderEvent) => {
    onSeekTo(getSeekBarTarget(event.nativeEvent.locationX, seekBarWidth.current, duration));
  };
  const handleSeekBarLayout = (event: LayoutChangeEvent) => {
    seekBarWidth.current = event.nativeEvent.layout.width;
  };

  const panResponderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  const [panHandlers, setPanHandlers] = useState<ReturnType<typeof PanResponder.create>['panHandlers'] | null>(null);

  useEffect(() => {
    if (panResponderRef.current) {
      return undefined;
    }

    const panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => !isLockedRef.current,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 8 || Math.abs(gestureState.dx) > 8,
      onPanResponderGrant: (_, gestureState) => {
        if (isLockedRef.current) {
          return;
        }
        const zone = getPlayerTapZone(gestureState.x0, gestureSizeRef.current.width);
        swipeZoneRef.current = zone;
        if (zone === 'left') {
          brightnessStartRef.current = brightnessValueRef.current;
          setGestureHud({ kind: 'brightness', value: brightnessValueRef.current, side: 'left' });
        } else if (zone === 'right') {
          volumeStartRef.current = volumeValueRef.current;
          setGestureHud({ kind: 'volume', value: volumeValueRef.current, side: 'right' });
        }
      },
      onPanResponderMove: (_, gestureState) => {
        if (isLockedRef.current) {
          return;
        }
        const zone = swipeZoneRef.current;
        const nextValue = getSwipeValue(
          zone === 'left' ? brightnessStartRef.current : volumeStartRef.current,
          gestureState.dy,
          gestureSizeRef.current.height,
        );
        if (zone === 'left') {
          const clamped = clampPlayerValue(nextValue);
          setBrightnessValue(clamped);
          brightnessValueRef.current = clamped;
          void Brightness.setBrightnessAsync(clamped).catch(() => undefined);
          setGestureHud({ kind: 'brightness', value: clamped, side: 'left' });
        } else if (zone === 'right') {
          const clamped = clampPlayerValue(nextValue);
          setVolumeValue(clamped);
          volumeValueRef.current = clamped;
          setGestureHud({ kind: 'volume', value: clamped, side: 'right' });
        }
      },
      onPanResponderRelease: () => {
        swipeZoneRef.current = 'center';
        setGestureHud(null);
      },
      onPanResponderTerminate: () => {
        swipeZoneRef.current = 'center';
        setGestureHud(null);
      },
    });

    panResponderRef.current = panResponder;
    setPanHandlers(panResponder.panHandlers);

    return () => {
      panResponderRef.current = null;
      setPanHandlers(null);
    };
  }, []);

  const handleSurfacePress = (event: GestureResponderEvent) => {
    if (isLockedRef.current) {
      return;
    }
    const zone = getPlayerTapZone(event.nativeEvent.locationX ?? gestureSizeRef.current.width / 2, gestureSizeRef.current.width);
    const now = Date.now();
    const tapDelta = now - lastTapTimestamp.current;
    lastTapTimestamp.current = now;
    lastTapZone.current = zone;

    if (zone !== 'center' && tapDelta < 280 && lastTapZone.current === zone) {
      if (singleTapTimeoutRef.current) {
        clearTimeout(singleTapTimeoutRef.current);
      }
      triggerSkip(zone);
      return;
    }

    if (singleTapTimeoutRef.current) {
      clearTimeout(singleTapTimeoutRef.current);
    }
    singleTapTimeoutRef.current = setTimeout(() => {
      onToggleControls();
    }, 220);
  };

  const handleHoldStart = () => {
    if (isLockedRef.current) {
      return;
    }
    holdPreviousSpeedRef.current = playbackSpeed;
    setActivePlaybackRate(2);
    onSelectSpeed(2);
    showGestureHud('hold', 2, undefined, '2x');
  };

  const handleHoldEnd = () => {
    if (isLockedRef.current) {
      return;
    }
    const previousSpeed = holdPreviousSpeedRef.current ?? playbackSpeed;
    setActivePlaybackRate(previousSpeed);
    onSelectSpeed(previousSpeed);
    setGestureHud(null);
  };

  const playerContainerStyle: ViewStyle = isLandscape
    ? {
        ...styles.container,
        ...styles.landscapeContainer,
        backgroundColor: '#000000',
        width: windowWidth,
        height: windowHeight,
      }
    : {
        ...styles.container,
        backgroundColor: '#000000',
        width: '100%',
        height: windowWidth * (9 / 16),
        aspectRatio: undefined,
      };

  if (isLocked) {
    return (
      <View style={playerContainerStyle}>
        {playbackUrl ? (
          <VideoView
            player={player}
            style={styles.video}
            nativeControls={false}
            fullscreenOptions={{ enable: false }}
            contentFit={fitMode}
            allowsPictureInPicture={false}
          />
        ) : null}
        {subtitleText ? (
          <View pointerEvents="none" style={[styles.subtitleOverlay, isLandscape && styles.subtitleOverlayLandscape]}>
            <Text style={styles.subtitleText}>{subtitleText}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tap to reveal lock control"
          onPress={() => setLockTapVisible(true)}
          style={StyleSheet.absoluteFill}
        />
        {lockTapVisible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Unlock playback controls"
            onPress={onToggleLock}
            style={styles.lockRevealButton}
          >
            <Ionicons name="lock-open-outline" size={32} color={theme.text} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={playerContainerStyle}>
      {playbackUrl ? (
        <VideoView
          player={player}
          style={styles.video}
          nativeControls={false}
          fullscreenOptions={{ enable: false }}
          contentFit={fitMode}
          allowsPictureInPicture={false}
        />
      ) : null}
      {subtitleText ? (
        <View pointerEvents="none" style={[styles.subtitleOverlay, isLandscape && styles.subtitleOverlayLandscape]}>
          <Text style={styles.subtitleText}>{subtitleText}</Text>
        </View>
      ) : null}
      <View
        style={StyleSheet.absoluteFill}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setGestureSize({ width, height });
          gestureSizeRef.current = { width, height };
        }}
        {...panHandlers}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showControls ? 'Hide playback controls' : 'Show playback controls'}
          delayLongPress={220}
          onPress={handleSurfacePress}
          onLongPress={handleHoldStart}
          onPressOut={handleHoldEnd}
          style={StyleSheet.absoluteFill}
        />
      </View>
      {gestureHud ? (
        <View pointerEvents="none" style={[styles.gestureHud, gestureHud.side === 'left' ? styles.gestureHudLeft : gestureHud.side === 'right' ? styles.gestureHudRight : styles.gestureHudCenter]}> 
          {gestureHud.kind === 'brightness' ? (
            <>
              <Ionicons name="sunny-outline" size={22} color={theme.text} />
              <View style={styles.gestureBarTrack}>
                <View style={[styles.gestureBarFill, { width: `${Math.max(0, Math.min(100, (gestureHud.value ?? 0) * 100))}%` }]} />
              </View>
            </>
          ) : null}
          {gestureHud.kind === 'volume' ? (
            <>
              <Ionicons name="volume-medium-outline" size={22} color={theme.text} />
              <View style={styles.gestureBarTrack}>
                <View style={[styles.gestureBarFill, { width: `${Math.max(0, Math.min(100, Math.min(1, (gestureHud.value ?? 0)) * 100))}%` }]} />
              </View>
            </>
          ) : null}
          {gestureHud.kind === 'hold' ? <Text style={styles.holdBadge}>2x</Text> : null}
          {gestureHud.kind === 'skip' ? (
            <View style={styles.skipRipple}>
              <Ionicons name={gestureHud.side === 'left' ? 'arrow-back-outline' : 'arrow-forward-outline'} size={18} color={theme.text} />
              <Text style={styles.skipRippleText}>{gestureHud.label ?? '10 seconds'}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {toastMessage ? (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}
      {isBuffering ? (
        <View pointerEvents="none" style={styles.bufferingBadge}>
          <ActivityIndicator color={theme.accent} size="small" />
          <Text style={styles.bufferingText}>{isLoading ? 'Loading' : 'Buffering'}</Text>
        </View>
      ) : null}
      {showControls ? (
        <View style={styles.controls} pointerEvents="box-none">
          <LinearGradient colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0)']} style={styles.topGradient} pointerEvents="none" />
          <View style={[styles.topBar, !isLandscape && styles.portraitTopBar]} pointerEvents="box-none">
            <View style={styles.topLeftGroup} pointerEvents="box-none">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={onBack}
                style={styles.iconButton}
                hitSlop={8}
              >
                <Ionicons name="arrow-back" size={22} color={theme.text} />
              </Pressable>
              {isLandscape ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
            </View>
            <View style={styles.rightControls} pointerEvents="box-none">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open TV"
                onPress={() => setToastMessage('Coming soon')}
                style={isLandscape ? styles.iconLabelButton : styles.iconButton}
              >
                {isLandscape ? (
                  <>
                    <Ionicons name="tv-outline" size={22} color={theme.text} />
                    <Text style={styles.iconLabel}>TV</Text>
                  </>
                ) : (
                  <Ionicons name="tv-outline" size={22} color={theme.text} />
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open help"
                onPress={() => setToastMessage('Coming soon')}
                style={isLandscape ? styles.iconLabelButton : styles.iconButton}
              >
                {isLandscape ? (
                  <>
                    <Ionicons name="help-circle-outline" size={22} color={theme.text} />
                    <Text style={styles.iconLabel}>Help</Text>
                  </>
                ) : (
                  <Ionicons name="help-circle-outline" size={22} color={theme.text} />
                )}
              </Pressable>
              {isLandscape ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open settings"
                  onPress={() => setToastMessage('Coming soon')}
                  style={styles.iconLabelButton}
                >
                  <Ionicons name="settings-outline" size={22} color={theme.text} />
                  <Text style={styles.iconLabel}>Setting</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {isLandscape ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Lock playback controls"
              onPress={() => {
                setLockTapVisible(false);
                onToggleLock();
              }}
              style={styles.lockStartButton}
              hitSlop={8}
            >
              <Ionicons name="lock-closed-outline" size={22} color={theme.text} />
              <Text style={styles.iconLabel}>Tap to Lock</Text>
            </Pressable>
          ) : null}
          {error ? (
            <View style={styles.errorPanel}>
              <Ionicons name="alert-circle-outline" size={30} color={theme.text} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {isLandscape ? (
                <View style={styles.centerControls} pointerEvents="box-none">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back 10 seconds"
                    onPress={() => onSeekBy(-10)}
                    style={styles.skipButton}
                    hitSlop={8}
                  >
                    <Ionicons name="reload-outline" size={22} color={theme.text} style={styles.skipIconBack} />
                    <Text style={styles.skipText}>10</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                    onPress={onPlayPause}
                    style={styles.playButton}
                    hitSlop={8}
                  >
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={38} color={theme.background} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Forward 10 seconds"
                    onPress={() => onSeekBy(10)}
                    style={styles.skipButton}
                    hitSlop={8}
                  >
                    <Ionicons name="reload-outline" size={22} color={theme.text} style={styles.skipIconForward} />
                    <Text style={styles.skipText}>10</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={isLandscape ? styles.bottomStack : styles.portraitBottomStack} pointerEvents="box-none">
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0.78)']} style={styles.bottomGradient} pointerEvents="none" />
                {isLandscape ? (
                  <>
                    <View style={styles.seekControls}>
                      <Text style={styles.timeText}>{formatPlaybackTime(currentTime)}</Text>
                      <View
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityLabel="Playback position"
                        accessibilityValue={{
                          min: 0,
                          max: duration > 0 ? duration : 0,
                          now: Math.min(currentTime, duration),
                          text: `${formatPlaybackTime(currentTime)} of ${duration > 0 ? formatPlaybackTime(duration) : 'unknown duration'}`,
                        }}
                        accessibilityActions={[{ name: 'increment', label: 'Forward 10 seconds' }, { name: 'decrement', label: 'Back 10 seconds' }]}
                        onAccessibilityAction={(event) => {
                          onSeekBy(event.nativeEvent.actionName === 'increment' ? 10 : -10);
                        }}
                        onLayout={handleSeekBarLayout}
                        onStartShouldSetResponder={() => duration > 0}
                        onMoveShouldSetResponder={() => duration > 0}
                        onResponderGrant={(event) => {
                          onSeekingChange(true);
                          seekFromEvent(event);
                        }}
                        onResponderMove={seekFromEvent}
                        onResponderRelease={(event) => {
                          seekFromEvent(event);
                          onSeekingChange(false);
                        }}
                        onResponderTerminate={() => onSeekingChange(false)}
                        style={styles.seekBarTouchTarget}
                      >
                        <View pointerEvents="none" style={styles.seekTrack}>
                          <View style={[styles.seekBuffered, { width: `${bufferedProgress * 100}%` }]} />
                          <View style={[styles.seekProgress, { width: `${progress * 100}%` }]} />
                          <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
                        </View>
                      </View>
                      <Text style={styles.timeText}>{duration > 0 ? formatPlaybackTime(duration) : '--:--'}</Text>
                    </View>
                    <View style={styles.bottomRow} pointerEvents="box-none">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                        onPress={onPlayPause}
                        style={styles.miniPlayButton}
                        hitSlop={8}
                      >
                        <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color={theme.background} />
                      </Pressable>
                      <View style={styles.footerActions} pointerEvents="box-none">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Language and subtitles${subtitlesEnabled ? ', subtitles on' : ''}`}
                          onPress={onOpenSubtitles}
                          style={styles.footerActionButton}
                        >
                          <Ionicons name="language-outline" size={16} color={theme.text} />
                          <Text style={styles.footerLabel}>Subtitles</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel="Change video fit" onPress={onCycleFit} style={styles.footerActionButton}>
                          <Ionicons name="contract-outline" size={16} color={theme.text} />
                          <Text style={styles.footerLabel}>{getPlayerFitLabel(fitMode)}</Text>
                        </Pressable>
                        <View style={styles.speedWrap}>
                          <Pressable accessibilityRole="button" accessibilityLabel="Playback speed" onPress={onToggleSpeedMenu} style={styles.footerActionButton}>
                            <Ionicons name="speedometer-outline" size={16} color={theme.text} />
                            <Text style={styles.footerLabel}>{getPlayerSpeedLabel(playbackSpeed)}</Text>
                          </Pressable>
                          {speedMenuOpen ? (
                            <View style={styles.speedMenu}>
                              {PLAYER_SPEED_OPTIONS.map((speed) => (
                                <Pressable
                                  key={String(speed)}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Playback speed ${getPlayerSpeedLabel(speed)}`}
                                  onPress={() => {
                                    player.playbackRate = speed;
                                    onSelectSpeed(speed);
                                    onToggleSpeedMenu();
                                  }}
                                  style={[styles.speedMenuItem, playbackSpeed === speed && styles.speedMenuItemSelected]}
                                >
                                  <Text style={[styles.speedMenuText, playbackSpeed === speed && styles.speedMenuTextSelected]}>
                                    {getPlayerSpeedLabel(speed)}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          ) : null}
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel="Exit full screen" onPress={onToggleRotate} style={styles.footerActionButton}>
                          <Ionicons name="contract-outline" size={16} color={theme.text} />
                        </Pressable>
                      </View>
                    </View>
                  </>
                ) : (
                  <View style={styles.portraitFooter} pointerEvents="box-none">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                      onPress={onPlayPause}
                      style={styles.miniPlayButton}
                      hitSlop={8}
                    >
                      <Ionicons name={isPlaying ? 'pause' : 'play'} size={16} color={theme.background} />
                    </Pressable>
                    <View style={styles.portraitSeekWrap}>
                      <View
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityLabel="Playback position"
                        accessibilityValue={{
                          min: 0,
                          max: duration > 0 ? duration : 0,
                          now: Math.min(currentTime, duration),
                          text: `${formatPlaybackTime(currentTime)} of ${duration > 0 ? formatPlaybackTime(duration) : 'unknown duration'}`,
                        }}
                        accessibilityActions={[{ name: 'increment', label: 'Forward 10 seconds' }, { name: 'decrement', label: 'Back 10 seconds' }]}
                        onAccessibilityAction={(event) => {
                          onSeekBy(event.nativeEvent.actionName === 'increment' ? 10 : -10);
                        }}
                        onLayout={handleSeekBarLayout}
                        onStartShouldSetResponder={() => duration > 0}
                        onMoveShouldSetResponder={() => duration > 0}
                        onResponderGrant={(event) => {
                          onSeekingChange(true);
                          seekFromEvent(event);
                        }}
                        onResponderMove={seekFromEvent}
                        onResponderRelease={(event) => {
                          seekFromEvent(event);
                          onSeekingChange(false);
                        }}
                        onResponderTerminate={() => onSeekingChange(false)}
                        style={styles.seekBarTouchTarget}
                      >
                        <View pointerEvents="none" style={styles.seekTrack}>
                          <View style={[styles.seekBuffered, { width: `${bufferedProgress * 100}%` }]} />
                          <View style={[styles.seekProgress, { width: `${progress * 100}%` }]} />
                          <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
                        </View>
                      </View>
                      <Text style={styles.portraitTimeText}>{`${formatPlaybackTime(currentTime)}/${duration > 0 ? formatPlaybackTime(duration) : '--:--'}`}</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Mini player coming soon" onPress={() => setToastMessage('Coming soon')} style={styles.portraitMiniButton}>
                      <Ionicons name="play-circle-outline" size={16} color={theme.text} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Enter full screen" onPress={onToggleRotate} style={styles.fullscreenButton}>
                      <Ionicons name="contract-outline" size={18} color={theme.text} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Language and subtitles${subtitlesEnabled ? ', subtitles on' : ''}`}
                      onPress={onOpenSubtitles}
                      style={styles.fullscreenButton}
                    >
                      <Ionicons name="language-outline" size={18} color={theme.text} />
                    </Pressable>
                  </View>
                )}
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: theme.background,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  landscapeContainer: {
    flex: 1,
    aspectRatio: undefined,
  },
  video: {
    ...StyleSheet.absoluteFill,
  },
  subtitleOverlay: {
    alignItems: 'center',
    bottom: 58,
    left: 12,
    position: 'absolute',
    right: 12,
    zIndex: 2,
  },
  subtitleOverlayLandscape: {
    bottom: 84,
  },
  subtitleText: {
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: 5,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
    textAlign: 'center',
    textShadowColor: '#000000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  controls: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  topGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 180,
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
  },
  topLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  title: {
    flex: 1,
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  portraitTopBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  portraitActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(20, 23, 27, 0.32)',
  },
  iconLabelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 48,
  },
  iconLabel: {
    color: theme.text,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  lockStartButton: {
    position: 'absolute',
    left: 16,
    top: '50%',
    marginTop: -28,
    minHeight: 56,
    minWidth: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
  },
  lockRevealButton: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 36,
    backgroundColor: 'rgba(15, 18, 22, 0.75)',
    transform: [{ translateX: -36 }, { translateY: -36 }],
  },
  centerControls: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    transform: [{ translateY: -38 }],
  },
  skipButton: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    backgroundColor: 'rgba(18, 20, 24, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  skipIconBack: {
    transform: [{ rotate: '180deg' }],
  },
  skipIconForward: {
    transform: [{ rotate: '0deg' }],
  },
  skipText: {
    position: 'absolute',
    color: theme.text,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  playButton: {
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 41,
    backgroundColor: 'rgba(18, 20, 24, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  bottomStack: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 180,
  },
  portraitBottomStack: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  seekControls: {
    position: 'relative',
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
  },
  timeText: {
    minWidth: 42,
    color: theme.text,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  seekBarTouchTarget: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
  },
  seekTrack: {
    height: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
  },
  seekBuffered: {
    position: 'absolute',
    height: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  seekProgress: {
    height: 4,
    borderRadius: 4,
    backgroundColor: theme.accent,
  },
  seekThumb: {
    position: 'absolute',
    top: -5,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: theme.accent,
  },
  bottomRow: {
    position: 'relative',
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  miniPlayButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: theme.accent,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  footerActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(18, 20, 24, 0.35)',
  },
  footerLabel: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '700',
  },
  speedWrap: {
    position: 'relative',
  },
  speedMenu: {
    position: 'absolute',
    right: 0,
    bottom: 36,
    minWidth: 96,
    backgroundColor: 'rgba(15, 18, 22, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(114, 240, 106, 0.35)',
    borderRadius: 12,
    paddingVertical: 6,
  },
  speedMenuItem: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  speedMenuItemSelected: {
    backgroundColor: 'rgba(114, 240, 106, 0.12)',
  },
  speedMenuText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
  },
  speedMenuTextSelected: {
    color: theme.accent,
  },
  portraitFooter: {
    position: 'relative',
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  portraitSeekWrap: {
    flex: 1,
  },
  portraitTimeText: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  portraitMiniButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: 'rgba(18, 20, 24, 0.35)',
  },
  fullscreenButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: 'rgba(18, 20, 24, 0.35)',
  },
  gestureHud: {
    position: 'absolute',
    top: 84,
    alignSelf: 'center',
    minWidth: 132,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 18, 22, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(114, 240, 106, 0.3)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  gestureHudLeft: {
    left: 32,
  },
  gestureHudRight: {
    right: 32,
  },
  gestureHudCenter: {
    left: '50%',
    transform: [{ translateX: -66 }],
  },
  gestureBarTrack: {
    width: 84,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  gestureBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: theme.accent,
  },
  skipRipple: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  skipRippleText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
  },
  holdBadge: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  toast: {
    position: 'absolute',
    top: 84,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 18, 22, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(114, 240, 106, 0.35)',
  },
  toastText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
  },
  bufferingBadge: {
    position: 'absolute',
    top: 72,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 18, 22, 0.56)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bufferingText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '600',
  },
  errorPanel: {
    position: 'absolute',
    top: '25%',
    left: 24,
    right: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: {
    maxWidth: 440,
    color: theme.text,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 104,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.accent,
    paddingHorizontal: 20,
  },
  retryText: {
    color: theme.background,
    fontSize: 15,
    fontWeight: '800',
  },
});
