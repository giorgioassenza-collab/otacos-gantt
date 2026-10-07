/**
 * Shared helpers for the influencer view, editor and settings (ports of the small pure helpers of the old app:
 * influencerOptionColor, influencerOptionTextColor, influencerProfileUrl, duplicateInfluencerInfo, ...).
 */
import { influencerColumns, type InfluencerColumn } from "../../data/starter";
import {
  isDefaultInfluencerTextColor,
  projectColorForName,
  readableTextColor,
  uxInfluencerOptionColor
} from "../../data/normalize";
import type { BoardData, Influencer, InfluencerOptionKey } from "../../data/types";
import { isClientName } from "../../data/util";

export const OPTION_KEYS: InfluencerOptionKey[] = ["city", "target", "type", "status", "where", "when"];

export const OPTION_LABELS: Record<InfluencerOptionKey, string> = {
  city: "City",
  target: "Target",
  type: "Type",
  status: "Status",
  where: "Where",
  when: "When"
};

export function isOptionKey(key: string): key is InfluencerOptionKey {
  return (OPTION_KEYS as string[]).includes(key);
}

/** Columns shown in the table (TT LINK / IG LINK are hidden: the link lives behind the profile cell). */
export const VISIBLE_COLUMNS: InfluencerColumn[] = influencerColumns.filter((column) => !column.hidden);

export function columnLabel(data: Pick<BoardData, "influencerColumnLabels">, column: InfluencerColumn): string {
  return data.influencerColumnLabels?.[column.key] || column.label;
}

export interface OptionStyle { background: string; color: string }

/** The part of the board the option colours depend on. */
export type OptionSource = Pick<BoardData, "projects" | "influencerOptions">;

/** Background colour of an option value (project colour wins, as in the old app). */
export function optionColor(data: OptionSource, key: InfluencerOptionKey, value: string): string {
  const projectColor = projectColorForName(data.projects, value);
  if (projectColor) return projectColor;
  const item = (data.influencerOptions?.[key] || []).find((option) => option.name === value);
  return item?.color || uxInfluencerOptionColor(key, value, 0, data.projects);
}

export function optionTextColor(data: OptionSource, key: InfluencerOptionKey, value: string): string {
  const item = (data.influencerOptions?.[key] || []).find((option) => option.name === value);
  const background = optionColor(data, key, value);
  return isDefaultInfluencerTextColor(item?.textColor) ? readableTextColor(background) : (item?.textColor as string);
}

export function optionStyle(data: OptionSource, key: InfluencerOptionKey, value: string): OptionStyle {
  return { background: optionColor(data, key, value), color: optionTextColor(data, key, value) };
}

/** Names of an option list, plus the current value when it is not in the list (so it is never lost). */
export function optionNames(data: BoardData, key: InfluencerOptionKey, current = ""): string[] {
  const names = (data.influencerOptions?.[key] || []).map((option) => option.name).filter(Boolean);
  if (current && !names.includes(current)) names.unshift(current);
  return names;
}

/** Everyone who can be assigned a task (the clients Giorgia and Alice are approvers, not assignees). */
export function assignableMembers(data: Pick<BoardData, "members">): string[] {
  return [...new Set(data.members || [])].filter((member) => !isClientName(member));
}

/** Profile URL: stored link, then a full URL typed in the profile cell, then built from the handle or the name. */
export function profileUrl(platform: "tt" | "ig", value: string, row: Pick<Influencer, "ttLink" | "igLink" | "name">): string {
  const stored = platform === "tt" ? row.ttLink : row.igLink;
  if (stored) return stored;
  const clean = String(value || "").trim();
  if (/^https?:\/\//i.test(clean)) return clean;
  const source = clean && /[a-zA-Z_@.]/.test(clean) ? clean : row.name;
  const handle = String(source || "").replace(/^@/, "").split(/\s+/)[0];
  if (!handle) return "";
  return platform === "tt" ? `https://www.tiktok.com/@${encodeURIComponent(handle)}` : `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}

/** Only http(s) links are ever rendered as href (a stored value could be anything). */
export function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "";
}

export function normalizedInfluencerName(value: unknown): string {
  return String(value || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
}

export interface DuplicateInfo { rowNumber: number; name: string }

/** Pre-computes, per row id, the first other row whose name matches (equal or one contains the other). */
export function duplicateMap(ordered: Influencer[]): Map<string, DuplicateInfo> {
  const names = ordered.map((row) => normalizedInfluencerName(row.name));
  const result = new Map<string, DuplicateInfo>();
  ordered.forEach((row, index) => {
    const name = names[index];
    if (name.length < 4) return;
    for (let other = 0; other < ordered.length; other += 1) {
      if (other === index) continue;
      const candidate = names[other];
      if (candidate.length < 4) continue;
      if (candidate === name || candidate.includes(name) || name.includes(candidate)) {
        result.set(row.id, { rowNumber: other + 1, name: ordered[other].name });
        return;
      }
    }
  });
  return result;
}

/** Same check for one (possibly unsaved) name against the saved rows, ignoring `selfId`. */
export function duplicateOf(ordered: Influencer[], name: string, selfId = ""): DuplicateInfo | null {
  const wanted = normalizedInfluencerName(name);
  if (wanted.length < 4) return null;
  const index = ordered.findIndex((candidate) => {
    if (candidate.id === selfId) return false;
    const candidateName = normalizedInfluencerName(candidate.name);
    if (candidateName.length < 4) return false;
    return candidateName === wanted || candidateName.includes(wanted) || wanted.includes(candidateName);
  });
  return index < 0 ? null : { rowNumber: index + 1, name: ordered[index].name };
}

export function sortedInfluencers(rows: Influencer[]): Influencer[] {
  const value = (row: Influencer) => (Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0);
  return [...(rows || [])].sort((a, b) => value(a) - value(b));
}
