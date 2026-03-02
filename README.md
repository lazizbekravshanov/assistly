# Assistly — Focus & Deep Work

A Chrome extension that helps college students and remote workers enter deep work by blocking distracting websites, cleaning up allowed pages, tracking focus stats, and providing a Pomodoro timer.

## Features

- **Site Blocking** — Block distracting sites during focus sessions with a mindful redirect page
- **Page Cleanup** — Automatically hide ads, sidebars, feeds, and popups on allowed sites
- **Focus Stats** — Track daily focus time, blocked sites, and maintain streaks
- **Pomodoro Timer** — Built-in timer with 25/45/60 minute presets
- **Break System** — 5-minute breaks with countdown and auto-resume
- **Dark Mode** — Full light/dark theme support
- **Dashboard** — Weekly charts, most blocked sites, and streak calendar
- **Zero Dependencies** — No frameworks, no npm, no build step. Just files Chrome loads directly.

## Install

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `assistly` folder
6. Pin the extension to your toolbar

## Project Structure

```
assistly/
├── manifest.json           # Chrome extension manifest (MV3)
├── icons/                  # Extension icons (16/32/48/128px)
├── pages/
│   ├── popup.html          # Extension popup (360px wide)
│   ├── blocked.html        # Mindful blocked site page
│   ├── dashboard.html      # Full-page stats dashboard
│   └── settings.html       # Blocklist & cleanup settings
├── scripts/
│   ├── background.js       # Service worker (the brain)
│   ├── popup.js            # Popup UI controller
│   ├── blocked.js          # Blocked page controller
│   ├── cleanup.js          # Content script for page cleanup
│   ├── dashboard.js        # Dashboard controller
│   └── settings.js         # Settings controller
├── styles/
│   ├── popup.css           # Popup styles
│   ├── blocked.css         # Blocked page styles
│   ├── pages.css           # Shared dashboard/settings styles
│   └── cleanup.css         # Cleanup injection styles
├── README.md
├── LICENSE                 # MIT
└── .gitignore
```

## Tech Stack

- Chrome Manifest V3
- Vanilla JavaScript — zero dependencies
- CSS Custom Properties — light/dark theme
- Chrome APIs: `storage.local`, `alarms`, `tabs`, `webNavigation`, `notifications`

## How It Works

1. Toggle focus mode from the popup
2. Distracting sites redirect to a mindful blocked page with breathing exercises
3. Allowed pages get automatically cleaned up (ads, sidebars, feeds removed)
4. Track your progress on the dashboard
5. Manage your blocklist and settings from the settings page

## License

MIT — Lazizbek Ravshanov
