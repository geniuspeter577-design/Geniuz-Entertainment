export function getFriendlyCatalogErrorMessage(error: unknown) {
  const candidate =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : error instanceof Error
        ? error.message
        : '';
  const normalized = candidate.toLocaleLowerCase();

  if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('timeout')) {
    return 'Could not reach the catalog. Check your connection and retry.';
  }
  return 'Some titles could not be loaded. Please retry.';
}
