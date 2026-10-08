/** The text of a post's copy (caption) split into the parts a social network colours: hashtags, mentions and links. */
export type CopyToken = { type: "text" | "tag" | "mention" | "link"; value: string };

const PARTS = /(#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]*[\p{L}\p{N}_]|https?:\/\/[^\s]+)/gu;

export function tokenizeCopy(text: string): CopyToken[] {
  const tokens: CopyToken[] = [];
  let last = 0;
  for (const match of text.matchAll(PARTS)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: "text", value: text.slice(last, index) });
    const value = match[0];
    tokens.push({ type: value.startsWith("#") ? "tag" : value.startsWith("@") ? "mention" : "link", value });
    last = index + value.length;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return tokens;
}

export interface CopyStats { characters: number; hashtags: number; mentions: number; lines: number }

export function copyStats(text: string): CopyStats {
  const tokens = tokenizeCopy(text);
  return {
    characters: [...text].length, // code points, so an emoji counts as one
    hashtags: tokens.filter((t) => t.type === "tag").length,
    mentions: tokens.filter((t) => t.type === "mention").length,
    lines: text ? text.split(/\r?\n/).length : 0
  };
}

export type PlatformKind = "instagram" | "tiktok" | "other";

export function platformKind(social: { id?: string; label?: string; short?: string }): PlatformKind {
  const key = `${social.id ?? ""} ${social.label ?? ""} ${social.short ?? ""}`.toLowerCase();
  if (/insta|\big\b/.test(key)) return "instagram";
  if (/tik\s?tok|\btt\b/.test(key)) return "tiktok";
  return "other";
}

/** Instagram shows about this much of a caption before "more". */
export const IG_CAPTION_PEEK = 125;

/** Whether a caption is long enough to be folded behind "more" the way the feed does. */
export function needsMore(text: string, maxChars = IG_CAPTION_PEEK, maxLines = 2): boolean {
  return [...text].length > maxChars || text.split(/\r?\n/).length > maxLines;
}

/** Stories are posted without a caption: Instagram Stories (and the like). */
export function isStoryNetwork(social: { id?: string; label?: string; short?: string }): boolean {
  const key = `${social.id ?? ""} ${social.label ?? ""} ${social.short ?? ""}`.toLowerCase();
  return /stor(y|ies)|\bigs\b/.test(key);
}

/** A post is a story when every network it goes out on is a story network (a post also going to the feed has a caption). */
export function isStoryPost(selectedIds: string[], socials: { id: string; label?: string; short?: string }[]): boolean {
  const chosen = socials.filter((s) => selectedIds.includes(s.id));
  return chosen.length > 0 && chosen.every(isStoryNetwork);
}
