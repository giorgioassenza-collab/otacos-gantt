/**
 * Reads the contents of a public Google Drive folder through the Drive API (the same call the old app made first, with
 * the same public web key), so a post whose asset is a Drive folder can show a real picture.
 * No third-party proxy is involved: only googleapis.com and drive.google.com are contacted. The folder has to be shared
 * as "anyone with the link"; otherwise the API answers 403/404 and the caller shows a tile instead.
 */
import { firebaseConfig } from "../data/firebaseBackend";

export interface DriveItem {
  id: string;
  type: "image" | "video";
  /** Thumbnail URL. */
  src: string;
  fallback: string;
  original: string;
  label: string;
}

export function driveFolderIdOf(link: string): string {
  const url = String(link || "").trim();
  if (!url.includes("drive.google.com")) return "";
  return url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/)?.[1]
    || (url.includes("folderview") ? url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/)?.[1] ?? "" : "")
    || "";
}

/** The file itself, streamable by a <video> element (supports seeking). Works for files shared as "anyone with the link". */
export function driveMediaUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(firebaseConfig.apiKey)}`;
}

export function driveFolderRequestUrl(folderId: string): string {
  const query = `'${folderId}' in parents and trashed=false`;
  const fields = "files(id,name,mimeType,webViewLink)";
  return `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}`
    + `&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name&key=${encodeURIComponent(firebaseConfig.apiKey)}`;
}

interface DriveFile { id: string; name?: string; mimeType?: string; webViewLink?: string }

export function driveItemsFromFiles(files: DriveFile[]): DriveItem[] {
  return files
    .filter((file) => /^image\/|^video\//.test(String(file.mimeType || "")))
    .map((file) => ({
      id: file.id,
      type: String(file.mimeType).startsWith("video/") ? ("video" as const) : ("image" as const),
      src: `https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w800`,
      fallback: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/preview`,
      original: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
      label: file.name || (String(file.mimeType).startsWith("video/") ? "Drive video" : "Drive image")
    }));
}

export type DriveFolderResult =
  | { status: "ok"; items: DriveItem[] }
  | { status: "empty" }
  | { status: "error"; message: string };

export async function fetchDriveFolder(folderId: string, signal?: AbortSignal, timeoutMs = 9000): Promise<DriveFolderResult> {
  if (!folderId) return { status: "empty" };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(driveFolderRequestUrl(folderId), { signal: controller.signal });
    if (!response.ok) return { status: "error", message: response.status === 403 || response.status === 404 ? "The folder is not shared with a link." : `Drive answered ${response.status}.` };
    const payload = (await response.json()) as { files?: DriveFile[] };
    const items = driveItemsFromFiles(payload.files ?? []);
    return items.length ? { status: "ok", items } : { status: "empty" };
  } catch (error) {
    return { status: "error", message: controller.signal.aborted ? "Drive did not answer in time." : "Cannot reach Google Drive." };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
