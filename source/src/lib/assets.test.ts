import { describe, expect, it } from "vitest";
import { driveFolderLinkId, previewFor, youtubeId } from "./assets";

describe("previewFor: there is always something to show", () => {
  it("prefers thumbnails saved in the post", () => {
    const p = previewFor("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", [{ type: "image", src: "https://x/a.jpg" }, { type: "image", src: "https://x/b.jpg" }]);
    expect(p).toMatchObject({ kind: "image", src: "https://x/a.jpg", count: 2 });
  });
  it("uses a direct image and a single Drive file", () => {
    expect(previewFor("https://x.test/a.png", [])).toMatchObject({ kind: "image", src: "https://x.test/a.png" });
    expect(previewFor("https://drive.google.com/file/d/ABC123/view", [], 400)).toMatchObject({ kind: "image", src: expect.stringContaining("thumbnail?id=ABC123&sz=w400") });
  });
  it("shows the cover of a YouTube link with a play button", () => {
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(previewFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ", [])).toMatchObject({ kind: "image", play: true, src: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
  });
  it("shows the first frame of a direct video file", () => {
    expect(previewFor("https://cdn.test/clip.mp4", [])).toEqual({ kind: "videofile", src: "https://cdn.test/clip.mp4" });
  });
  it("marks a Drive folder so its pictures can be loaded", () => {
    expect(driveFolderLinkId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp");
    expect(previewFor("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", [])).toMatchObject({ kind: "tile", icon: "folder", folderId: "1AbCdEfGhIjKlMnOp" });
  });
  it("falls back to a tile for any other link, and for no asset at all", () => {
    expect(previewFor("https://www.instagram.com/p/xyz", [])).toMatchObject({ kind: "tile", icon: "link", label: "instagram.com" });
    expect(previewFor("", [])).toMatchObject({ kind: "tile", icon: "none", label: "No asset yet" });
    expect(previewFor(undefined, undefined)).toMatchObject({ kind: "tile", icon: "none" });
  });
  it("looks at every line of a multi-link asset", () => {
    expect(previewFor("https://www.instagram.com/p/xyz\nhttps://x.test/cover.jpg", [])).toMatchObject({ kind: "image", src: "https://x.test/cover.jpg" });
  });
});
