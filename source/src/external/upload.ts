import { currentIdToken } from "../data/firebaseBackend";

/**
 * Sending pictures and videos to the post's Drive folder. The Apps Script (docs/apps-script/Code.gs, published as a web app
 * that runs as the team's Google account) checks the team sign-in, makes the post's folder and returns one upload address
 * per file; the browser then sends each file straight to Drive.
 */

export const UPLOAD_ENDPOINT = "https://script.google.com/macros/s/AKfycby98TJxhEO8bHJszkY06hpMgJ37_ITVfN8SjehEy5Ebe8vKxNKc6o-fbq1fDN7Zz5X5lQ/exec";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

/** The type of a file, from the browser or, when it does not say, from the file name. Empty when it is neither picture nor video. */
export function mediaType(file: { name: string; type: string }): string {
  if (/^(image|video)\//.test(file.type)) return file.type;
  if (IMAGE_EXT.test(file.name)) return "image/" + (file.name.split(".").pop() ?? "jpeg").toLowerCase().replace("jpg", "jpeg");
  if (VIDEO_EXT.test(file.name)) return file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
  return "";
}

export interface UploadStart {
  folderId: string;
  folderUrl: string;
  sessions: { name: string; uri: string }[];
}

export class UploadError extends Error {}

/** Asks the script for the post's folder and an upload address for each file. */
export async function startUpload(args: { date: string; title: string; files: { name: string; mimeType: string; size: number }[] }): Promise<UploadStart> {
  const token = await currentIdToken();
  if (!token) throw new UploadError("Uploads need the shared board to be connected. Reload the app and sign in again.");
  let response: Response;
  try {
    // text/plain keeps this a simple request, so the browser does not need permission to send it
    response = await fetch(UPLOAD_ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "start", token, ...args }) });
  } catch {
    throw new UploadError("Cannot reach the upload service. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } & Partial<UploadStart> | null;
  if (!payload?.ok || !payload.folderId || !payload.sessions) throw new UploadError(payload?.error || "The upload service did not answer.");
  return { folderId: payload.folderId, folderUrl: payload.folderUrl ?? "", sessions: payload.sessions };
}

/**
 * Sends one file to its upload address, reporting progress. If Drive takes the whole file but the browser is not allowed
 * to read the answer, that counts as sent ("unconfirmed"): the folder is read again afterwards and shows it.
 */
export function putFile(uri: string, file: File, mimeType: string, onProgress: (sent: number) => void, signal?: AbortSignal): Promise<"ok" | "unconfirmed"> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sent = 0;
    xhr.open("PUT", uri);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.upload.onprogress = (event) => { sent = event.loaded; onProgress(event.loaded); };
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) { onProgress(file.size); resolve("ok"); }
      else reject(new UploadError(`Drive answered ${xhr.status}.`));
    };
    xhr.onerror = () => {
      if (sent >= file.size && file.size > 0) resolve("unconfirmed");
      else reject(new UploadError("The connection dropped while sending the file."));
    };
    xhr.onabort = () => reject(new UploadError("Cancelled."));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
