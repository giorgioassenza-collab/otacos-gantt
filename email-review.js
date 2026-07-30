const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const dateValue = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : "";
const makeTaskId = () => `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let reviews = [];
let cachedChoices = { projects: [], statuses: [], members: [] };
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
          <p>Proposte rilevate dalle email. Puoi correggerle, approvarle oppure ignorarle.</p>
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

async function boardChoices() {
  return cachedChoices;
}

async function render() {
  const list = document.getElementById("emailReviewList");
  const badge = document.getElementById("emailReviewCount");
  if (!list || !badge) return;
  badge.textContent = String(reviews.length);
  badge.hidden = reviews.length === 0;
  if (!reviews.length) {
    list.innerHTML = `<div class="email-review-empty"><strong>Nessuna proposta in attesa.</strong><br>Il controllo automatico viene eseguito ogni ora.</div>`;
    return;
  }
  const choices = await boardChoices();
  list.innerHTML = reviews.map((review) => {
    const task = review.task || {};
    const received = review.receivedAt ? new Date(review.receivedAt).toLocaleString("it-IT") : "";
    return `
      <article class="email-review-card" data-review-id="${escapeHtml(review.id)}">
        <div class="email-review-status">Da approvare</div>
        <div class="email-review-meta">
          <span>${escapeHtml(review.sender || review.senderEmail)}</span>
          <span>${escapeHtml(received)}</span>
          <span class="email-review-confidence">${Math.round(Number(task.confidence || 0) * 100)}% affidabilità</span>
        </div>
        <h3>${escapeHtml(review.subject || "Email senza oggetto")}</h3>
        <p class="email-review-source">${escapeHtml(review.excerpt || "")}</p>
        <div class="email-review-fields">
          <label class="email-review-wide">Task<input data-field="name" value="${escapeHtml(task.name || "")}"></label>
          <label>Progetto<select data-field="projectId">${options(choices.projects, task.projectId || "", "Da assegnare")}</select></label>
          <label>Stato<select data-field="status">${options(choices.statuses, task.status || "", "Da assegnare")}</select></label>
          <label>Responsabili<input data-field="members" value="${escapeHtml((task.members || []).join(", "))}" placeholder="Nomi separati da virgola"></label>
          <label>Inizio<input data-field="start" type="date" value="${escapeHtml(dateValue(task.start))}"></label>
          <label>Fine<input data-field="end" type="date" value="${escapeHtml(dateValue(task.end))}"></label>
          <label class="email-review-wide">Note<textarea data-field="info">${escapeHtml(task.info || "")}</textarea></label>
        </div>
        <div class="email-review-actions">
          <button class="approve" type="button" data-email-action="approve">Approva e aggiungi</button>
          <button type="button" data-email-action="reject">Ignora</button>
          ${review.emailUrl ? `<a href="${escapeHtml(review.emailUrl)}" target="_blank" rel="noopener">Apri email</a>` : ""}
        </div>
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

async function approve(review, task) {
  if (!task.name) throw new Error("Inserisci un titolo per la task");
  if (!task.projectId) throw new Error("Assegna un progetto prima di aggiungere la task");
  if (!task.start) throw new Error("Assegna una data prima di aggiungere la task");
  await sendAction("approve", review.id, task);
}

async function reject(review) {
  await sendAction("reject", review.id);
}

async function sendAction(action, reviewId, task) {
  const response = await fetch(reviewApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, reviewId, task })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Operazione non riuscita");
  await refreshReviews();
}

async function refreshReviews() {
  const response = await fetch(reviewApiUrl, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Coda non disponibile");
  reviews = (payload.reviews || [])
    .sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  cachedChoices = payload.choices || cachedChoices;
  await render();
}

async function handleAction(event) {
  const button = event.target.closest("[data-email-action]");
  if (!button) return;
  const card = button.closest("[data-review-id]");
  const review = reviews.find((item) => item.id === card?.dataset.reviewId);
  if (!review) return;
  button.disabled = true;
  try {
    if (button.dataset.emailAction === "approve") await approve(review, valuesFromCard(card));
    if (button.dataset.emailAction === "reject") await reject(review);
  } catch (error) {
    alert(error?.message || "Operazione non riuscita");
    button.disabled = false;
  }
}

async function start() {
  installSurface();
  await refreshReviews();
  window.setInterval(() => refreshReviews().catch(console.error), 60000);
}

start().catch(console.error);
