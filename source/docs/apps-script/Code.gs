/**
 * O'Tacos PED uploads.
 *
 * The app asks this script for a place to put the files of a post. The script checks that the request comes from a
 * signed-in team session, makes (or finds) the post's folder inside the shared "PED - Caricamenti" folder, and hands back
 * one upload address per file. The browser then sends each file straight to Drive, so large videos do not pass through
 * the script.
 */

const ROOT_FOLDER_ID = "1eS0lV0YJ75U260uSa4CF-ytEB28m0El9"; // O'Tacos Italy Repository (Shared Drive)
const UPLOADS_FOLDER_NAME = "PED - Caricamenti";
const FIREBASE_API_KEY = "AIzaSyCq4dqoSiAe-_mAVxBGOkuS8U54-xZgoNs"; // public web key of the app
const TEAM_EMAIL = "team@otacos-workflow.app";
const APP_ORIGIN = "https://giorgioassenza-collab.github.io";
const MAX_FILES = 30;
const MAX_BYTES = 4 * 1024 * 1024 * 1024; // per file

/** Run this once by hand (Esegui) so Google asks you to allow the script. */
function authorize() {
  DriveApp.getFolderById(ROOT_FOLDER_ID).getName();
  UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true });
}

function doGet() {
  return reply({ ok: true, name: "O'Tacos PED uploads" });
}

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    if (!signedIn(request.token)) return reply({ ok: false, error: "Not signed in. Reload the app and sign in again." });
    if (request.action === "start") return reply(start(request));
    return reply({ ok: false, error: "Unknown request." });
  } catch (error) {
    return reply({ ok: false, error: String((error && error.message) || error) });
  }
}

function reply(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

/** The token is the app's Firebase sign-in; Google tells us who it belongs to. */
function signedIn(token) {
  if (!token || typeof token !== "string") return false;
  const response = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY, {
    method: "post",
    contentType: "application/json",
    headers: { Referer: APP_ORIGIN + "/otacos-gantt/" }, // the key only accepts calls that look like they come from the app
    payload: JSON.stringify({ idToken: token }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return false;
  const users = JSON.parse(response.getContentText()).users || [];
  return users.length > 0 && users[0].email === TEAM_EMAIL;
}

function start(request) {
  const date = String(request.date || "");
  const title = String(request.title || "").trim();
  const files = Array.isArray(request.files) ? request.files : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) throw new Error("The post needs a title and a date before files can be added.");
  if (!files.length || files.length > MAX_FILES) throw new Error("Choose between 1 and " + MAX_FILES + " files.");
  files.forEach(function (file) {
    if (!/^(image|video)\//.test(String(file.mimeType || ""))) throw new Error(file.name + " is not a picture or a video.");
    if (!(Number(file.size) > 0 && Number(file.size) <= MAX_BYTES)) throw new Error(file.name + " is empty or too large.");
  });

  const folder = postFolder(date, title);
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // the app reads the folder through its link
  } catch (error) {
    // the company may forbid link sharing; the files are still saved
  }
  return {
    ok: true,
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    sessions: files.map(function (file) { return { name: file.name, uri: uploadSession(folder.getId(), file) }; })
  };
}

function uploadsRoot() {
  const parent = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const found = parent.getFoldersByName(UPLOADS_FOLDER_NAME);
  return found.hasNext() ? found.next() : parent.createFolder(UPLOADS_FOLDER_NAME);
}

function postFolder(date, title) {
  const name = (date + " " + title).replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const root = uploadsRoot();
  const found = root.getFoldersByName(name);
  return found.hasNext() ? found.next() : root.createFolder(name);
}

/** Starts a resumable upload and returns the address the browser sends the file to. */
function uploadSession(folderId, file) {
  const response = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id", {
    method: "post",
    contentType: "application/json; charset=UTF-8",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      "X-Upload-Content-Type": String(file.mimeType),
      "X-Upload-Content-Length": String(file.size),
      Origin: APP_ORIGIN // lets the browser talk to the upload address
    },
    payload: JSON.stringify({ name: String(file.name).replace(/[\\/]/g, "_").slice(0, 200), parents: [folderId] }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error("Drive refused the upload (" + response.getResponseCode() + "): " + response.getContentText().slice(0, 200));
  const headers = response.getHeaders();
  const location = headers.Location || headers.location;
  if (!location) throw new Error("Drive did not return an upload address.");
  return location;
}
