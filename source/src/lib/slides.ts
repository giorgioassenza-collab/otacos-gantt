import { assetLinks, driveFileId, driveFolderLinkId, isImageAsset, isVideoAsset, youtubeId } from "./assets";
import { driveMediaUrl, type DriveItem } from "../external/drive";

/** One thing to show in a post's media area. */
export type Slide =
  | { kind: "image"; src: string; fallback?: string; original?: string; label: string; ratio?: number }
  /** A video file the browser plays itself. */
  | { kind: "video"; src: string; label: string }
  /** A video stored on Drive: played in the app from Drive's media address, with Drive's own player as the fallback. */
  | { kind: "drivevideo"; id: string; src: string; page: string; cover?: string; label: string; original?: string; ratio?: number }
  /**
   * A Drive file whose type is not known yet (picture or video?). Drive is asked what it is; `hint` is only the guess
   * from the post's format, used if Drive cannot answer.
   */
  | { kind: "drivefile"; id: string; hint: "image" | "video"; page: string; original?: string; label: string; width: number }
  /** A page that plays the video (YouTube, Vimeo, other). `cover` is shown until the user presses play. */
  | { kind: "embed"; src: string; cover?: string; label: string; autoplay?: string };

const driveThumb = (id: string, width: number) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}`;
const drivePreview = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
const driveVideo = (id: string, width: number, label: string, original?: string, ratio?: number): Slide => ({ kind: "drivevideo", id, src: driveMediaUrl(id), page: drivePreview(id), cover: driveThumb(id, width), label, original, ratio });

function vimeoId(link: string): string {
  return link.match(/vimeo\.com\/(?:video\/)?(\d{6,})/)?.[1] ?? "";
}

export function slideFromLink(link: string, format: string, width = 800): Slide | null {
  const url = link.trim();
  if (!/^https?:\/\//i.test(url) || driveFolderLinkId(url)) return null;
  const fileId = driveFileId(url);
  if (fileId) {
    // a post of format Video does not guarantee that its file is a video (it can be the cover picture): ask Drive what it is
    return { kind: "drivefile", id: fileId, hint: format === "Video" ? "video" : "image", page: url.replace("/view", "/preview"), original: url, label: "Drive file", width };
  }
  const yt = youtubeId(url);
  if (yt) return { kind: "embed", src: `https://www.youtube.com/embed/${yt}?rel=0`, autoplay: "autoplay=1", cover: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`, label: "YouTube video" };
  const vimeo = vimeoId(url);
  if (vimeo) return { kind: "embed", src: `https://player.vimeo.com/video/${vimeo}`, autoplay: "autoplay=1", label: "Vimeo video" };
  if (isVideoAsset(url)) return { kind: "video", src: url, label: "Video" };
  if (isImageAsset(url)) return { kind: "image", src: url, original: url, label: "Image" };
  return null;
}

/** A Drive file once its real type is known (or guessed from the post when Drive could not be asked). */
export function resolveDriveFile(slide: Extract<Slide, { kind: "drivefile" }>, kind: "image" | "video" | "other", ratio?: number): Slide {
  const as = kind === "other" ? slide.hint : kind;
  return as === "video"
    ? driveVideo(slide.id, slide.width, slide.label, slide.original, ratio)
    : { kind: "image", src: driveThumb(slide.id, slide.width), fallback: slide.page, original: slide.original, label: slide.label, ratio };
}

interface SavedItem { type?: string; src?: string; fallback?: string; original?: string; label?: string }

/**
 * Everything a post can show:
 * the live contents of its Drive folder, else the pictures saved in the post (a copy from the old app), else each link.
 */
export function buildSlides(opts: { asset: string; items?: SavedItem[]; folderItems?: DriveItem[]; /** The Drive folder was read: copies saved in the post no longer count. */ folderRead?: boolean; format: string; width?: number }): Slide[] {
  const width = opts.width ?? 800;
  const saved = (opts.items ?? []).filter((item) => item && (item.src || item.original) && item.type !== "folder");
  if (!opts.folderRead && !(opts.folderItems ?? []).some((item) => item && item.id) && saved.length) {
    return saved.map((item): Slide => {
      const src = item.src || item.original || "";
      if (item.type === "video") return { kind: "video", src, label: item.label || "Video" };
      if (item.type === "iframe") {
        const id = driveFileId(src);
        return id
          ? { kind: "drivefile", id, hint: "video", page: src, original: item.original, label: item.label || "Drive video", width }
          : { kind: "embed", src, label: item.label || "Video" };
      }
      return { kind: "image", src, fallback: item.fallback || item.original || undefined, original: item.original || undefined, label: item.label || "Image" };
    });
  }
  const folderItems = (opts.folderItems ?? []).filter((item) => item && item.id); // an item without a file id cannot be shown
  if (folderItems.length) {
    return folderItems.map((item): Slide =>
      item.type === "video"
        ? driveVideo(item.id, width, item.label, item.original, item.ratio)
        : { kind: "image", src: driveThumb(item.id, width), fallback: item.fallback, original: item.original, label: item.label, ratio: item.ratio }
    );
  }
  return assetLinks(opts.asset).map((link) => slideFromLink(link, opts.format, width)).filter((slide): slide is Slide => Boolean(slide));
}
