import { describe, expect, it } from "vitest";
import { copyStats, needsMore, platformKind, tokenizeCopy } from "./copy";

describe("tokenizeCopy", () => {
  it("separates hashtags, mentions and links from plain text and keeps the text intact", () => {
    const text = "French Tacos Day 🌮 sabato! #FTD #frenchtacos con @otacos.it\nInfo: https://otacos.it/ftd";
    const tokens = tokenizeCopy(text);
    expect(tokens.map((t) => t.value).join("")).toBe(text);
    expect(tokens.filter((t) => t.type === "tag").map((t) => t.value)).toEqual(["#FTD", "#frenchtacos"]);
    expect(tokens.filter((t) => t.type === "mention").map((t) => t.value)).toEqual(["@otacos.it"]);
    expect(tokens.filter((t) => t.type === "link").map((t) => t.value)).toEqual(["https://otacos.it/ftd"]);
  });

  it("handles accents in hashtags and does not eat the full stop after a mention", () => {
    const tokens = tokenizeCopy("Che bontà #più e grazie a @luca.");
    expect(tokens.filter((t) => t.type === "tag").map((t) => t.value)).toEqual(["#più"]);
    expect(tokens.find((t) => t.type === "mention")?.value).toBe("@luca");
  });

  it("returns nothing for an empty copy", () => {
    expect(tokenizeCopy("")).toEqual([]);
  });
});

describe("copyStats", () => {
  it("counts an emoji as one character and counts hashtags and lines", () => {
    expect(copyStats("a🌮b #x #y\nc")).toEqual({ characters: 11, hashtags: 2, mentions: 0, lines: 2 });
    expect(copyStats("")).toEqual({ characters: 0, hashtags: 0, mentions: 0, lines: 0 });
  });
});

describe("platformKind", () => {
  it("recognises the networks from their id, label or short name", () => {
    expect(platformKind({ id: "instagram", label: "Instagram", short: "IG" })).toBe("instagram");
    expect(platformKind({ id: "x1", label: "TikTok", short: "TT" })).toBe("tiktok");
    expect(platformKind({ id: "tt" })).toBe("tiktok");
    expect(platformKind({ id: "igs", label: "IG Stories", short: "IGS" })).toBe("instagram");
    expect(platformKind({ id: "fb", label: "Facebook", short: "FB" })).toBe("other");
  });
});

describe("needsMore", () => {
  it("folds long or many-line captions", () => {
    expect(needsMore("short")).toBe(false);
    expect(needsMore("x".repeat(130))).toBe(true);
    expect(needsMore("a\nb\nc")).toBe(true);
  });
});

import { isStoryNetwork, isStoryPost } from "./copy";

describe("stories", () => {
  const socials = [
    { id: "instagram", label: "Instagram", short: "IG" },
    { id: "igs", label: "IG Stories", short: "IGS" },
    { id: "tiktok", label: "TikTok", short: "TT" }
  ];
  it("recognises story networks", () => {
    expect(isStoryNetwork(socials[1])).toBe(true);
    expect(isStoryNetwork({ id: "x", label: "Instagram Story", short: "" })).toBe(true);
    expect(isStoryNetwork(socials[0])).toBe(false);
  });
  it("is a story only when every selected network is a story network", () => {
    expect(isStoryPost(["igs"], socials)).toBe(true);
    expect(isStoryPost(["igs", "instagram"], socials)).toBe(false);
    expect(isStoryPost(["tiktok"], socials)).toBe(false);
    expect(isStoryPost([], socials)).toBe(false);
  });
});
