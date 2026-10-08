import { describe, expect, it } from "vitest";
import { buildSlides } from "./slides";

// the Drive thumbnail size is rewritten by PostMedia; here we only pin the urls the slide model hands over
describe("slides keep what a failed picture needs", () => {
  it("carries the original link so the card can offer to open it", () => {
    const [slide] = buildSlides({ asset: "https://drive.google.com/file/d/ABC123/view", format: "Static" });
    expect(slide).toMatchObject({ kind: "image", original: "https://drive.google.com/file/d/ABC123/view" });
  });
});
