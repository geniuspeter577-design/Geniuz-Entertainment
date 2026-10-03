export async function loadAdminCatalog<TMovie, TSeason>(
  getMovies: () => Promise<TMovie[]>,
  getSeasons: () => Promise<TSeason[]>,
) {
  const [moviesResult, seasonsResult] = await Promise.allSettled([getMovies(), getSeasons()]);
  return {
    ...(moviesResult.status === 'fulfilled'
      ? { movies: moviesResult.value }
      : { movieError: moviesResult.reason }),
    ...(seasonsResult.status === 'fulfilled'
      ? { seasons: seasonsResult.value }
      : { seriesError: seasonsResult.reason }),
  };
}
