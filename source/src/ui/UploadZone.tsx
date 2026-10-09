import { useRef, useState, type DragEvent } from "react";
import { mediaType, putFile, startUpload, UploadError } from "../external/upload";
import { refreshDriveFolder } from "../lib/driveFolders";
import { CircleAlert, CircleCheck, Upload } from "./icons";

/**
 * Drop pictures and videos here: they go to the post's own Drive folder (made by the upload script) and the post's asset
 * link is pointed at it, so the preview shows them as soon as they are there.
 */

interface Row { id: number; name: string; size: number; sent: number; state: "waiting" | "sending" | "done" | "failed"; error?: string }

export interface UploadResult { folderId: string; folderUrl: string; count: number }

const sizeLabel = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

export function UploadZone({ title, date, onUploaded }: { title: string; date: string; onUploaded: (result: UploadResult) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState("");
  const files = useRef(new Map<number, File>());
  const nextId = useRef(1);
  const input = useRef<HTMLInputElement>(null);
  const busy = rows.some((row) => row.state === "waiting" || row.state === "sending");
  const ready = Boolean(title.trim() && date);

  const patchRow = (id: number, changes: Partial<Row>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));

  async function send(ids: number[]) {
    const batch = ids.map((id) => ({ id, file: files.current.get(id)! })).filter((entry) => entry.file);
    if (!batch.length) return;
    setMessage("");
    batch.forEach(({ id }) => patchRow(id, { state: "waiting", sent: 0, error: undefined }));
    try {
      const started = await startUpload({
        date, title: title.trim(),
        files: batch.map(({ file }) => ({ name: file.name, mimeType: mediaType(file), size: file.size }))
      });
      let done = 0;
      const queue = batch.map((entry, index) => ({ ...entry, uri: started.sessions[index]?.uri }));
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { id, file, uri } = next;
          if (!uri) { patchRow(id, { state: "failed", error: "No upload address." }); continue; }
          patchRow(id, { state: "sending" });
          try {
            await putFile(uri, file, mediaType(file), (sent) => patchRow(id, { sent }));
            patchRow(id, { state: "done", sent: file.size });
            done += 1;
          } catch (error) {
            patchRow(id, { state: "failed", error: error instanceof Error ? error.message : "Upload failed." });
          }
        }
      };
      await Promise.all([worker(), worker()]); // two at a time
      if (done > 0) {
        refreshDriveFolder(started.folderId);
        onUploaded({ folderId: started.folderId, folderUrl: started.folderUrl, count: done });
      }
    } catch (error) {
      const text = error instanceof UploadError ? error.message : "Could not start the upload.";
      batch.forEach(({ id }) => patchRow(id, { state: "failed", error: text }));
      setMessage(text);
    }
  }

  function add(list: FileList | File[]) {
    if (!ready) return;
    const picked = [...list];
    const accepted: number[] = [];
    const entries: Row[] = picked.map((file) => {
      const id = nextId.current++;
      const type = mediaType(file);
      if (!type) return { id, name: file.name, size: file.size, sent: 0, state: "failed", error: "Not a picture or a video." };
      if (!file.size) return { id, name: file.name, size: file.size, sent: 0, state: "failed", error: "The file is empty." };
      files.current.set(id, file);
      accepted.push(id);
      return { id, name: file.name, size: file.size, sent: 0, state: "waiting" };
    });
    setRows((current) => [...current.filter((row) => row.state !== "done"), ...entries]);
    void send(accepted);
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (event.dataTransfer.files.length) add(event.dataTransfer.files);
  };

  return (
    <section className="upz" aria-label="Upload pictures and videos">
      <div
        className={`upz-drop${over ? " is-over" : ""}${ready ? "" : " is-off"}`}
        onDragOver={(event) => { if (ready) { event.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Upload aria-hidden />
        <div>
          <strong>Drop pictures and videos here</strong>
          <span>{ready ? "They go to this post's Drive folder and show up in the preview." : "Add a title and a date first, so the folder gets its name."}</span>
        </div>
        <button type="button" className="btn btn--sm" disabled={!ready || busy} onClick={() => input.current?.click()}>Choose files</button>
        <input
          ref={input} type="file" multiple accept="image/*,video/*" hidden
          onChange={(event) => { if (event.target.files) add(event.target.files); event.target.value = ""; }}
        />
      </div>

      {message && <p className="field-hint upz-error" role="alert">{message}</p>}
      {rows.length > 0 && (
        <ul className="upz-list" aria-live="polite">
          {rows.map((row) => {
            const pct = row.size ? Math.min(100, Math.round((row.sent / row.size) * 100)) : 0;
            return (
              <li key={row.id} data-state={row.state}>
                <span className="upz-name">{row.name}</span>
                <span className="upz-meta">
                  {row.state === "done" && <><CircleCheck size={14} aria-hidden /> Sent</>}
                  {row.state === "failed" && <><CircleAlert size={14} aria-hidden /> {row.error}</>}
                  {row.state === "waiting" && "Waiting…"}
                  {row.state === "sending" && `${pct}% of ${sizeLabel(row.size)}`}
                </span>
                {row.state === "failed" && files.current.has(row.id) && <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void send([row.id])}>Retry</button>}
                {(row.state === "sending" || row.state === "waiting") && <span className="upz-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ transform: `scaleX(${pct / 100})` }} /></span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
