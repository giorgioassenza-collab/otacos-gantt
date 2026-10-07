/**
 * "Tasks to approve" API client: a port of the network part of the original email-review.js.
 * No DOM code. The UI owns rendering and the confirm/alert prompts.
 *
 * Endpoints (same as the original):
 *   GET  <api>                        -> { reviews: EmailReview[], choices: ApprovalChoices }
 *   POST <api>  {action, reviewId, task?}  -> JSON; failures carry { error: string }
 * where <api> is https://otacos-workflow.vercel.app/api/email-reviews on *.github.io and
 * /api/email-reviews on any other host.
 *
 * Deviations from the original, on purpose:
 *  - a 2xx answer that is not JSON (e.g. an HTML page from a static host) is an error, not silent
 *    success / empty list; an empty 2xx body to POST is still success;
 *  - network failures and timeouts are distinguished (ApprovalsError.kind);
 *  - requests have a timeout (15 s by default).
 */

import { fetchText, looksLikeHtml, FetchFailure } from "./http";

export const EMAIL_REVIEWS_REMOTE_URL = "https://otacos-workflow.vercel.app/api/email-reviews";
export const EMAIL_REVIEWS_LOCAL_PATH = "/api/email-reviews";
export const APPROVALS_TIMEOUT_MS = 15_000;

/** github.io pages call the Vercel deployment; any other host uses its own /api route. */
export function resolveReviewApiUrl(hostname?: string): string {
  const host = hostname ?? (typeof location !== "undefined" ? location.hostname : "");
  return host.endsWith("github.io") ? EMAIL_REVIEWS_REMOTE_URL : EMAIL_REVIEWS_LOCAL_PATH;
}

// ---------------------------------------------------------------------------
// Types

/** The task the email was turned into (a proposal; the user can edit it before approving). */
export interface ReviewTask {
  name?: string;
  projectId?: string;
  status?: string;
  members?: string[];
  /** YYYY-MM-DD */
  start?: string;
  /** YYYY-MM-DD */
  end?: string;
  info?: string;
  /** 0..1 */
  confidence?: number;
}

export interface EmailReview {
  id: string;
  sender?: string;
  senderEmail?: string;
  /** ISO timestamp; the list is sorted by it, newest first. */
  receivedAt?: string;
  subject?: string;
  excerpt?: string;
  emailUrl?: string;
  task?: ReviewTask;
}

export interface ApprovalChoice {
  value: string;
  label: string;
}

/** Options for the Project / Status / Who selects. */
export interface ApprovalChoices {
  projects: ApprovalChoice[];
  statuses: ApprovalChoice[];
  members: ApprovalChoice[];
}

export interface EmailReviewList {
  reviews: EmailReview[];
  choices: ApprovalChoices;
}

/** Body of the approve call: the (possibly edited) task. Dates are YYYY-MM-DD or "". */
export interface ApprovedTask {
  name: string;
  projectId: string;
  status: string;
  members: string[];
  start: string;
  end: string;
  info: string;
}

export type ReviewAction = "approve" | "reject";

export interface ReviewActionRequest {
  action: ReviewAction;
  reviewId: string;
  /** Present for "approve", omitted for "reject". */
  task?: ApprovedTask;
}

export type ApprovalsErrorKind = "network" | "timeout" | "aborted" | "http" | "invalid-response";

export class ApprovalsError extends Error {
  readonly kind: ApprovalsErrorKind;
  /** HTTP status when the server answered. */
  readonly status?: number;

  constructor(kind: ApprovalsErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ApprovalsError";
    this.kind = kind;
    this.status = status;
  }
}

export interface ApprovalsRequestOptions {
  signal?: AbortSignal;
  /** Override the API URL (tests, local server). Defaults to resolveReviewApiUrl(). */
  apiUrl?: string;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers shared with the UI

/** Keeps only well-formed YYYY-MM-DD dates, as the original `dateValue` did. */
export function dateValue(value: unknown): string {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

/** Raw form values (strings straight from the inputs) to the payload the server expects. */
export function buildApprovedTask(values: {
  name?: string;
  projectId?: string;
  status?: string;
  /** Comma-separated names, e.g. "Max, Giorgia". */
  members?: string;
  start?: string;
  end?: string;
  info?: string;
}): ApprovedTask {
  const trim = (value: string | undefined) => (value || "").trim();
  return {
    name: trim(values.name),
    projectId: trim(values.projectId),
    status: trim(values.status),
    members: trim(values.members).split(",").map((item) => item.trim()).filter(Boolean),
    start: dateValue(trim(values.start)),
    end: dateValue(trim(values.end)),
    info: trim(values.info)
  };
}

/** The checks the original ran before sending "approve". Returns a message, or null when the task can be sent. */
export function validateApprovedTask(task: ApprovedTask): string | null {
  if (!task.name) return "Give the task a title";
  if (!task.projectId) return "Pick a project before adding the task";
  if (!task.start) return "Pick a date before adding the task";
  return null;
}

// ---------------------------------------------------------------------------
// Response handling

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function errorMessageFrom(payload: Record<string, unknown> | null, fallback: string): string {
  const message = payload?.error;
  return typeof message === "string" && message ? message : fallback;
}

async function request(init: RequestInit, options: ApprovalsRequestOptions) {
  try {
    return await fetchText(options.apiUrl ?? resolveReviewApiUrl(), init, {
      timeoutMs: options.timeoutMs ?? APPROVALS_TIMEOUT_MS,
      signal: options.signal
    });
  } catch (error) {
    if (error instanceof FetchFailure) {
      throw new ApprovalsError(error.kind, error.kind === "network" ? "Cannot reach the approvals service" : error.message);
    }
    throw new ApprovalsError("network", "Cannot reach the approvals service");
  }
}

function asChoices(value: unknown): ApprovalChoice[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({ value: String(item.value ?? ""), label: String(item.label ?? item.value ?? "") }));
}

function asReviews(value: unknown): EmailReview[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is EmailReview => item !== null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string");
}

// ---------------------------------------------------------------------------
// Calls

/** GET the queue. Reviews are sorted by receivedAt, newest first. */
export async function fetchEmailReviews(options: ApprovalsRequestOptions = {}): Promise<EmailReviewList> {
  const response = await request({ cache: "no-store" }, options);
  const payload = parseJsonObject(response.text);
  if (!response.ok) {
    throw new ApprovalsError("http", errorMessageFrom(payload, "Queue unavailable"), response.status);
  }
  if (!payload || looksLikeHtml(response.text, response.contentType)) {
    throw new ApprovalsError("invalid-response", "The approvals service returned an unexpected answer", response.status);
  }
  const reviews = asReviews(payload.reviews)
    .slice()
    .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  const rawChoices = (payload.choices && typeof payload.choices === "object" ? payload.choices : {}) as Record<string, unknown>;
  return {
    reviews,
    choices: {
      projects: asChoices(rawChoices.projects),
      statuses: asChoices(rawChoices.statuses),
      members: asChoices(rawChoices.members)
    }
  };
}

/** POST an action. Resolves with the parsed JSON body ({} for an empty body); throws ApprovalsError otherwise. */
export async function sendReviewAction(
  { action, reviewId, task }: ReviewActionRequest,
  options: ApprovalsRequestOptions = {}
): Promise<Record<string, unknown>> {
  const response = await request(
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // JSON.stringify drops `task: undefined`, so "reject" sends only { action, reviewId } like the original.
      body: JSON.stringify({ action, reviewId, task })
    },
    options
  );
  const payload = parseJsonObject(response.text);
  if (!response.ok) {
    throw new ApprovalsError("http", errorMessageFrom(payload, "Something went wrong"), response.status);
  }
  if (!payload && response.text.trim()) {
    throw new ApprovalsError("invalid-response", "The approvals service returned an unexpected answer", response.status);
  }
  return payload ?? {};
}

/** "Approve and add": validates nothing itself, see validateApprovedTask. */
export function approveEmailReview(reviewId: string, task: ApprovedTask, options: ApprovalsRequestOptions = {}) {
  return sendReviewAction({ action: "approve", reviewId, task }, options);
}

/** "Dismiss": the original action name on the wire is "reject". */
export function dismissEmailReview(reviewId: string, options: ApprovalsRequestOptions = {}) {
  return sendReviewAction({ action: "reject", reviewId }, options);
}
