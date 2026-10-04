export function getFriendlyCatalogErrorMessage(error: unknown) {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? error.status
      : undefined;
  const candidate =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : error instanceof Error
        ? error.message
        : '';
  const normalized = candidate.toLocaleLowerCase();

  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    normalized.includes('request timed out')
  ) {
    return 'The catalog server is waking up and can take about 50 seconds on its first request. Please wait a moment and retry.';
  }
  if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('timeout')) {
    return 'Could not reach the catalog. Check your connection and retry.';
  }
  return 'Some titles could not be loaded. Please retry.';
}
