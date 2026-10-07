/**
 * Small fetch helpers shared by the external-data modules (budget, influencer sheet, approvals).
 * Pure TS, no DOM code: relies only on the global `fetch` and `AbortController`.
 */

export type FetchFailureKind = "timeout" | "aborted" | "network";

/** Thrown by {@link fetchText} / {@link fetchWithTimeout} when no HTTP response could be obtained or read. */
export class FetchFailure extends Error {
  readonly kind: FetchFailureKind;

  constructor(kind: FetchFailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FetchFailure";
    this.kind = kind;
  }
}

export interface TimeoutOptions {
  /** Hard limit for the whole operation (headers and body). Default 12 000 ms. */
  timeoutMs?: number;
  /** Caller-owned signal; aborting it cancels the request with kind "aborted". */
  signal?: AbortSignal;
}

export const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Runs `task` with an AbortSignal that fires when the timeout elapses or the caller aborts.
 * Any failure is normalised into a {@link FetchFailure}.
 */
export async function runWithTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const external = options.signal;
  if (external?.aborted) throw new FetchFailure("aborted", "Request cancelled");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  external?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    return await task(controller.signal);
  } catch (error) {
    if (error instanceof FetchFailure) throw error;
    if (timedOut) throw new FetchFailure("timeout", `No response after ${Math.round(timeoutMs / 1000)} s`, { cause: error });
    if (external?.aborted) throw new FetchFailure("aborted", "Request cancelled", { cause: error });
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new FetchFailure("network", `Network error${detail}`, { cause: error });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

export interface FetchedText {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
}

/** GET (or any method) a URL and read the whole body as text, under a single timeout. */
export function fetchText(url: string, init: RequestInit = {}, options: TimeoutOptions = {}): Promise<FetchedText> {
  return runWithTimeout(async (signal) => {
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers?.get?.("content-type") ?? "",
      text
    };
  }, options);
}

/** True when a response that should be CSV/JSON is really an HTML page (login wall, error page, SPA fallback). */
export function looksLikeHtml(text: string, contentType = ""): boolean {
  if (/text\/html/i.test(contentType)) return true;
  const head = text.replace(/^﻿/, "").trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<body");
}

export interface FetchedBytes {
  status: number;
  ok: boolean;
  contentType: string;
  bytes: Uint8Array;
}

/** GET a URL and read the whole body as bytes (workbook downloads), under a single timeout. */
export function fetchBytes(url: string, init: RequestInit = {}, options: TimeoutOptions = {}): Promise<FetchedBytes> {
  return runWithTimeout(async (signal) => {
    const response = await fetch(url, { ...init, signal });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, ok: response.ok, contentType: response.headers?.get?.("content-type") ?? "", bytes };
  }, options);
}

/** Resolves after `ms`, or rejects with FetchFailure("aborted") when the signal fires first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new FetchFailure("aborted", "Request cancelled"));
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new FetchFailure("aborted", "Request cancelled")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Semaphore: `limit(task)` runs `task` once fewer than `max` tasks are in flight (FIFO). */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active -= 1;
    queue.shift()?.();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active += 1;
        task().then(resolve, reject).finally(release);
      };
      if (active < max) run();
      else queue.push(run);
    });
}
