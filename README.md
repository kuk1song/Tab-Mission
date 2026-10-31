<p align="center">
  <img src="https://raw.githubusercontent.com/kuk1song/Tab-Mission/main/assets/production/logo.png" alt="Tab Mission Logo" width="128">
</p>

<h1 align="center">Tab Mission</h1>

<p align="center">
  <em>Any tab, one key away.</em>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/tab-mission/hhnkkpdkfhjlmlanebphmmhgkhinijca?utm_source=github&utm_medium=readme">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Install from Chrome Web Store">
  </a>
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="License: MIT">
</p>

<p align="center">
  <a href="https://youtu.be/U0R_pweVJ_0">
    <img src="assets/production/tutorial-thumbnail.jpg" alt="Tab Mission tutorial on YouTube" width="640">
  </a>
  <br>
  <a href="https://youtu.be/U0R_pweVJ_0">▶ Watch the 2-minute tutorial</a>
</p>

---

Tab Mission puts your tabs into one searchable grid, the ones you used last first. Summon it with a single shortcut, type a few letters, press Enter, and you are there.

## ✨ Features

- **One Grid:** Your tabs as cards, one keystroke away.
- **Most Likely First:** The tab you most likely want, the previous one, takes the first slot; your current tab sits second, then your other recent tabs.
- **Type to Search:** The search box is ready as soon as the grid opens. Every word you type must match the title or URL, the best match is highlighted, and `Enter` takes you there. A search covers all windows and sleeping tabs; without one, the grid shows what the two toggles above it say.
- **Site View:** When the grid holds two or more tabs from the website you are on, press `Tab` in the search box to see only those (`Tab` again, `Backspace` at the start of the box, or `Esc` once the box is empty, to leave). A shortcut of its own can be assigned at `chrome://extensions/shortcuts`; it has no default so it never clashes with other extensions.
- **Grouped by Site:** Your five most recent tabs come first (the previous tab still in the first slot), then a panel for each site with two or more tabs, which switching tabs never moves; the rest come last. It makes the same groups at any window size; a narrower window fits fewer tabs in a row, and the panels may come in another order to fill each row. You can turn it off in the settings.
- **Keyboard or Mouse:** `↑↓←→` + `Enter`, or click. Middle-click or `×` closes a tab. `Esc` steps back: it clears the search, then leaves the site view, then closes.
- **Page Previews:** Each tab shows a small picture of the page, taken while it was in front of you and kept after a restart, with its title underneath; until it has one, the preview image the page provides (not a logo), or the site's icon on a card in the icon's color. Light or dark, as your system is.
- **Private by Design:** No developer-run server, analytics or tracking. Tab information and page pictures stay on your computer (a tab's picture is deleted when you close the tab, and none is taken of incognito tabs); preview images load from their original hosts, and site icons come from Chrome's own store.

## 🚀 Getting Started

1.  **[Install Tab Mission from the Chrome Web Store](https://chromewebstore.google.com/detail/tab-mission/hhnkkpdkfhjlmlanebphmmhgkhinijca?utm_source=github&utm_medium=readme)**.
2.  Click the extension icon or use the default shortcut: **`Cmd + E`** on Mac, **`Ctrl + Shift + E`** on Windows, Linux and ChromeOS. If another extension already owns it, pick your own at `chrome://extensions/shortcuts` (the gear in Tab Mission opens its settings, which show your shortcut and a button to that page). While assigned, the shortcut takes priority over the same key on web pages, such as GitHub's `Cmd + E` for inline code or Google Docs' `Ctrl + Shift + E` for center align; choose another key if you rely on one.
3.  Start typing, then press `Enter`.

## 💡 Pro Tips

- **Back to the previous tab:** press the shortcut twice (the previous tab is selected when Tab Mission opens).
- **No-click switching:** press the shortcut, move the mouse onto the tab you want, and press the shortcut **again**. Keep holding `Cmd` (or `Ctrl + Shift`) the whole time, and pressing it again is just a tap on `E`.
- **Toggle style (optional):** click the gear in Tab Mission and turn off "Pre-select the previous tab"; then nothing is selected on open, and pressing the shortcut again closes Tab Mission.

## 🛠️ Development

Plain JavaScript, no build step: `extension/` is exactly what ships. With Node 24:

```sh
npm ci
npm run check      # lint, manifest checks, unit tests
npx playwright install chromium
npm run test:e2e   # end-to-end tests in Playwright's Chromium
npm run package    # builds/tab-mission-<version>.zip
```

To try your changes, load `extension/` at `chrome://extensions` (Developer mode, then "Load unpacked").

## 💬 Feedback & Support

Questions, bugs and ideas are welcome: **[open an issue](https://github.com/kuk1song/Tab-Mission/issues)**, where others with the same question can find the answer.

## 🛡️ Privacy & Open Source

Tab Mission is free and open source (MIT). It processes tab information and page pictures in your browser, does not upload your tab list, search text or pictures to the developer, and does not sell user data. Preview images load from websites or their image hosts. Details, including local storage and why each permission is needed, are in the [**Privacy Policy**](PRIVACY.md).

Permissions: `tabs` to list, switch and close tabs; `favicon` for site icons from Chrome's own store; `scripting` and access to all sites for the page pictures and preview images; `system.display` to place the window on your screen; `storage` for settings, page pictures and the other data the Privacy Policy lists.

The MIT license covers the code. It does not grant rights to the Tab Mission name or logo as a trademark, so please give forks and derived extensions a different name and icon.

---

<p align="center">
  Made by <a href="https://www.kuk1song.com/">Haokun Song</a>
</p>
