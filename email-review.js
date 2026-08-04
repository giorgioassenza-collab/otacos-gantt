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
  button.innerHTML = `Task da approvare <span class="email-review-count" id="emailReviewCount" hidden>0</span>`;
  historyButton.before(button);

  const modal = document.createElement("div");
  modal.className = "email-review-modal";
  modal.id = "emailReviewModal";
  modal.setAttribute("aria-label", "Task da approvare");
  modal.innerHTML = `
    <section class="email-review-dialog" role="dialog" aria-modal="true" aria-labelledby="emailReviewTitle">
      <header class="email-review-head">
        <div>
          <h2 id="emailReviewTitle">Task da approvare</h2>
          <p>Apri solo la proposta che vuoi controllare, poi approvala oppure ignorala.</p>
        </div>
        <button type="button" data-email-close aria-label="Chiudi">Chiudi</button>
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
        <label>Progetto<select data-field="projectId">${options(cachedChoices.projects, task.projectId || "", "Da assegnare")}</select></label>
        <label>Stato<select data-field="status">${options(cachedChoices.statuses, task.status || "", "Da assegnare")}</select></label>
        <label>Responsabili<input data-field="members" value="${escapeHtml((task.members || []).join(", "))}" placeholder="Nomi separati da virgola"></label>
        <label>Inizio<input data-field="start" type="date" value="${escapeHtml(dateValue(task.start))}"></label>
        <label>Fine<input data-field="end" type="date" value="${escapeHtml(dateValue(task.end))}"></label>
        <label class="email-review-wide">Note<textarea data-field="info">${escapeHtml(task.info || "")}</textarea></label>
      </div>
      <div class="email-review-actions">
        <button class="approve" type="button" data-email-action="approve">Approva e aggiungi</button>
        ${review.emailUrl ? `<a href="${escapeHtml(review.emailUrl)}" target="_blank" rel="noopener">Apri email</a>` : ""}
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
    list.innerHTML = `<div class="email-review-empty"><strong>Nessuna proposta in attesa.</strong><br>Il controllo automatico viene eseguito ogni ora.</div>`;
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
              <span class="email-review-status">Da approvare</span>
              <span>${escapeHtml(review.sender || review.senderEmail)}</span>
              <span>${escapeHtml(received)}</span>
              <span class="email-review-confidence">${Math.round(Number(task.confidence || 0) * 100)}% affidabilità</span>
            </div>
            <h3>${escapeHtml(task.name || review.subject || "Email senza oggetto")}</h3>
            <p>${escapeHtml(review.subject || "Email senza oggetto")}</p>
          </div>
          <div class="email-review-quick-actions">
            <button type="button" data-email-action="toggle" aria-expanded="${expanded}">${expanded ? "Chiudi" : "Apri"}</button>
            <button type="button" data-email-action="reject">Ignora</button>
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
  if (!response.ok) throw new Error(payload.error || "Operazione non riuscita");
}

async function refreshReviews() {
  const response = await fetch(reviewApiUrl, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Coda non disponibile");
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
    if (!task.name) return alert("Inserisci un titolo per la task");
    if (!task.projectId) return alert("Assegna un progetto prima di aggiungere la task");
    if (!task.start) return alert("Assegna una data prima di aggiungere la task");
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = action === "reject" ? "Rimuovo…" : "Aggiungo…";
  card.classList.add("busy");
  try {
    await sendAction(action, review.id, task);
    reviews = reviews.filter((item) => item.id !== review.id);
    if (expandedReviewId === review.id) expandedReviewId = "";
    render();
  } catch (error) {
    alert(error?.message || "Operazione non riuscita");
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
