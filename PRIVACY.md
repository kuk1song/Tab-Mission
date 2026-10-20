# Privacy Policy for Tab Mission

**Last Updated: 2026-10-20**

Thank you for using Tab Mission ("the Extension"). This policy explains exactly what the Extension reads, where that data stays, and why each permission is needed. It describes version 1.5.0; section 5 lists what earlier versions do differently.

## 1. Summary

Tab Mission has no developer-run server, analytics or tracking. It reads and processes open-tab information, page image addresses and pictures of the pages you look at in your browser to provide its searchable tab grid. It does not upload your tab list, search text or page pictures to the developer, sell user data, or use it for advertising. Displaying preview images makes requests to websites and their image hosts, as explained below; site icons are read from Chrome's own icon store on your computer.

## 2. What the Extension reads, and where it stays

- **Tab information:** the title, URL (or, until its site answers, the address the tab is going to), favicon, window and last-used time of your open tabs, read with the `tabs` permission to build, search and order the grid of tabs in the Tab Mission window. Each site's icon is shown from the icons Chrome has already stored, read with the `favicon` permission, without a request to the site. It is held in memory while the Tab Mission window is open; a tab's address is also kept with its page picture and its preview image address, as described below. The Extension does not read the browser's history database.
- **Pictures of pages:** when a web page is in front of you in a normal browser window (half a second after you switch to it, it finishes loading or changes address, or its window gets focus, then again about 3 and 15 seconds after that while it stays in front, and about three times a minute at most for a page that keeps loading or changing its address; and when you open Tab Mission while it is the current tab), the Extension takes a picture of the visible part of that tab with `chrome.tabs.captureVisibleTab`, shrinks it to card size and shows it as that tab's card (a blank picture is not kept). Pictures are kept with the address of their tab in `chrome.storage.local` on your computer, so a tab that is open again after you restart the browser keeps its picture. A tab's picture is deleted when you close the tab; pictures of pages that are no longer open, such as a tab that did not come back after a restart, are deleted the next time you open Tab Mission; and the oldest go first when they reach 6 MB. Clearing browsing data in Chrome does not delete them; removing the Extension does. Pictures are never taken of incognito tabs or of browser pages such as `chrome://` pages, and never leave your computer.
- **Preview image addresses:** for a tab without a picture, the Extension reads the address of a preview image the page itself declares (its `og:image` or Twitter card image, its `image_src` link, or its video poster); for a YouTube video it uses the video's thumbnail on YouTube's image server (`i.ytimg.com`). The image is then loaded from that address without cookies and without sending the page's address along, and shown only if it is at least 300 pixels wide and not about square; a small or square image, usually a logo, is not shown. Each image address is cached with the address of its tab in `chrome.storage.session`. For an incognito tab no image is looked for or loaded.
- **Getting started progress:** which of the welcome page's two "Try it" steps you have done (open the window with the shortcut, press it again to go back) and how many more times the window shows each of its tips on its own, saved with `chrome.storage.local` on your computer.
- **Settings:** your "Show sleeping", "Show all windows", "Pre-select the previous tab", "Group tabs by site" and "Show tips" choices and the Tab Mission window's size and position, saved with `chrome.storage.local` on your computer. Your search text is never saved; text saved by versions before 1.2.0 is deleted on update.

## 3. Permissions and why they are needed

- `tabs`: read tab titles, URLs and favicons, switch to a tab, and close a tab when you ask.
- `favicon`: show each tab's site icon from the icons Chrome already keeps on your computer, so no icon is requested from the site. It adds no warning to the ones `tabs` already shows.
- `scripting` and host access to all sites (`<all_urls>`): take the pictures of pages described above with `captureVisibleTab`, and find a preview image address by reading the page's preview image tags and video poster. Preview addresses are also read from eligible tabs that are not active. The Extension never changes a page or injects into a sleeping tab.
- `system.display`: size and place the Tab Mission window on the screen you are using.
- `storage`: save the settings, the getting started progress, the page pictures and the session cache listed above.

## 4. Network requests and limited use

The Extension does not send your tab list, search text, page pictures or settings to the developer. Its network requests load the preview images described in section 2 from their original addresses. The receiving website or image host receives ordinary request information, including your IP address and the requested resource URL. Preview images are requested without a page referrer and without cookies. These requests are needed to display the images; they are not analytics or tracking requests operated by the developer.

Tab Mission's use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Data is used only for the disclosed tab grid, search, switching and related settings. It is not sold or used for advertising, unrelated profiling, creditworthiness or lending. The developer has no server that receives this data and no access to it through the Extension. No person, including the developer, reads this data.

## 5. Earlier versions

Versions before 1.5.0 differ in these ways:

- They take no pictures of pages.
- They load each tab's icon from the address the page gives for it, which is a request to the site or the host of that icon; they have no `favicon` permission.
- For a preview image they also use the page's touch icon, a large background image or the largest image on the page, and they load it as an ordinary image, so the image host can receive its cookies (still without the page's address).
- They also look for a preview image in an incognito tab's page, without caching it.
- They have no "Group tabs by site" setting.
- Versions before 1.2.0 also ask for `activeTab`, which adds nothing to their host access to all sites.

## 6. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be posted on this page with a new date.

## 7. Contact Us

If you have any questions about this Privacy Policy, please open an issue on our [GitHub repository](https://github.com/kuk1song/Tab-Mission).
