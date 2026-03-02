<p align="center">
  <img src="icons/icon-128.png" alt="Assistly" width="80" height="80">
</p>

<h1 align="center">Assistly</h1>

<p align="center">
  <strong>Focus & Deep Work — Chrome Extension</strong><br>
  Block distractions. Clean up pages. Stay focused.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/manifest-v3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/dependencies-zero-green" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT License">
</p>

---

## What is Assistly?

Assistly is a Chrome extension built for college students and remote workers who want to enter deep work. It blocks distracting websites during focus sessions, cleans up allowed pages by hiding ads and sidebars, tracks your focus stats over time, and includes a built-in Pomodoro timer.

No accounts. No servers. No dependencies. Everything runs locally in your browser.

---

## Features

### Site Blocking
Toggle focus mode and distracting sites are instantly blocked. Visiting a blocked site redirects you to a mindful page with a breathing circle animation and a **4-7-8 breathing exercise** (inhale 4s, hold 7s, exhale 8s). Pre-loaded with 10 common distractors — fully customizable from settings.

**Default blocklist:** twitter.com, x.com, instagram.com, reddit.com, tiktok.com, youtube.com, facebook.com, snapchat.com, twitch.tv, netflix.com

### Page Cleanup
When focus mode is active, a content script automatically hides distracting elements on allowed pages:
- **Generic:** ads, cookie banners, notification prompts, chat widgets, newsletter popups
- **YouTube:** sidebar, recommendations, ads, guide menu
- **Google:** right sidebar, shopping ads, top/bottom ads
- **LinkedIn:** ad banners, right rail cards
- **Stack Overflow:** sidebar widgets
- **GitHub:** feed items, dashboard sidebar
- **Autoplay videos** are automatically paused via MutationObserver

### Pomodoro Timer
Built-in timer with segmented presets — **25m**, **45m**, or **60m**. Shows a large countdown in the popup. Sends a Chrome notification when the session completes.

### 5-Minute Break System
Need a quick break? The blocked page offers a 5-minute break with a frosted-glass countdown overlay. Focus mode stays active — blocking resumes automatically when the break ends.

### Focus Dashboard
Full-page stats view with:
- **Stats row** — total focus time, sites blocked, current streak, average session length
- **Weekly bar chart** — last 7 days of focus time with animated bars
- **Most blocked sites** — top 5 sites ranked by block count with horizontal bars
- **Streak calendar** — current month grid showing days with focus activity

### Light & Dark Theme
Apple-minimal design system with full light/dark support. Theme switches instantly via CSS custom properties — no re-render needed. Toggle from the popup, dashboard, or settings.

### Settings
- Add, remove, and toggle individual blocked sites
- Enable/disable page cleanup with visual tag pills
- Reset all statistics with a confirmation dialog

---

## Install

1. **Clone** the repository:
   ```bash
   git clone https://github.com/yourusername/assistly.git
   ```
2. Open Chrome → navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `assistly` folder
5. **Pin** the extension to your toolbar

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension standard | Chrome Manifest V3 |
| Language | Vanilla JavaScript — zero dependencies, zero build step |
| Styling | CSS Custom Properties with `[data-theme="dark"]` |
| Chrome APIs | `storage.local`, `alarms`, `tabs`, `webNavigation`, `notifications` |
| Fonts | System stack + DM Sans from Google Fonts |
| Icons | Generated with Python + Pillow |

---

## Architecture

```
assistly/
├── manifest.json              # Extension manifest (MV3)
├── icons/                     # 16 / 32 / 48 / 128 px PNGs
│
├── pages/
│   ├── popup.html             # 360px popup — focus toggle, stats, pomodoro
│   ├── blocked.html           # Mindful redirect — breathing circle + break overlay
│   ├── dashboard.html         # Full-page stats — chart, calendar, top sites
│   └── settings.html          # Blocklist management + cleanup toggles
│
├── scripts/
│   ├── background.js          # Service worker — state, blocking, alarms, messages
│   ├── popup.js               # Popup controller
│   ├── blocked.js             # Blocked page controller + breathing guide
│   ├── cleanup.js             # Content script — hide ads, sidebars, feeds
│   ├── dashboard.js           # Dashboard controller + chart rendering
│   └── settings.js            # Settings controller + blocklist CRUD
│
├── styles/
│   ├── popup.css              # Popup styles
│   ├── blocked.css            # Blocked page styles + breathing animations
│   ├── pages.css              # Shared styles for dashboard + settings
│   └── cleanup.css            # Injected cleanup rules
│
├── README.md
├── LICENSE                    # MIT
└── .gitignore
```

### How the pieces communicate

| From | To | Method |
|------|----|--------|
| Popup | Background | `chrome.runtime.sendMessage` |
| Dashboard / Settings | Background | `chrome.runtime.sendMessage` |
| Blocked page | Storage | `chrome.storage.local.get` (direct read) |
| Content script | Storage | `chrome.storage.local.get` + `onChanged` listener |
| Background | Popup / Pages | `chrome.runtime.sendMessage` (broadcast) |

### Message types

| Message | Description |
|---------|-------------|
| `getState` | Returns full `{ state, blocklist, stats }` |
| `toggleFocus` | Flip focus mode on/off, start/stop tracking alarm |
| `startBreak` / `endBreak` | 5-minute break with alarm |
| `startPomodoro` / `stopPomodoro` | Pomodoro timer with notification |
| `updateBlocklist` | Save updated blocklist array |
| `updateSettings` | Merge partial settings (theme, cleanup, pomodoro time) |
| `resetStats` | Clear all statistics |

---

## Design System

Apple-minimal aesthetic with:

- **System font stack:** `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'DM Sans', 'Helvetica Neue', sans-serif`
- **Accent:** `#5856d6` (light) / `#7d7aff` (dark)
- **Toggle switches:** 44×26px with 22px dot, iOS-proportioned
- **Border-radius:** 12px cards, 8px buttons, 14px focus toggle
- **Typography:** `tabular-nums` on all numbers, `-0.02em` letter-spacing on headings
- **Animations:** Staggered fade-up on page load, breathing animation on blocked page, bar chart ease-in with `cubic-bezier(0.4, 0, 0.2, 1)`
- **Shadows:** Minimal in light mode (`0 0.5px 0 rgba(0,0,0,0.04)`), none in dark mode

---

## Development

No build step needed. Edit any file and reload the extension:

1. Make changes to any `.js`, `.css`, or `.html` file
2. Go to `chrome://extensions`
3. Click the **refresh** icon on the Assistly card
4. Reopen the popup or reload the page

---

## License

MIT — [Lazizbek Ravshanov](https://github.com/yourusername)
