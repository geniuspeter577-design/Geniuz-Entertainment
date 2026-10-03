import type { VideoPlayer } from 'expo-video';

export function clampPlayerValue(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getSeekTarget(currentSeconds: number, durationSeconds: number, deltaSeconds: number): number {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : Infinity;
  return Math.max(0, Math.min(duration, currentSeconds + deltaSeconds));
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
