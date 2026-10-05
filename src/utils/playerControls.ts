import type { VideoPlayer } from 'expo-video';

export const PLAYER_CONTROLS_AUTO_HIDE_MS = 3000;

export function clampPlayerValue(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getSeekTarget(currentSeconds: number, durationSeconds: number, deltaSeconds: number): number {
  const current = Number.isFinite(currentSeconds) ? Math.max(0, currentSeconds) : 0;
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : Infinity;
  const delta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
  return Math.max(0, Math.min(duration, current + delta));
}

export function getSeekBarTarget(positionX: number, width: number, durationSeconds: number): number {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }
  const ratio = clampPlayerValue(positionX / width);
  return ratio * durationSeconds;
}

export function formatPlaybackTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const twoDigits = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(remainingSeconds)}`
    : `${minutes}:${twoDigits(remainingSeconds)}`;
}

export function shouldAutoHidePlayerControls(isPlaying: boolean, isSeeking: boolean): boolean {
  return isPlaying && !isSeeking;
}

export function getDragTarget(startValue: number, deltaY: number, height: number): number {
  if (!Number.isFinite(height) || height <= 0) {
    return clampPlayerValue(startValue);
  }
  return clampPlayerValue(startValue - deltaY / height);
}

export function togglePlayerOrientation(isLandscape: boolean): boolean {
  return !isLandscape;
}

export function isPlayerGestureArea(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const inBounds =
    x >= 28 &&
    x <= width - 28 &&
    y >= 44 &&
    y <= height - 96;
  const overCenterControl =
    Math.abs(x - width / 2) < 48 &&
    Math.abs(y - height / 2) < 48;
  return inBounds && !overCenterControl;
}

export function setPlayerVolume(player: VideoPlayer, volume: number): void {
  player.volume = clampPlayerValue(volume);
}

export function setPlayerMuted(player: VideoPlayer, muted: boolean): void {
  player.muted = muted;
}

export function setPlayerLoop(player: VideoPlayer, loop: boolean): void {
  player.loop = loop;
}

export function setPlayerTimeUpdateInterval(player: VideoPlayer, seconds: number): void {
  player.timeUpdateEventInterval = seconds;
}

export function setPlayerCurrentTime(player: VideoPlayer, seconds: number): void {
  player.currentTime = seconds;
}

export function runPlayerActionIfActive(isReleased: boolean, action: () => void): boolean {
  if (isReleased) {
    return false;
  }
  try {
    action();
    return true;
  } catch {
    return false;
  }
}
