/* ── derot Dashboard Controller ── */

const $ = (sel) => document.querySelector(sel);

let state = {};
let stats = {};

/* ── Init ── */

document.addEventListener("DOMContentLoaded", async () => {
  const res = await chrome.runtime.sendMessage({ type: "getState" });
  state = res.state;
  stats = res.stats;

  applyTheme(state.theme);
  renderStatsRow();
  renderChart();
  renderBlockedSites();
  renderMilestones();
  renderGoalRate();
  renderChallenges();
  renderCalendar();
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

/* ── Helpers ── */

function today() {
  return new Date().toISOString().split("T")[0];
}

function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

function formatMinutes(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function getDayLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 3);
}

/* ── Stats Row ── */

function renderStatsRow() {
  const days = getLast7Days();

  // Total focus this week
  let totalFocus = 0;
  let totalBlocked = 0;
  let daysWithFocus = 0;

  for (const d of days) {
    const f = stats.dailyFocus?.[d] || 0;
    totalFocus += f;
    totalBlocked += stats.dailyBlocked?.[d] || 0;
    if (f > 0) daysWithFocus++;
  }

  const avgSession = daysWithFocus > 0 ? Math.round(totalFocus / daysWithFocus) : 0;

  $("#totalFocus").textContent = formatMinutes(totalFocus);
  $("#totalBlocked").textContent = totalBlocked;
  $("#streak").textContent = stats.currentStreak || 0;
  $("#avgSession").textContent = formatMinutes(avgSession);
}

/* ── Weekly Chart ── */

function renderChart() {
  const days = getLast7Days();
  const container = $("#chart");
  container.innerHTML = "";

  // Find max for scaling
  const values = days.map((d) => stats.dailyFocus?.[d] || 0);
  const max = Math.max(...values, 1);

  days.forEach((d, i) => {
    const mins = values[i];
    const pct = Math.max(2, (mins / max) * 100);
    const isToday = d === today();

    const col = document.createElement("div");
    col.className = "chart-col";

    const value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = formatMinutes(mins);

    const bar = document.createElement("div");
    bar.className = "chart-bar" + (isToday ? " today" : "");
    bar.style.height = "0%";

    const day = document.createElement("span");
    day.className = "chart-day";
    day.textContent = getDayLabel(d);

    col.appendChild(value);
    col.appendChild(bar);
    col.appendChild(day);
    container.appendChild(col);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.style.height = pct + "%";
      });
    });
  });
}

/* ── Most Blocked Sites ── */

function renderBlockedSites() {
  const container = $("#blockedList");
  container.innerHTML = "";

  const sites = Object.entries(stats.blockedSites || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sites.length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-muted);padding:8px 0">No blocked sites yet. Start a focus session!</p>';
    return;
  }

  const max = sites[0][1];

  sites.forEach(([domain, count]) => {
    const row = document.createElement("div");
    row.className = "blocked-row";

    const name = document.createElement("span");
    name.className = "blocked-domain";
    name.textContent = domain;

    const barWrap = document.createElement("div");
    barWrap.className = "blocked-bar-wrap";

    const bar = document.createElement("div");
    bar.className = "blocked-bar";
    bar.style.width = Math.max(4, (count / max) * 100) + "%";

    barWrap.appendChild(bar);

    const num = document.createElement("span");
    num.className = "blocked-count";
    num.textContent = count;

    row.appendChild(name);
    row.appendChild(barWrap);
    row.appendChild(num);
    container.appendChild(row);
  });
}

/* ── Streak Calendar ── */

function renderCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayStr = today();

  // Update title
  const monthName = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  $("#calendarTitle").textContent = monthName;

  const container = $("#calendar");
  container.innerHTML = "";

  // Day headers (Monday start)
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  dayLabels.forEach((d) => {
    const el = document.createElement("div");
    el.className = "cal-header";
    el.textContent = d;
    container.appendChild(el);
  });

  // First day of month (adjust to Monday=0)
  const firstDay = new Date(year, month, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1; // Monday=0

  // Days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Empty cells
  for (let i = 0; i < offset; i++) {
    const el = document.createElement("div");
    el.className = "cal-day empty";
    container.appendChild(el);
  }

  // Day cells — 4-level intensity shading
  const monthValues = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    monthValues.push(stats.dailyFocus?.[dateStr] || 0);
  }
  const maxFocus = Math.max(...monthValues, 1);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const mins = monthValues[d - 1];
    const isToday = dateStr === todayStr;

    const el = document.createElement("div");
    el.className = "cal-day";
    if (isToday) {
      el.classList.add("today");
    } else if (mins > 0) {
      const level = Math.min(4, Math.ceil((mins / maxFocus) * 4));
      el.classList.add(`focus-${level}`);
    }
    el.textContent = d;
    container.appendChild(el);
  }
}

/* ── Milestones ── */

const MILESTONE_LABELS = {
  3: "3-Day Spark", 7: "Week Warrior", 14: "Fortnight Focus",
  30: "Monthly Master", 60: "60-Day Legend", 100: "Centurion"
};
const ALL_MILESTONES = [3, 7, 14, 30, 60, 100];

function renderMilestones() {
  const container = $("#milestoneBadges");
  container.innerHTML = "";
  const earned = stats.milestones || [];
  for (const m of ALL_MILESTONES) {
    const el = document.createElement("div");
    el.className = "milestone-badge" + (earned.includes(m) ? " earned" : "");
    el.innerHTML = `<span class="mb-icon">${earned.includes(m) ? "🏆" : "🔒"}</span><span class="mb-label">${MILESTONE_LABELS[m]}</span>`;
    container.appendChild(el);
  }
}

/* ── Goal Completion Rate ── */

function renderGoalRate() {
  const days = getLast7Days();
  const goal = state.focusGoal || 120;
  let met = 0;
  for (const d of days) {
    if ((stats.dailyFocus?.[d] || 0) >= goal) met++;
  }
  const pct = Math.round((met / 7) * 100);
  $("#goalRate").textContent = `${pct}%`;
}

/* ── Weekly Challenges ── */

async function renderChallenges() {
  const { challenges } = await chrome.storage.local.get("challenges");
  const container = $("#challengeCards");
  container.innerHTML = "";

  if (!challenges || !challenges.active || challenges.active.length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">No active challenges yet. Check back Monday!</p>';
  } else {
    for (const ch of challenges.active) {
      const card = document.createElement("div");
      card.className = "challenge-card" + (ch.completed ? " completed" : "");
      const pct = Math.min(100, Math.round((ch.progress / ch.target) * 100));
      card.innerHTML = `
        <div class="ch-header">
          <span class="ch-name">${ch.completed ? "✅" : "🎯"} ${ch.name}</span>
          <span class="ch-xp">+${ch.xp} XP</span>
        </div>
        <span class="ch-desc">${ch.description}</span>
        <div class="ch-bar-wrap"><div class="ch-bar" style="width:${pct}%"></div></div>
        <span class="ch-progress">${ch.progress}/${ch.target}</span>
      `;
      container.appendChild(card);
    }
  }

  // XP + Rank
  const xp = stats.xp || 0;
  const rank = stats.rank || "Apprentice";
  const RANKS = [
    { name: "Apprentice", xp: 0 }, { name: "Scholar", xp: 100 },
    { name: "Adept", xp: 300 }, { name: "Master", xp: 600 },
    { name: "Sage", xp: 1000 }, { name: "Legend", xp: 2000 }
  ];
  let currentIdx = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (xp >= RANKS[i].xp) { currentIdx = i; break; }
  }
  const nextRank = RANKS[currentIdx + 1];
  const pctXp = nextRank ? Math.round(((xp - RANKS[currentIdx].xp) / (nextRank.xp - RANKS[currentIdx].xp)) * 100) : 100;

  $("#xpBar").style.width = pctXp + "%";
  $("#xpLabel").textContent = `${xp} XP`;
  $("#rankDisplay").textContent = rank;
}
