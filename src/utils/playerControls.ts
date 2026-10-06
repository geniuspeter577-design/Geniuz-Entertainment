import type { VideoPlayer } from 'expo-video';

export const PLAYER_CONTROLS_AUTO_HIDE_MS = 3000;
export const PLAYER_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const PLAYER_FIT_OPTIONS = ['contain', 'fill', 'cover'] as const;

export type PlayerFitMode = typeof PLAYER_FIT_OPTIONS[number];

export function clampPlayerValue(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getPlayerSpeedOptions(): number[] {
  return [...PLAYER_SPEED_OPTIONS];
}

export function getPlayerSpeedLabel(speed: number): string {
  const normalized = Number.isFinite(speed) ? speed : 1;
  const trimmed = Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${trimmed}x`;
}

export function getNextPlayerSpeed(currentSpeed: number): number {
  const options = getPlayerSpeedOptions();
  const safeSpeed = options.some((option) => option === currentSpeed) ? currentSpeed : 1;
  const index = options.indexOf(safeSpeed);
  return options[(index + 1) % options.length];
}

export function togglePlayerLock(isLocked: boolean): boolean {
  return !isLocked;
}

export function getNextPlayerFit(currentFit: string): PlayerFitMode {
  const safeFit = PLAYER_FIT_OPTIONS.includes(currentFit as PlayerFitMode)
    ? (currentFit as PlayerFitMode)
    : 'contain';
  const index = PLAYER_FIT_OPTIONS.indexOf(safeFit);
  return PLAYER_FIT_OPTIONS[(index + 1) % PLAYER_FIT_OPTIONS.length];
}

export function getPlayerFitLabel(currentFit: string): 'Fit' | 'Fill' | 'Stretch' {
  switch (currentFit) {
    case 'contain':
      return 'Fit';
    case 'fill':
      return 'Fill';
    case 'cover':
      return 'Stretch';
    default:
      return 'Fit';
  }
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

export function getPlayerTapZone(x: number, width: number): 'left' | 'right' | 'center' {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
    return 'center';
  }
  return x < width / 2 ? 'left' : 'right';
}

export function accumulateSkipSeconds(currentTotalSeconds: number, nextDeltaSeconds: number): number {
  const safeCurrent = Number.isFinite(currentTotalSeconds) ? currentTotalSeconds : 0;
  const safeDelta = Number.isFinite(nextDeltaSeconds) ? nextDeltaSeconds : 0;
  return safeCurrent + safeDelta;
}

export function getSwipeValue(startValue: number, deltaY: number, trackHeight: number): number {
  if (!Number.isFinite(startValue) || !Number.isFinite(deltaY) || !Number.isFinite(trackHeight) || trackHeight <= 0) {
    return clampPlayerValue(startValue);
  }
  return clampPlayerValue(startValue - deltaY / trackHeight);
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
