# Privacy Policy for Tab Mission

**Last Updated: 2026-10-03**

Thank you for using Tab Mission ("the Extension"). This policy explains exactly what the Extension reads, where that data stays, and why each permission is needed.

## 1. Summary

Tab Mission has no server, no analytics and no tracking. It does not collect, sell or transmit your browsing data. Everything it reads is used inside your browser to draw the tab overview, and nothing leaves your device through the Extension.

## 2. What the Extension reads, and where it stays

- **Tab information:** the title, URL, favicon, window and last-used time of your open tabs, read with the `tabs` permission to build and order the overview grid. It is held in memory while the overview window is open.
- **Preview image addresses:** to show a picture for each tab, the Extension reads the address of an image the page itself declares (for example its `og:image` social preview image) or the largest image already on the page. It does **not** take screenshots. The image is then loaded from that address, as the page itself would load it, without sending the page's address along. Each image address is cached with the address of its tab in `chrome.storage.session`, which lives in memory and is cleared when you quit the browser; incognito tabs are not cached.
- **Settings:** your "Show sleeping", "Show all windows" and "Pre-select the previous tab" choices and the overview window's size and position, saved with `chrome.storage.local` on your computer. Your search text is never saved; text saved by versions before 1.2.0 is deleted on update.

## 3. Permissions and why they are needed

- `tabs`: read tab titles, URLs and favicons, switch to a tab, and close a tab when you ask.
- `scripting` and host access to all sites (`<all_urls>`): read the preview image address from a page, as described above. No other page content is read, and the Extension never changes a page.
- `system.display`: size and place the overview window on the screen you are using.
- `storage`: save the settings and the session cache listed above.

## 4. No data transmission

No browsing data, personal information or user activity is sent to the developer or to any third party. The only network requests are for the preview images and tab icons described in section 2. They go to the addresses your open pages declare, which may be the site itself or a server it uses for images.

## 5. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be posted on this page with a new date.

## 6. Contact Us

If you have any questions about this Privacy Policy, please open an issue on our [GitHub repository](https://github.com/kuk1song/Tab-Mission).
