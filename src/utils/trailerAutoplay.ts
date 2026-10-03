export type TrailerAutoplayInput = {
  isPublished: boolean;
  isOnline: boolean;
  hasTrailer: boolean;
  autoplayEnabled: boolean;
  isFocused: boolean;
  isAppActive: boolean;
};

export function shouldAutoplayTrailer(input: TrailerAutoplayInput): boolean {
  return (
    input.isPublished &&
    input.isOnline &&
    input.hasTrailer &&
    input.autoplayEnabled &&
    input.isFocused &&
    input.isAppActive
  );
}

export function toggleTrailerMuted(isMuted: boolean): boolean {
  return !isMuted;
}
