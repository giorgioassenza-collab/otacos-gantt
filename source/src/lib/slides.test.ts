import { describe, expect, it } from "vitest";
import { buildSlides, resolveDriveFile, slideFromLink } from "./slides";

describe("slides", () => {
  it("prefers the live folder over the pictures saved in the post, which may be out of date", () => {
    const slides = buildSlides({
      asset: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", format: "Carousel",
      items: [{ type: "image", src: "https://old/1.jpg" }],
      folderItems: [{ id: "n1", type: "image", src: "https://t/n1", fallback: "", original: "", label: "new" }]
    });
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ kind: "image", src: expect.stringContaining("thumbnail?id=n1") });
  });

  it("uses the pictures saved in the post when there is no live folder, in order, and turns the saved Drive-video pages into files to identify", () => {
    const slides = buildSlides({
      asset: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp",
      format: "Carousel",
      items: [{ type: "image", src: "https://x/1.jpg", fallback: "https://x/1/preview" }, { type: "iframe", src: "https://drive.google.com/file/d/v1/preview" }, { type: "image", src: "https://x/3.jpg" }]
    });
    expect(slides.map((s) => s.kind)).toEqual(["image", "drivefile", "image"]);
    expect(slides[1]).toMatchObject({ kind: "drivefile", id: "v1", hint: "video" });
  });

  it("falls back to the loaded Drive folder, with videos as players", () => {
    const slides = buildSlides({
      asset: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", format: "Carousel",
      folderItems: [
        { id: "a1", type: "image", src: "https://t/a1", fallback: "", original: "", label: "a" },
        { id: "b2", type: "video", src: "https://t/b2", fallback: "", original: "", label: "b" }
      ]
    });
    expect(slides[0]).toMatchObject({ kind: "image" });
    expect(slides[1]).toMatchObject({ kind: "drivevideo", id: "b2", src: expect.stringContaining("/drive/v3/files/b2?alt=media"), page: expect.stringContaining("/file/d/b2/preview") });
  });

  it("reads each pasted link: images, Drive files, YouTube, video files; skips folders and other pages", () => {
    const links = ["https://x.test/a.png", "https://drive.google.com/file/d/ABC123/view", "https://youtu.be/dQw4w9WgXcQ", "https://cdn.test/c.mp4", "https://www.instagram.com/p/xyz", "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"];
    const slides = buildSlides({ asset: links.join("\n"), format: "Static" });
    expect(slides.map((s) => s.kind)).toEqual(["image", "drivefile", "embed", "video"]); // a Drive file is asked about, YouTube is an embed
  });

  it("asks Drive what a file is instead of trusting the post's format, and only guesses from the format as a fallback", () => {
    const video = slideFromLink("https://drive.google.com/file/d/ABC123/view", "Video");
    const picture = slideFromLink("https://drive.google.com/file/d/ABC123/view", "Static");
    expect(video).toMatchObject({ kind: "drivefile", id: "ABC123", hint: "video" });
    expect(picture).toMatchObject({ kind: "drivefile", hint: "image" });
    if (video?.kind !== "drivefile") throw new Error("expected a drive file");
    // a picture stored in a Video post is shown as a picture
    expect(resolveDriveFile(video, "image")).toMatchObject({ kind: "image", src: expect.stringContaining("thumbnail?id=ABC123") });
    // a real video gets the player
    expect(resolveDriveFile(video, "video")).toMatchObject({ kind: "drivevideo", id: "ABC123", src: expect.stringContaining("alt=media"), page: "https://drive.google.com/file/d/ABC123/preview" });
    // Drive could not be asked: fall back to the format
    expect(resolveDriveFile(video, "other")).toMatchObject({ kind: "drivevideo" });
    if (picture?.kind !== "drivefile") throw new Error("expected a drive file");
    expect(resolveDriveFile(picture, "other")).toMatchObject({ kind: "image" });
  });

  it("returns nothing for an empty asset", () => {
    expect(buildSlides({ asset: "", format: "Static" })).toEqual([]);
  });
});

describe("slides ignore folder items that have no file id", () => {
  it("never builds a thumbnail?id=undefined address", () => {
    const slides = buildSlides({
      asset: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", format: "Carousel",
      // as cached by an older version of the app
      folderItems: [{ type: "image", src: "https://t/x", fallback: "", original: "", label: "old" } as never],
      items: [{ type: "image", src: "https://saved/1.jpg" }]
    });
    expect(slides.map((s) => (s.kind === "image" ? s.src : ""))).toEqual(["https://saved/1.jpg"]);
    expect(JSON.stringify(slides)).not.toContain("undefined");
  });
});
