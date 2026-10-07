// fetch is always mocked; the Vercel endpoint is never contacted.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalsError,
  EMAIL_REVIEWS_LOCAL_PATH,
  EMAIL_REVIEWS_REMOTE_URL,
  approveEmailReview,
  buildApprovedTask,
  dateValue,
  dismissEmailReview,
  fetchEmailReviews,
  resolveReviewApiUrl,
  sendReviewAction,
  validateApprovedTask
} from "../approvals";
import { htmlResponse, jsonResponse, mockFetch, textStatus } from "./helpers";
import { loadOriginalApprovals, originalAvailable, plain } from "./originalHarness";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const API = "https://example.test/api/email-reviews";

// SYNTHETIC queue
const queue = {
  reviews: [
    { id: "r1", sender: "Sender One", senderEmail: "one@example.test", receivedAt: "2026-05-01T10:00:00Z", subject: "S1", excerpt: "E1", emailUrl: "https://example.test/m/1", task: { name: "T1", projectId: "p1", status: "TO DO", members: ["Max"], start: "2026-05-03", end: "", info: "", confidence: 0.8 } },
    { id: "r2", receivedAt: "2026-06-01T10:00:00Z", subject: "S2" },
    { id: "r3", subject: "S3" },
    { notAnId: true }
  ],
  choices: { projects: [{ value: "p1", label: "Project 1" }], statuses: [{ value: "TO DO", label: "TO DO" }], members: [{ value: "Max", label: "Max" }] }
};

describe("resolveReviewApiUrl", () => {
  it("uses the Vercel API on github.io and the local route elsewhere", () => {
    expect(resolveReviewApiUrl("giorgioassenza-collab.github.io")).toBe(EMAIL_REVIEWS_REMOTE_URL);
    expect(EMAIL_REVIEWS_REMOTE_URL).toBe("https://otacos-workflow.vercel.app/api/email-reviews");
    expect(resolveReviewApiUrl("localhost")).toBe(EMAIL_REVIEWS_LOCAL_PATH);
    expect(resolveReviewApiUrl("otacos-workflow.vercel.app")).toBe("/api/email-reviews");
  });
});

describe("fetchEmailReviews", () => {
  it("GETs with no-store, sorts newest first and drops malformed entries", async () => {
    const calls = mockFetch(() => jsonResponse(queue));
    const result = await fetchEmailReviews({ apiUrl: API });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(API);
    expect(calls[0].init?.cache).toBe("no-store");
    expect(calls[0].init?.method).toBeUndefined();
    expect(result.reviews.map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    expect(result.choices.projects).toEqual([{ value: "p1", label: "Project 1" }]);
  });

  it("defaults missing reviews/choices to empty lists", async () => {
    mockFetch(() => jsonResponse({}));
    expect(await fetchEmailReviews({ apiUrl: API })).toEqual({ reviews: [], choices: { projects: [], statuses: [], members: [] } });
  });

  it("surfaces the server's error message, with a fallback", async () => {
    mockFetch(() => jsonResponse({ error: "Not allowed" }, 403));
    await expect(fetchEmailReviews({ apiUrl: API })).rejects.toMatchObject({ kind: "http", status: 403, message: "Not allowed" });
    mockFetch(() => textStatus(500, "oops"));
    await expect(fetchEmailReviews({ apiUrl: API })).rejects.toMatchObject({ kind: "http", status: 500, message: "Queue unavailable" });
  });

  it("rejects a 2xx answer that is not JSON (e.g. an HTML page) instead of showing an empty queue", async () => {
    mockFetch(() => htmlResponse(200));
    await expect(fetchEmailReviews({ apiUrl: API })).rejects.toMatchObject({ kind: "invalid-response" });
    mockFetch(() => new Response("[]", { status: 200 }));
    await expect(fetchEmailReviews({ apiUrl: API })).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("maps network failure, timeout and abort to ApprovalsError kinds", async () => {
    mockFetch(() => new TypeError("Failed to fetch"));
    const error = await fetchEmailReviews({ apiUrl: API }).catch((e) => e);
    expect(error).toBeInstanceOf(ApprovalsError);
    expect(error).toMatchObject({ kind: "network", message: "Cannot reach the approvals service" });

    vi.useFakeTimers();
    mockFetch(() => "hang");
    const pending = fetchEmailReviews({ apiUrl: API, timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    vi.useRealTimers();

    const controller = new AbortController();
    mockFetch(() => "hang");
    const aborted = fetchEmailReviews({ apiUrl: API, signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("approve / dismiss", () => {
  const task = buildApprovedTask({ name: " Shoot ", projectId: "p1", status: "TO DO", members: "Max, , Giorgia ", start: "2026-05-03", end: "bad", info: " note " });

  it("POSTs JSON {action, reviewId, task} with the content-type header", async () => {
    const calls = mockFetch(() => jsonResponse({ ok: true }));
    const result = await approveEmailReview("r1", task, { apiUrl: API });
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe(API);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      action: "approve",
      reviewId: "r1",
      task: { name: "Shoot", projectId: "p1", status: "TO DO", members: ["Max", "Giorgia"], start: "2026-05-03", end: "", info: "note" }
    });
  });

  it("dismiss sends action 'reject' and no task key", async () => {
    const calls = mockFetch(() => jsonResponse({ ok: true }));
    await dismissEmailReview("r9", { apiUrl: API });
    expect(String(calls[0].init?.body)).toBe(JSON.stringify({ action: "reject", reviewId: "r9" }));
  });

  it("treats an empty 2xx body as success", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    expect(await sendReviewAction({ action: "reject", reviewId: "r1" }, { apiUrl: API })).toEqual({});
  });

  it("rejects a non-JSON 2xx body, reports HTTP errors with the server message", async () => {
    mockFetch(() => htmlResponse(200));
    await expect(dismissEmailReview("r1", { apiUrl: API })).rejects.toMatchObject({ kind: "invalid-response" });
    mockFetch(() => jsonResponse({ error: "Review already handled" }, 409));
    await expect(dismissEmailReview("r1", { apiUrl: API })).rejects.toMatchObject({ kind: "http", status: 409, message: "Review already handled" });
    mockFetch(() => textStatus(502, "<html>bad gateway</html>"));
    await expect(approveEmailReview("r1", task, { apiUrl: API })).rejects.toMatchObject({ kind: "http", status: 502, message: "Something went wrong" });
  });

  it("reports network errors", async () => {
    mockFetch(() => new TypeError("Failed to fetch"));
    await expect(dismissEmailReview("r1", { apiUrl: API })).rejects.toMatchObject({ kind: "network" });
  });

  it("uses the host-based URL when none is given", async () => {
    const calls = mockFetch(() => jsonResponse({}));
    await dismissEmailReview("r1");
    expect(calls[0].url).toBe(resolveReviewApiUrl());
  });
});

describe("form helpers", () => {
  it("dateValue keeps only YYYY-MM-DD", () => {
    expect(dateValue("2026-05-03")).toBe("2026-05-03");
    expect(dateValue("03/05/2026")).toBe("");
    expect(dateValue(undefined)).toBe("");
  });

  it("validateApprovedTask returns the original prompts in order", () => {
    const base = buildApprovedTask({ name: "x", projectId: "p", start: "2026-01-01" });
    expect(validateApprovedTask(base)).toBeNull();
    expect(validateApprovedTask({ ...base, name: "" })).toBe("Give the task a title");
    expect(validateApprovedTask({ ...base, projectId: "" })).toBe("Pick a project before adding the task");
    expect(validateApprovedTask({ ...base, start: "" })).toBe("Pick a date before adding the task");
    expect(validateApprovedTask({ ...base, name: "", projectId: "", start: "" })).toBe("Give the task a title");
  });
});

// ---------------------------------------------------------------------------
// Differential against the original email-review.js functions

describe.skipIf(!originalAvailable)("approvals port vs original email-review.js", () => {
  it("sends the same request as the original sendAction", async () => {
    const originalCalls: Array<{ url: string; init: unknown }> = [];
    const original = loadOriginalApprovals(async (url, init) => {
      originalCalls.push({ url, init });
      return jsonResponse({ ok: true });
    }, API);
    const task = { name: "Shoot", projectId: "p1", status: "TO DO", members: ["Max"], start: "2026-05-03", end: "", info: "n" };
    await original.sendAction("approve", "r1", task);
    await original.sendAction("reject", "r2", undefined);

    const portCalls = mockFetch(() => jsonResponse({ ok: true }));
    await approveEmailReview("r1", task, { apiUrl: API });
    await dismissEmailReview("r2", { apiUrl: API });

    for (let index = 0; index < 2; index += 1) {
      const o = plain(originalCalls[index]);
      expect(portCalls[index].url).toBe(o.url);
      const oi = o.init as { method: string; headers: unknown; body: string };
      expect(portCalls[index].init?.method).toBe(oi.method);
      expect(portCalls[index].init?.headers).toEqual(oi.headers);
      expect(portCalls[index].init?.body).toBe(oi.body);
    }
  });

  it("lists and sorts like the original refreshReviews", async () => {
    const original = loadOriginalApprovals(async () => jsonResponse(queue), API);
    await original.refreshReviews();
    const originalState = plain(original.state());
    const result = await (async () => { mockFetch(() => jsonResponse(queue)); return fetchEmailReviews({ apiUrl: API }); })();
    // the original keeps malformed entries; ids of the well-formed ones must come out in the same order
    const originalIds = (originalState.reviews as Array<{ id?: string }>).map((r) => r.id).filter(Boolean);
    expect(result.reviews.map((r) => r.id)).toEqual(originalIds);
    expect(plain(result.choices)).toEqual(originalState.cachedChoices);
  });

  it("builds the same approve payload as valuesFromCard", () => {
    const original = loadOriginalApprovals(async () => jsonResponse({}), API);
    const forms = [
      { name: " Shoot ", projectId: "p1", status: "TO DO", members: "Max, , Giorgia ", start: "2026-05-03", end: "bad", info: " note " },
      { name: "", projectId: "", status: "", members: "", start: "", end: "", info: "" },
      { name: "N", projectId: "p", status: "s", members: "A,B,,C", start: "2026-1-1", end: "2026-12-31", info: "multi\nline" }
    ];
    for (const form of forms) {
      const card = { querySelector: (selector: string) => ({ value: (form as Record<string, string>)[/data-field="(\w+)"/.exec(selector)![1]] }) };
      expect(buildApprovedTask(form)).toEqual(plain(original.valuesFromCard(card)));
    }
  });
});
