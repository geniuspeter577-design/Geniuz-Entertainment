export function getKeyboardScrollTarget({
  inputTop,
  inputHeight,
  viewportTop,
  viewportHeight,
  keyboardTop,
  currentScrollOffset,
  bottomPadding = 16,
}: {
  inputTop: number;
  inputHeight: number;
  viewportTop: number;
  viewportHeight: number;
  keyboardTop?: number;
  currentScrollOffset: number;
  bottomPadding?: number;
}) {
  const viewportBottom = viewportTop + viewportHeight;
  const visibleBottom = keyboardTop === undefined
    ? viewportBottom
    : Math.min(viewportBottom, keyboardTop);
  const overflow = inputTop + inputHeight - (visibleBottom - bottomPadding);
  return overflow > 0 ? currentScrollOffset + overflow : currentScrollOffset;
}