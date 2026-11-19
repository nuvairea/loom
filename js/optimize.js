const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 2400;
const WEBP_QUALITY = 0.85;
const PASSTHROUGH_TYPES = new Set(['image/gif', 'image/svg+xml']);

export class ImageTooLargeError extends Error {
  constructor(fileName) {
    super(`${fileName} exceeds the ${MAX_INPUT_BYTES / 1024 / 1024}MB limit`);
    this.name = 'ImageTooLargeError';
  }
}

function encode(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function optimizeImage(file) {
  if (file.size > MAX_INPUT_BYTES) throw new ImageTooLargeError(file.name);
  if (PASSTHROUGH_TYPES.has(file.type)) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await encode(canvas, 'image/webp', WEBP_QUALITY);
  if (blob?.type !== 'image/webp' && file.type === 'image/jpeg') {
    blob = await encode(canvas, 'image/jpeg', WEBP_QUALITY);
  }

  return blob && blob.size < file.size ? blob : file;
}
