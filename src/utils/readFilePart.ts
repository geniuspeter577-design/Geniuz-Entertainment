import { File as ExpoFile, FileMode } from 'expo-file-system';

export async function readFilePart(
  file: globalThis.File | ExpoFile,
  start: number,
  end: number,
  contentType: string,
) {
  if (file instanceof ExpoFile) {
    const handle = file.open(FileMode.ReadOnly);
    try {
      handle.offset = start;
      const bytes = handle.readBytes(end - start);
      if (bytes.byteLength !== end - start) {
        throw new Error('The selected file could not be read completely.');
      }
      return new Blob([bytes], { type: contentType });
    } finally {
      handle.close();
    }
  }
  return file.slice(start, end, contentType);
}
