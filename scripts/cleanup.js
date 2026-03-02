/* ── Assistly Page Cleanup Content Script ── */

(async function () {
  const { state } = await chrome.storage.local.get("state");
  if (!state?.focusActive || !state?.cleanupEnabled) return;

  applyCleanup();

  /* ── Watch for state changes ── */
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.state) return;
    const newState = changes.state.newValue;
    if (newState?.focusActive && newState?.cleanupEnabled) {
      applyCleanup();
    } else {
      removeCleanup();
    }
  });

  function applyCleanup() {
    if (document.documentElement.classList.contains("assistly-cleanup-active")) return;

    document.documentElement.classList.add("assistly-cleanup-active");

    // Build combined selectors
    const selectors = [
      ...getGenericSelectors(),
      ...getSiteSelectors()
    ];

    if (selectors.length === 0) return;

    const style = document.createElement("style");
    style.id = "assistly-cleanup-style";
    style.textContent = selectors.join(",\n") + " { display: none !important; }";
    document.head.appendChild(style);

    // Pause autoplay videos
    pauseAutoplayVideos();
    observeAutoplayVideos();
  }

  function removeCleanup() {
    document.documentElement.classList.remove("assistly-cleanup-active");
    const style = document.getElementById("assistly-cleanup-style");
    if (style) style.remove();
  }

  function getGenericSelectors() {
    return [
      // Ads
      '[id*="ad-"]',
      '[class*="ad-container"]',
      "ins.adsbygoogle",
      '[class*="sponsored"]',
      "[data-ad]",
      // Cookie popups
      '[class*="cookie-banner"]',
      '[class*="cookie-consent"]',
      '[id*="cookie"]',
      '[class*="gdpr"]',
      "#CybotCookiebotDialog",
      '[class*="cc-banner"]',
      // Notification prompts
      '[class*="notification-badge"]',
      '[class*="push-notification"]',
      '[class*="newsletter-popup"]',
      '[class*="subscribe-popup"]',
      // Chat widgets
      '[id*="intercom"]',
      '[class*="drift-"]',
      "#hubspot-messages-iframe-container",
      '[class*="crisp-client"]'
    ];
  }

  function getSiteSelectors() {
    const host = location.hostname.replace(/^www\./, "");
    const siteRules = {
      "youtube.com": [
        "#secondary",
        "ytd-ad-slot-renderer",
        "#related",
        "ytd-promoted-sparkles-web-renderer",
        "#masthead-ad",
        "#guide"
      ],
      "google.com": [
        "#rhs",
        ".commercial-unit-desktop",
        "#tads",
        "#bottomads"
      ],
      "linkedin.com": [
        ".ad-banner-container",
        ".right-rail-card"
      ],
      "stackoverflow.com": [
        "#sidebar",
        ".s-sidebarwidget"
      ],
      "github.com": [
        '[class*="feed-"]',
        ".dashboard-sidebar"
      ]
    };

    for (const [domain, selectors] of Object.entries(siteRules)) {
      if (host === domain || host.endsWith("." + domain)) {
        return selectors;
      }
    }

    return [];
  }

  function pauseAutoplayVideos() {
    document.querySelectorAll("video[autoplay]").forEach((video) => {
      video.pause();
      video.removeAttribute("autoplay");
    });
  }

  function observeAutoplayVideos() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "VIDEO" && node.hasAttribute("autoplay")) {
            node.pause();
            node.removeAttribute("autoplay");
          }
          node.querySelectorAll?.("video[autoplay]").forEach((v) => {
            v.pause();
            v.removeAttribute("autoplay");
          });
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
