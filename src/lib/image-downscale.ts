// Shrink a photo in the browser before it is sent to the vision model:
// phone photos are 3-12 MB, the model reads a 1600 px JPEG just as well and
// the request must stay far below the platform's 4.5 MB body limit.

export const MAX_IMAGE_SIDE = 1600;
export const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;

/** Target size that fits within `maxSide` on both axes, keeping the aspect ratio (never upscales). */
export function fitWithin(width: number, height: number, maxSide = MAX_IMAGE_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function loadImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to <img> (older Safari).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** JPEG data URL of the photo, at most MAX_IMAGE_SIDE px on its longest side. */
export async function downscaleImageToDataUrl(file: File, quality = 0.82): Promise<string> {
  if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error("La foto es demasiado grande.");
  const image = await loadImage(file);
  try {
    const size = fitWithin(image.width, image.height);
    if (size.width === 0) throw new Error("La imagen está vacía.");
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("El navegador no puede procesar la imagen.");
    // White under transparent PNGs so the JPEG isn't black where they were clear.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image.source, 0, 0, size.width, size.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    image.close();
  }
}
