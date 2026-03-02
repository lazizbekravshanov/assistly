/* ── Assistly Settings Controller ── */

const $ = (sel) => document.querySelector(sel);

let state = {};
let blocklist = [];

/* ── Init ── */

document.addEventListener("DOMContentLoaded", async () => {
  const res = await chrome.runtime.sendMessage({ type: "getState" });
  state = res.state;
  blocklist = res.blocklist;

  applyTheme(state.theme);
  renderSiteList();
  renderCleanup();
});

/* ── Theme ── */

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  $("#themeToggle").textContent = theme === "dark" ? "☀️" : "🌙";
}

$("#themeToggle").addEventListener("click", async () => {
  const newTheme = state.theme === "dark" ? "light" : "dark";
  state.theme = newTheme;
  applyTheme(newTheme);
  await chrome.runtime.sendMessage({
    type: "updateSettings",
    settings: { theme: newTheme }
  });
});

/* ── Blocked Sites ── */

function renderSiteList() {
  const container = $("#siteList");
  container.innerHTML = "";

  const activeCount = blocklist.filter((s) => s.enabled).length;
  $("#activeBadge").textContent = `${activeCount} active`;

  blocklist.forEach((site, i) => {
    const row = document.createElement("div");
    row.className = "site-row" + (site.enabled ? " active" : "");

    const emoji = document.createElement("span");
    emoji.className = "site-emoji";
    emoji.textContent = site.enabled ? "🚫" : "⭕";

    const domain = document.createElement("span");
    domain.className = "site-domain";
    domain.textContent = site.domain;

    const remove = document.createElement("button");
    remove.className = "site-remove";
    remove.textContent = "✕";
    remove.addEventListener("click", () => removeSite(i));

    const toggle = document.createElement("label");
    toggle.className = "toggle site-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = site.enabled;
    input.addEventListener("change", () => toggleSite(i));
    const slider = document.createElement("span");
    slider.className = "toggle-slider";
    toggle.appendChild(input);
    toggle.appendChild(slider);

    row.appendChild(emoji);
    row.appendChild(domain);
    row.appendChild(remove);
    row.appendChild(toggle);
    container.appendChild(row);
  });
}

async function addSite() {
  let domain = $("#siteInput").value.trim();
  if (!domain) return;

  // Clean up input
  domain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();

  if (!domain || domain.length < 3) return;

  // Check for duplicates
  if (blocklist.some((s) => s.domain === domain)) {
    $("#siteInput").value = "";
    return;
  }

  blocklist.push({ domain, enabled: true });
  await saveBlocklist();
  $("#siteInput").value = "";
  renderSiteList();
}

async function removeSite(index) {
  blocklist.splice(index, 1);
  await saveBlocklist();
  renderSiteList();
}

async function toggleSite(index) {
  blocklist[index].enabled = !blocklist[index].enabled;
  await saveBlocklist();
  renderSiteList();
}

async function saveBlocklist() {
  await chrome.runtime.sendMessage({
    type: "updateBlocklist",
    blocklist: blocklist
  });
}

$("#addBtn").addEventListener("click", addSite);
$("#siteInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addSite();
});

/* ── Page Cleanup ── */

function renderCleanup() {
  $("#cleanupToggle").checked = state.cleanupEnabled;
  updateCleanupTags();
}

$("#cleanupToggle").addEventListener("change", async () => {
  state.cleanupEnabled = $("#cleanupToggle").checked;
  await chrome.runtime.sendMessage({
    type: "updateSettings",
    settings: { cleanupEnabled: state.cleanupEnabled }
  });
  updateCleanupTags();
});

function updateCleanupTags() {
  const tags = $("#cleanupTags");
  tags.classList.toggle("disabled", !state.cleanupEnabled);
}

/* ── Reset Stats ── */

$("#resetBtn").addEventListener("click", () => {
  $("#confirmOverlay").classList.remove("hidden");
});

$("#confirmCancel").addEventListener("click", () => {
  $("#confirmOverlay").classList.add("hidden");
});

$("#confirmReset").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "resetStats" });
  $("#confirmOverlay").classList.add("hidden");
});

// Close overlay on backdrop click
$("#confirmOverlay").addEventListener("click", (e) => {
  if (e.target === $("#confirmOverlay")) {
    $("#confirmOverlay").classList.add("hidden");
  }
});
