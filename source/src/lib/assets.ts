/** Asset links are stored as free text, one link per line (Drive files/folders, images, videos). */

export function assetLinks(value: string | undefined): string[] {
  return String(value || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

export function driveFileId(value: string): string {
  const url = String(value || "").trim();
  if (!url.includes("drive.google.com")) return "";
  return url.match(/\/d\/([^/]+)/)?.[1] || url.match(/[?&]id=([^&]+)/)?.[1] || "";
}

export function isDriveFolder(value: string): boolean {
  const url = String(value || "").trim();
  return url.includes("drive.google.com") && (/\/folders\//.test(url) || url.includes("folderview"));
}

export function isImageAsset(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(String(value || "").trim());
}

export function isVideoAsset(value: string): boolean {
  const url = String(value || "").trim();
  return /\.(mp4|mov|m4v|webm|avi|mkv)(\?.*)?$/i.test(url) || /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
}

/** A small preview image URL for the first asset that has one (direct image or a public Drive file). */
export function thumbnailFor(value: string | undefined, width = 320): string {
  for (const link of assetLinks(value)) {
    if (!/^https?:\/\//i.test(link)) continue;
    if (isImageAsset(link)) return link;
    const id = driveFileId(link);
    if (id && !isDriveFolder(link)) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}`;
  }
  return "";
}

export function safeHref(link: string): string {
  return /^https?:\/\//i.test(link) ? link : "";
}
