export const ITEM_PHOTO_BUCKET = "auction-item-photos";
export const MAX_ITEM_PHOTOS = 8;
export const MAX_ITEM_PHOTO_BYTES = 5 * 1024 * 1024;
export const ITEM_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const itemPhotoPathPattern =
  /^items\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i;

export function isItemPhotoPath(value: string): boolean {
  return itemPhotoPathPattern.test(value);
}

export function isItemPhotoPathForId(value: string, itemId: string): boolean {
  return (
    isItemPhotoPath(value) &&
    value.toLowerCase().startsWith(`items/${itemId.toLowerCase()}/`)
  );
}

export function getItemPhotoExtension(
  mimeType: string,
): "jpg" | "png" | "webp" | null {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

export function validateItemPhoto(file: File): string | null {
  if (!ITEM_PHOTO_MIME_TYPES.some((mimeType) => mimeType === file.type)) {
    return "Choose JPEG, PNG, or WebP image files.";
  }
  if (file.size === 0 || file.size > MAX_ITEM_PHOTO_BYTES) {
    return "Each photo must be larger than 0 bytes and no larger than 5 MB.";
  }
  return null;
}

export function catalogItemPhotoUrl(value: string): string {
  if (!isItemPhotoPath(value)) return value;
  return `/api/catalog/images/${value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}
