"use client";

export interface DownscaledImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Below Groq's 4 MB image limit and Vercel's 4.5 MB request body, with room for JSON. */
const MAX_DATA_URL_CHARS = 3_600_000;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // Phone photos carry their rotation in EXIF; honor it.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to <img> below (older Safari).
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

/**
 * A photo or scan as a JPEG data URL no larger than `maxSide` px on its long
 * side, shrinking further if it is still too heavy to upload.
 */
export async function downscaleImage(file: File, maxSide = 1600): Promise<DownscaledImage> {
  const decoded = await decode(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error("empty image");
    for (const [side, quality] of [[maxSide, 0.82], [1280, 0.75], [1024, 0.7]] as const) {
      const scale = Math.min(1, side / Math.max(decoded.width, decoded.height));
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= MAX_DATA_URL_CHARS) return { dataUrl, width, height };
    }
    throw new Error("image too large");
  } finally {
    decoded.close();
  }
}
