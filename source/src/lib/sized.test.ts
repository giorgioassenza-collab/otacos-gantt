import { describe, expect, it } from "vitest";
import { buildSlides, resolveDriveFile } from "./slides";

// what a failed picture needs in order to offer "Open": the original link must survive until the picture is resolved
describe("slides keep what a failed picture needs", () => {
  it("carries the original link from the Drive file to the resolved picture", () => {
    const [slide] = buildSlides({ asset: "https://drive.google.com/file/d/ABC123/view", format: "Static" });
    expect(slide).toMatchObject({ kind: "drivefile", original: "https://drive.google.com/file/d/ABC123/view" });
    if (slide.kind !== "drivefile") throw new Error("expected a drive file");
    expect(resolveDriveFile(slide, "image")).toMatchObject({ kind: "image", original: "https://drive.google.com/file/d/ABC123/view" });
  });
});
