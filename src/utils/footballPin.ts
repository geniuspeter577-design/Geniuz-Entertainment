import type { FootballMatch } from '../models/football';

export type FootballPinCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type GoalBallCounts = { home: number; away: number };

export function getGoalBallCounts(previous: FootballMatch | undefined, current: FootballMatch): GoalBallCounts {
  if (!previous) {
    return { home: 0, away: 0 };
  }
  return {
    home: previous.homeScore !== null && current.homeScore !== null && current.homeScore > previous.homeScore
      ? current.homeScore - previous.homeScore
      : 0,
    away: previous.awayScore !== null && current.awayScore !== null && current.awayScore > previous.awayScore
      ? current.awayScore - previous.awayScore
      : 0,
  };
}

export function isLiveMatch(match: FootballMatch) {
  return match.status === 'live';
}

export function normalizeFootballPinCorner(value: unknown): FootballPinCorner | null {
  return value === 'top-left' || value === 'top-right' || value === 'bottom-left' || value === 'bottom-right'
    ? value
    : null;
}

export type PinPoint = { x: number; y: number };
export type PinBounds = { width: number; height: number };
export type PinSize = { width: number; height: number };
export type PinInsets = { top: number; right: number; bottom: number; left: number };

export function getFootballPinPosition(
  corner: FootballPinCorner,
  viewport: PinBounds,
  size: PinSize,
  insets: PinInsets,
  margin = 12,
): PinPoint {
  switch (corner) {
    case 'top-left':
      return { x: insets.left + margin, y: insets.top + margin };
    case 'top-right':
      return { x: viewport.width - size.width - insets.right - margin, y: insets.top + margin };
    case 'bottom-left':
      return { x: insets.left + margin, y: viewport.height - size.height - insets.bottom - margin };
    case 'bottom-right':
      return {
        x: viewport.width - size.width - insets.right - margin,
        y: viewport.height - size.height - insets.bottom - margin,
      };
  }
}

export function snapFootballPinCorner(
  point: PinPoint,
  viewport: PinBounds,
  size: PinSize,
  insets: PinInsets,
  margin = 12,
) {
  const corners: FootballPinCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  return corners
    .map((corner) => {
      const position = getFootballPinPosition(corner, viewport, size, insets, margin);
      return {
        corner,
        ...position,
        distance: (position.x - point.x) ** 2 + (position.y - point.y) ** 2,
      };
    })
    .sort((left, right) => left.distance - right.distance)[0];
}
