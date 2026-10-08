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

export type TileIcon = "video" | "folder" | "link" | "none";

export type AssetPreview =
  /** A picture. `play` overlays a play button (it is the cover of a video). */
  | { kind: "image"; src: string; fallback: string; count: number; play?: boolean }
  /** A video file the browser can play: its first frame is the preview. */
  | { kind: "videofile"; src: string }
  /** Nothing to draw yet (or ever): a labelled tile. `folderId` marks a Drive folder whose pictures can be loaded. */
  | { kind: "tile"; icon: TileIcon; label: string; folderId?: string };

export function youtubeId(link: string): string {
  const m = String(link).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

function isDirectVideoFile(link: string): boolean {
  return /^https?:\/\//i.test(link) && /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(link);
}

function hostOf(link: string): string {
  try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function driveFolderLinkId(link: string): string {
  const url = String(link || "").trim();
  if (!url.includes("drive.google.com")) return "";
  return url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/)?.[1]
    || (url.includes("folderview") ? url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/)?.[1] ?? "" : "")
    || "";
}

/**
 * What a post shows as its preview, so there is always something. In order:
 *  1. thumbnails saved inside the post when a Drive folder was opened in the old app (`assetItems`);
 *  2. a direct image link, or a single Drive file;
 *  3. the cover of a YouTube link, or the first frame of a direct video file;
 *  4. a Drive folder (its pictures are loaded by the caller; until then a "Drive folder" tile);
 *  5. any other link as a tile with its site name; no asset at all as a "No asset yet" tile.
 */
export function previewFor(
  asset: string | undefined,
  items: { type?: string; src?: string; fallback?: string; original?: string }[] | undefined,
  width = 320
): AssetPreview {
  const saved = (items ?? []).filter((item) => item && (item.src || item.original));
  const firstImage = saved.find((item) => (item.type || "image") === "image");
  if (firstImage) {
    return { kind: "image", src: firstImage.src || firstImage.original || "", fallback: firstImage.fallback || firstImage.original || "", count: saved.length };
  }
  const links = assetLinks(asset);
  const thumb = thumbnailFor(asset, width);
  if (thumb) return { kind: "image", src: thumb, fallback: "", count: links.length };
  for (const link of links) {
    const yt = youtubeId(link);
    if (yt) return { kind: "image", src: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`, fallback: "", count: links.length, play: true };
  }
  const videoFile = links.find(isDirectVideoFile);
  if (videoFile) return { kind: "videofile", src: videoFile };
  const folder = links.map(driveFolderLinkId).find(Boolean);
  if (folder) return { kind: "tile", icon: "folder", label: "Drive folder", folderId: folder };
  if (saved.some((item) => item.type === "video") || links.some(isVideoAsset)) return { kind: "tile", icon: "video", label: "Video" };
  const web = links.find((link) => /^https?:\/\//i.test(link));
  if (web) return { kind: "tile", icon: "link", label: hostOf(web) || "Link" };
  return { kind: "tile", icon: "none", label: "No asset yet" };
}
