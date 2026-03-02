/* ── Assistly — Background Service Worker ── */

const DEFAULT_STATE = {
  focusActive: false,
  focusStartTime: null,
  cleanupEnabled: true,
  theme: "light",
  breakActive: false,
  breakEndTime: null,
  pomodoroTime: 1500,
  pomodoroRunning: false,
  pomodoroEndTime: null
};

const DEFAULT_BLOCKLIST = [
  { domain: "twitter.com", enabled: true },
  { domain: "x.com", enabled: true },
  { domain: "instagram.com", enabled: true },
  { domain: "reddit.com", enabled: true },
  { domain: "tiktok.com", enabled: true },
  { domain: "youtube.com", enabled: true },
  { domain: "facebook.com", enabled: true },
  { domain: "snapchat.com", enabled: true },
  { domain: "twitch.tv", enabled: false },
  { domain: "netflix.com", enabled: false }
];

const DEFAULT_STATS = {
  dailyFocus: {},
  dailyBlocked: {},
  blockedSites: {},
  currentStreak: 0,
  lastFocusDate: null
};

/* ── Helpers ── */

function today() {
  return new Date().toISOString().split("T")[0];
}

function stripDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainMatches(hostname, blocked) {
  return hostname === blocked || hostname.endsWith("." + blocked);
}

function isBlockedUrl(url) {
  if (!url) return false;
  if (
    url.startsWith("chrome://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://")
  ) return false;
  return true;
}

/* ── Initialization ── */

chrome.runtime.onInstalled.addListener(async () => {
  const { state } = await chrome.storage.local.get("state");
  if (!state) {
    await chrome.storage.local.set({
      state: DEFAULT_STATE,
      blocklist: DEFAULT_BLOCKLIST,
      stats: DEFAULT_STATS
    });
  }
});

/* ── Site Blocking ── */

async function checkAndBlock(tabId, url) {
  if (!isBlockedUrl(url)) return;

  const { state, blocklist } = await chrome.storage.local.get(["state", "blocklist"]);
  if (!state || !state.focusActive || state.breakActive) return;
  if (!blocklist) return;

  const hostname = stripDomain(url);
  if (!hostname) return;

  for (const site of blocklist) {
    if (site.enabled && domainMatches(hostname, site.domain)) {
      // Increment blocked count
      const { stats } = await chrome.storage.local.get("stats");
      const s = stats || DEFAULT_STATS;
      const d = today();
      s.dailyBlocked[d] = (s.dailyBlocked[d] || 0) + 1;
      s.blockedSites[site.domain] = (s.blockedSites[site.domain] || 0) + 1;
      await chrome.storage.local.set({ stats: s });

      // Redirect to blocked page
      const blockedUrl = chrome.runtime.getURL(
        `pages/blocked.html?site=${encodeURIComponent(site.domain)}`
      );
      chrome.tabs.update(tabId, { url: blockedUrl });
      return;
    }
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkAndBlock(tabId, changeInfo.url);
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    checkAndBlock(details.tabId, details.url);
  }
});

/* ── Focus Time Tracking ── */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "focusTick") {
    const { state, stats } = await chrome.storage.local.get(["state", "stats"]);
    if (!state || !state.focusActive) return;
    const s = stats || DEFAULT_STATS;
    const d = today();
    s.dailyFocus[d] = (s.dailyFocus[d] || 0) + 1;
    await chrome.storage.local.set({ stats: s });
  }

  if (alarm.name === "breakEnd") {
    const { state } = await chrome.storage.local.get("state");
    if (!state) return;
    state.breakActive = false;
    state.breakEndTime = null;
    await chrome.storage.local.set({ state });

    // Notify popup and pages
    chrome.runtime.sendMessage({ type: "breakEnded" }).catch(() => {});
  }

  if (alarm.name === "pomodoroEnd") {
    const { state } = await chrome.storage.local.get("state");
    if (!state) return;
    state.pomodoroRunning = false;
    state.pomodoroEndTime = null;
    await chrome.storage.local.set({ state });

    // Send notification
    chrome.notifications.create("pomodoroDone", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "Pomodoro Complete!",
      message: "Great work! Take a break or start another session.",
      priority: 2
    });

    chrome.runtime.sendMessage({ type: "pomodoroEnded" }).catch(() => {});
  }
});

/* ── Badge ── */

async function updateBadge(focusActive) {
  if (focusActive) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#5856d6" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

/* ── Streak Logic ── */

function updateStreak(stats) {
  const d = today();
  if (stats.lastFocusDate === d) return; // Already counted today

  const last = stats.lastFocusDate;
  if (last) {
    const lastDate = new Date(last);
    const todayDate = new Date(d);
    const diffDays = Math.floor(
      (todayDate - lastDate) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 1) {
      stats.currentStreak += 1;
    } else if (diffDays > 1) {
      stats.currentStreak = 1;
    }
  } else {
    stats.currentStreak = 1;
  }
  stats.lastFocusDate = d;
}

/* ── Message Handler ── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err) => {
    console.error("Message handler error:", err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async
});

async function handleMessage(msg) {
  const { state, blocklist, stats } = await chrome.storage.local.get([
    "state",
    "blocklist",
    "stats"
  ]);
  const s = state || DEFAULT_STATE;
  const bl = blocklist || DEFAULT_BLOCKLIST;
  const st = stats || DEFAULT_STATS;

  switch (msg.type) {
    case "getState":
      return { state: s, blocklist: bl, stats: st };

    case "toggleFocus": {
      s.focusActive = !s.focusActive;
      if (s.focusActive) {
        s.focusStartTime = Date.now();
        chrome.alarms.create("focusTick", { periodInMinutes: 1 });
        updateStreak(st);
        await chrome.storage.local.set({ stats: st });
      } else {
        s.focusStartTime = null;
        s.breakActive = false;
        s.breakEndTime = null;
        chrome.alarms.clear("focusTick");
        chrome.alarms.clear("breakEnd");
      }
      await chrome.storage.local.set({ state: s });
      updateBadge(s.focusActive);
      return { state: s, stats: st };
    }

    case "startBreak": {
      s.breakActive = true;
      s.breakEndTime = Date.now() + 300000; // 5 minutes
      chrome.alarms.create("breakEnd", { delayInMinutes: 5 });
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "endBreak": {
      s.breakActive = false;
      s.breakEndTime = null;
      chrome.alarms.clear("breakEnd");
      await chrome.storage.local.set({ state: s });
      chrome.runtime.sendMessage({ type: "breakEnded" }).catch(() => {});
      return { state: s };
    }

    case "updateBlocklist": {
      await chrome.storage.local.set({ blocklist: msg.blocklist });
      return { blocklist: msg.blocklist };
    }

    case "updateSettings": {
      Object.assign(s, msg.settings);
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "startPomodoro": {
      s.pomodoroRunning = true;
      s.pomodoroEndTime = Date.now() + s.pomodoroTime * 1000;
      chrome.alarms.create("pomodoroEnd", {
        delayInMinutes: s.pomodoroTime / 60
      });
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "stopPomodoro": {
      s.pomodoroRunning = false;
      s.pomodoroEndTime = null;
      chrome.alarms.clear("pomodoroEnd");
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "resetStats": {
      const fresh = { ...DEFAULT_STATS };
      await chrome.storage.local.set({ stats: fresh });
      return { stats: fresh };
    }

    default:
      return { error: "Unknown message type" };
  }
}

/* ── Startup: restore badge state ── */

(async () => {
  const { state } = await chrome.storage.local.get("state");
  if (state && state.focusActive) {
    updateBadge(true);
    // Re-register focus tick alarm
    chrome.alarms.create("focusTick", { periodInMinutes: 1 });
  }
})();
