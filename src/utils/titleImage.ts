import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';
export { TITLE_IMAGE_MAX_INPUT_BYTES, validateTitleImage } from './titleImageValidation';

export const TITLE_IMAGE_TARGET_BYTES = 500 * 1024;

export async function compressTitleImage(uri: string, maxWidth: number, maxHeight: number) {
  const image = await ImageManipulator.manipulate(uri).renderAsync();
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  let candidate = image;

  if (scale < 1) {
    candidate = await ImageManipulator.manipulate(uri).resize({ width }).renderAsync();
  }

  let result: ImageResult | undefined;
  for (const compress of [0.82, 0.68, 0.52, 0.38]) {
    result = await candidate.saveAsync({
      format: SaveFormat.JPEG,
      compress,
    });
    const response = await fetch(result.uri);
    const blob = await response.blob();
    if (blob.size <= TITLE_IMAGE_TARGET_BYTES) {
      return { ...result, blob };
    }
  }
  if (!result) {
    throw new Error('The image could not be compressed.');
  }
  const response = await fetch(result.uri);
  return { ...result, blob: await response.blob() };
}
