import { previewFor, type AssetPreview } from "./assets";
import { useDriveFolder } from "./driveFolders";

/** The preview of a post's asset. Drive folders are opened (through the cache) so they show a real picture. */
export function useAssetPreview(
  asset: string | undefined,
  items: { type?: string; src?: string; fallback?: string; original?: string }[] | undefined,
  width = 320
): { preview: AssetPreview; loading: boolean } {
  const base = previewFor(asset, items, width);
  const folderId = base.kind === "tile" ? base.folderId ?? "" : "";
  const folder = useDriveFolder(folderId);
  if (base.kind === "tile" && folderId) {
    const first = folder.items.find((item) => item.type === "image") ?? folder.items[0];
    if (first) return { preview: { kind: "image", src: first.src, fallback: first.fallback, count: folder.items.length, play: first.type === "video" }, loading: false };
    return { preview: { ...base, label: folder.loading ? "Loading folder…" : "Drive folder" }, loading: folder.loading };
  }
  return { preview: base, loading: false };
}
