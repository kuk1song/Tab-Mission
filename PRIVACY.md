# Privacy Policy for Tab Mission

**Last Updated: 2026-10-15**

Thank you for using Tab Mission ("the Extension"). This policy explains exactly what the Extension reads, where that data stays, and why each permission is needed.

## 1. Summary

Tab Mission has no developer-run server, analytics or tracking. It reads and processes open-tab information and page image addresses in your browser to provide its searchable tab grid. It does not upload your tab list or search text to the developer, sell user data, or use it for advertising. Displaying previews and icons makes requests to websites and their image hosts, as explained below.

## 2. What the Extension reads, and where it stays

- **Tab information:** the title, URL, favicon, window and last-used time of your open tabs, read with the `tabs` permission to build, search and order the overview grid. It is held in memory while the overview window is open. The Extension does not read the browser's history database.
- **Preview image addresses:** to show a picture for each tab, the Extension reads the address of an image the page itself declares (for example its `og:image` social preview image, its touch icon or its video poster) or of a large image already on the page; for a YouTube video it uses the video's thumbnail on YouTube's image server (`i.ytimg.com`). It does **not** take screenshots. The image is then loaded from that address, as the page itself would load it, without sending the page's address along. Each image address is cached with the address of its tab in `chrome.storage.session`, which lives in memory and is cleared when you quit the browser; incognito tabs are not cached.
- **Getting started progress:** which of the welcome page's two "Try it" steps you have done (open the window with the shortcut, press it again to go back) and whether the window's tips are still due, saved with `chrome.storage.local` on your computer.
- **Settings:** your "Show sleeping", "Show all windows", "Pre-select the previous tab" and "Show tips" choices and the overview window's size and position, saved with `chrome.storage.local` on your computer. Your search text is never saved; text saved by versions before 1.2.0 is deleted on update.

## 3. Permissions and why they are needed

- `tabs`: read tab titles, URLs and favicons, switch to a tab, and close a tab when you ask.
- `scripting` and host access to all sites (`<all_urls>`): find a preview image address by inspecting image metadata, links, video posters, background-image styles and existing image elements, as described above. This includes eligible tabs that are not active. The Extension never changes a page or injects into a sleeping tab.
- `system.display`: size and place the overview window on the screen you are using.
- `storage`: save the settings, the getting started progress and the session cache listed above.

## 4. Network requests and limited use

The Extension does not send your tab list, search text or settings to the developer. Its network requests load the preview images and tab icons described in section 2 from their original addresses. The receiving website or image host receives ordinary request information, including your IP address and the requested resource URL. Preview images are requested without a page referrer. These requests are needed to display the images; they are not analytics or tracking requests operated by the developer.

Tab Mission's use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Data is used only for the disclosed tab grid, search, switching and related settings. It is not sold or used for advertising, unrelated profiling, creditworthiness or lending. The developer has no server that receives this data and no access to it through the Extension. No person, including the developer, reads this data.

## 5. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be posted on this page with a new date.

## 6. Contact Us

If you have any questions about this Privacy Policy, please open an issue on our [GitHub repository](https://github.com/kuk1song/Tab-Mission).
