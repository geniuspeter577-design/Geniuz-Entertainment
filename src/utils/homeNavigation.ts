export function resetHomeToTrending(
  setSelectedCategory: (category: string) => void,
  scrollToTop: () => void,
) {
  setSelectedCategory('Trending');
  scrollToTop();
}
