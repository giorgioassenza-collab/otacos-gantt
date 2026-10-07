import { vi } from "vitest";

export type Route = Response | Error | "hang" | Promise<Response>;
export type Router = (url: string, init?: RequestInit) => Route;

export const csvResponse = (text: string, init: ResponseInit = {}) =>
  new Response(text, { status: 200, headers: { "content-type": "text/csv; charset=utf-8" }, ...init });

export const htmlResponse = (status = 200) =>
  new Response("<!DOCTYPE html><html><head><title>Sign in</title></head><body>Sign in</body></html>", {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const textStatus = (status: number, body = "") => new Response(body, { status });

export interface FetchCall {
  url: string;
  init?: RequestInit;
}

/**
 * Replaces global fetch with a router. Returns the recorded calls. A route of "hang" never resolves
 * but rejects with an AbortError when the request's signal fires (like a real fetch).
 */
export function mockFetch(router: Router): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const route = router(url, init);
      if (route === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true });
        });
      }
      if (route instanceof Error) return Promise.reject(route);
      return Promise.resolve(route);
    })
  );
  return calls;
}

export function tabNameOf(url: string): string | null {
  const match = /[?&]sheet=([^&]*)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The original knows nothing about the red-fill rule: compare against it on non-excluded data. Drops the fields the
 * port added (`excluded`, `colorsUnavailable`) after asserting they are neutral (nothing excluded).
 */
export function nonExcluded<T extends { excluded?: unknown[]; colorsUnavailable?: boolean }>(value: T): Omit<T, "excluded" | "colorsUnavailable"> {
  if (value.excluded && value.excluded.length) throw new Error("expected no excluded items in this comparison");
  const { excluded: _excluded, colorsUnavailable: _colors, ...rest } = value;
  return rest;
}
