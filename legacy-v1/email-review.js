const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const dateValue = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : "";
let reviews = [];
let cachedChoices = { projects: [], statuses: [], members: [] };
let expandedReviewId = "";
const reviewApiUrl = location.hostname.endsWith("github.io")
  ? "https://otacos-workflow.vercel.app/api/email-reviews"
  : "/api/email-reviews";

function installSurface() {
  const historyButton = document.getElementById("historyButton");
  if (!historyButton || document.getElementById("emailReviewButton")) return;
  const button = document.createElement("button");
  button.className = "toolbar-btn email-review-button";
  button.id = "emailReviewButton";
  button.type = "button";
  button.innerHTML = `Tasks to approve <span class="email-review-count" id="emailReviewCount" hidden>0</span>`;
  historyButton.before(button);

  const modal = document.createElement("div");
  modal.className = "email-review-modal";
  modal.id = "emailReviewModal";
  modal.setAttribute("aria-label", "Tasks to approve");
  modal.innerHTML = `
    <section class="email-review-dialog" role="dialog" aria-modal="true" aria-labelledby="emailReviewTitle">
      <header class="email-review-head">
        <div>
          <h2 id="emailReviewTitle">Tasks to approve</h2>
          <p>Open the proposal you want to check, then approve or dismiss it.</p>
        </div>
        <button type="button" data-email-close aria-label="Close">Close</button>
      </header>
      <div class="email-review-list" id="emailReviewList"></div>
    </section>`;
  document.body.appendChild(modal);

  button.addEventListener("click", () => modal.classList.add("open"));
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-email-close]")) modal.classList.remove("open");
  });
  modal.querySelector("#emailReviewList").addEventListener("click", handleAction);
}

function options(items, selected, placeholder) {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...items.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
  ].join("");
}

function expandedCard(review) {
  const task = review.task || {};
  return `
    <div class="email-review-detail">
      <p class="email-review-source">${escapeHtml(review.excerpt || "")}</p>
      <div class="email-review-fields">
        <label class="email-review-wide">Task<input data-field="name" value="${escapeHtml(task.name || "")}"></label>
        <label>Project<select data-field="projectId">${options(cachedChoices.projects, task.projectId || "", "Unassigned")}</select></label>
        <label>Status<select data-field="status">${options(cachedChoices.statuses, task.status || "", "Unassigned")}</select></label>
        <label>Who<input data-field="members" value="${escapeHtml((task.members || []).join(", "))}" placeholder="Names, separated by commas"></label>
        <label>Start<input data-field="start" type="date" value="${escapeHtml(dateValue(task.start))}"></label>
        <label>End<input data-field="end" type="date" value="${escapeHtml(dateValue(task.end))}"></label>
        <label class="email-review-wide">Notes<textarea data-field="info">${escapeHtml(task.info || "")}</textarea></label>
      </div>
      <div class="email-review-actions">
        <button class="approve" type="button" data-email-action="approve">Approve and add</button>
        ${review.emailUrl ? `<a href="${escapeHtml(review.emailUrl)}" target="_blank" rel="noopener">Open email</a>` : ""}
      </div>
    </div>`;
}

function render() {
  const list = document.getElementById("emailReviewList");
  const badge = document.getElementById("emailReviewCount");
  if (!list || !badge) return;
  badge.textContent = String(reviews.length);
  badge.hidden = reviews.length === 0;
  if (!reviews.length) {
    list.innerHTML = `<div class="email-review-empty"><strong>No proposals waiting.</strong><br>Emails are checked automatically every hour.</div>`;
    return;
  }
  list.innerHTML = reviews.map((review) => {
    const task = review.task || {};
    const received = review.receivedAt ? new Date(review.receivedAt).toLocaleString("it-IT") : "";
    const expanded = review.id === expandedReviewId;
    return `
      <article class="email-review-card${expanded ? " expanded" : ""}" data-review-id="${escapeHtml(review.id)}">
        <div class="email-review-summary">
          <div class="email-review-summary-copy">
            <div class="email-review-meta">
              <span class="email-review-status">To approve</span>
              <span>${escapeHtml(review.sender || review.senderEmail)}</span>
              <span>${escapeHtml(received)}</span>
              <span class="email-review-confidence">${Math.round(Number(task.confidence || 0) * 100)}% confidence</span>
            </div>
            <h3>${escapeHtml(task.name || review.subject || "Email without subject")}</h3>
            <p>${escapeHtml(review.subject || "Email without subject")}</p>
          </div>
          <div class="email-review-quick-actions">
            <button type="button" data-email-action="toggle" aria-expanded="${expanded}">${expanded ? "Close" : "Apri"}</button>
            <button type="button" data-email-action="reject">Dismiss</button>
          </div>
        </div>
        ${expanded ? expandedCard(review) : ""}
      </article>`;
  }).join("");
}

function valuesFromCard(card) {
  const value = (field) => card.querySelector(`[data-field="${field}"]`)?.value?.trim() || "";
  return {
    name: value("name"),
    projectId: value("projectId"),
    status: value("status"),
    members: value("members").split(",").map((item) => item.trim()).filter(Boolean),
    start: dateValue(value("start")),
    end: dateValue(value("end")),
    info: value("info")
  };
}

async function sendAction(action, reviewId, task) {
  const response = await fetch(reviewApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, reviewId, task })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong");
}

async function refreshReviews() {
  const response = await fetch(reviewApiUrl, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Queue unavailable");
  reviews = (payload.reviews || []).sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  cachedChoices = payload.choices || cachedChoices;
  if (expandedReviewId && !reviews.some((item) => item.id === expandedReviewId)) expandedReviewId = "";
  render();
}

async function handleAction(event) {
  const button = event.target.closest("[data-email-action]");
  if (!button) return;
  const card = button.closest("[data-review-id]");
  const review = reviews.find((item) => item.id === card?.dataset.reviewId);
  if (!review) return;
  const action = button.dataset.emailAction;
  if (action === "toggle") {
    expandedReviewId = expandedReviewId === review.id ? "" : review.id;
    render();
    return;
  }
  const task = action === "approve" ? valuesFromCard(card) : undefined;
  if (action === "approve") {
    if (!task.name) return alert("Give the task a title");
    if (!task.projectId) return alert("Pick a project before adding the task");
    if (!task.start) return alert("Pick a date before adding the task");
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = action === "reject" ? "Removing…" : "Adding…";
  card.classList.add("busy");
  try {
    await sendAction(action, review.id, task);
    reviews = reviews.filter((item) => item.id !== review.id);
    if (expandedReviewId === review.id) expandedReviewId = "";
    render();
  } catch (error) {
    alert(error?.message || "Something went wrong");
    button.disabled = false;
    button.textContent = originalText;
    card.classList.remove("busy");
  }
}

async function start() {
  installSurface();
  await refreshReviews();
  window.setInterval(() => refreshReviews().catch(console.error), 60000);
}

start().catch(console.error);
