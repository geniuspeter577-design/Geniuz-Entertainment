export async function downloadInOrder<T>(
  items: readonly T[],
  download: (item: T) => Promise<void>,
) {
  for (const item of items) {
    await download(item);
  }
}
