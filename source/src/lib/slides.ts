import { assetLinks, driveFileId, driveFolderLinkId, isImageAsset, isVideoAsset, youtubeId } from "./assets";
import type { DriveItem } from "../external/drive";

/** One thing to show in a post's media area. */
export type Slide =
  | { kind: "image"; src: string; fallback?: string; label: string }
  /** A video file the browser plays itself. */
  | { kind: "video"; src: string; label: string }
  /** A page that plays the video (Drive, YouTube, Vimeo). `cover` is shown until the user presses play. */
  | { kind: "embed"; src: string; cover?: string; label: string; autoplay?: string };

const driveThumb = (id: string, width: number) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}`;
const drivePreview = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;

function vimeoId(link: string): string {
  return link.match(/vimeo\.com\/(?:video\/)?(\d{6,})/)?.[1] ?? "";
}

export function slideFromLink(link: string, format: string, width = 800): Slide | null {
  const url = link.trim();
  if (!/^https?:\/\//i.test(url) || driveFolderLinkId(url)) return null;
  const fileId = driveFileId(url);
  if (fileId) {
    return format === "Video"
      ? { kind: "embed", src: url.replace("/view", "/preview"), cover: driveThumb(fileId, width), label: "Drive video" }
      : { kind: "image", src: driveThumb(fileId, width), fallback: url.replace("/view", "/preview"), label: "Drive asset" };
  }
  const yt = youtubeId(url);
  if (yt) return { kind: "embed", src: `https://www.youtube.com/embed/${yt}?rel=0`, autoplay: "autoplay=1", cover: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`, label: "YouTube video" };
  const vimeo = vimeoId(url);
  if (vimeo) return { kind: "embed", src: `https://player.vimeo.com/video/${vimeo}`, autoplay: "autoplay=1", label: "Vimeo video" };
  if (isVideoAsset(url)) return { kind: "video", src: url, label: "Video" };
  if (isImageAsset(url)) return { kind: "image", src: url, label: "Image" };
  return null;
}

interface SavedItem { type?: string; src?: string; fallback?: string; original?: string; label?: string }

/**
 * Everything a post can show, in the order the old app trusted it:
 * pictures saved in the post, else the contents of its Drive folder, else each pasted link.
 */
export function buildSlides(opts: { asset: string; items?: SavedItem[]; folderItems?: DriveItem[]; format: string; width?: number }): Slide[] {
  const width = opts.width ?? 800;
  const saved = (opts.items ?? []).filter((item) => item && (item.src || item.original) && item.type !== "folder");
  if (saved.length) {
    return saved.map((item): Slide => {
      const src = item.src || item.original || "";
      if (item.type === "video") return { kind: "video", src, label: item.label || "Video" };
      if (item.type === "iframe") return { kind: "embed", src, label: item.label || "Video" };
      return { kind: "image", src, fallback: item.fallback || item.original || undefined, label: item.label || "Image" };
    });
  }
  if (opts.folderItems?.length) {
    return opts.folderItems.map((item): Slide =>
      item.type === "video"
        ? { kind: "embed", src: drivePreview(item.id), cover: driveThumb(item.id, width), label: item.label }
        : { kind: "image", src: driveThumb(item.id, width), fallback: item.fallback, label: item.label }
    );
  }
  return assetLinks(opts.asset).map((link) => slideFromLink(link, opts.format, width)).filter((slide): slide is Slide => Boolean(slide));
}
