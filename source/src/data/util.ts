import { now } from "./clock";
import type { Status } from "./types";

/** JSON round trip: strips undefined/functions and makes the value safe for Firestore. */
export function cleanForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** JSON with object keys in a fixed order: Firestore hands maps back with sorted keys, local objects keep insertion order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
    }
    return item;
  });
}

/**
 * Deep equality as JSON. The old app compares JSON.stringify output, which also depends on object KEY ORDER; two copies
 * of the same board can differ only by key order (a local object vs the one read back from Firestore), which made the
 * old comparison report spurious differences (and spurious "repair" saves). Here key order is ignored; array order and
 * values still matter.
 */
export function sameData(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function statusName(status: string | { name?: string } | null | undefined): string {
  if (typeof status === "string") return status;
  return (status as { name: string }).name;
}

export function slugify(value: unknown): string {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `social-${now()}`
  );
}

export function uniqueStrings(...lists: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  lists.flat().forEach((value) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase());
    result.push(text);
  });
  return result;
}

/** Key used to compare influencer option names (type, city...) and type-progress config entries. */
export function influencerOptionKey(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function itemUpdatedAt(item: { updatedAt?: unknown; createdAt?: unknown } | null | undefined): number {
  return Number(item?.updatedAt || item?.createdAt || 0);
}

export function collectionById<T extends { id?: string }>(items: T[] | null | undefined = []): Map<string, T> {
  return new Map((items || []).filter((item) => item?.id).map((item) => [item.id as string, item]));
}

function withoutVolatileFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatileFields);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  return Object.keys(source)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      if (key === "updatedAt") return result;
      result[key] = withoutVolatileFields(source[key]);
      return result;
    }, {});
}

/** Order independent JSON that ignores `updatedAt` (used to detect real content changes). */
export function stableDataString(value: unknown): string {
  return JSON.stringify(withoutVolatileFields(value || null));
}

export const clientNames = ["Giorgia", "Alice"];

export function isClientName(name: unknown): boolean {
  return clientNames.some((client) => client.toLowerCase() === String(name || "").trim().toLowerCase());
}

export function normalizeStatusList(
  list: Array<string | Partial<Status>> | undefined | null,
  fallback: Array<string | Partial<Status>>,
  colors: string[]
): Status[] {
  return (list && list.length ? list : fallback).map((status, index) => {
    if (typeof status === "string") {
      return { name: status, color: colors[index % colors.length] };
    }
    return {
      name: status.name || "Status",
      color: status.color || colors[index % colors.length]
    };
  });
}

/** Keys of `source` that are not in `known` (used to carry unknown fields through normalization). */
export function extraFields(source: Record<string, unknown>, known: Iterable<string>): Record<string, unknown> {
  const skip = new Set(known);
  const extras: Record<string, unknown> = {};
  Object.keys(source).forEach((key) => {
    if (!skip.has(key)) extras[key] = source[key];
  });
  return extras;
}
