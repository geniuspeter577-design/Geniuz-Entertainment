export function resetHomeToTrending(
  selectedCategory: string,
  setSelectedCategory: (category: string) => void,
  scrollToTop: () => void,
) {
  if (selectedCategory !== 'Trending') {
    setSelectedCategory('Trending');
  }
  scrollToTop();
}
