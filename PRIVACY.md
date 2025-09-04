# Privacy Policy for Tab Mission

**Last Updated: 2025-09-04**

Thank you for using Tab Mission ("the Extension"). Your privacy is important to us. This Privacy Policy explains how your data is handled within the Extension.

## 1. Data Collection and Usage

Tab Mission is designed with a "privacy-first" approach. We do not collect, store, transmit, or sell any of your personal data.

### **Data Processed Locally:**

The Extension needs to access certain browser data to perform its core functions. This data is processed **exclusively on your local machine** and is never sent to any external server. This includes:

-   **Tab Information:** The Extension accesses the title, URL, and favicon of your open tabs to display them in the overview grid. This is essential for you to find and switch between your tabs.
-   **Tab Previews:** The Extension captures a visual preview (screenshot) of your open tabs. This image data is used solely to display the thumbnail in the grid and is stored temporarily in your browser's local cache.
-   **User Settings:** Any settings you configure, such as custom keyboard shortcuts or the window's size and position, are saved using the `chrome.storage.local` API. This data is stored only on your computer.

## 2. No Data Transmission

To be perfectly clear: **no browsing data, personal information, or user activity is ever transmitted to or stored on our servers or any third-party servers.** All operations happen locally within your browser.

## 3. Permissions

The Extension requests the minimum permissions necessary to function:

-   `tabs`: To read information about your open tabs.
-   `scripting` & `host_permissions`: To capture tab previews.
-   `storage`: To save your settings locally.
-   ...and other permissions required for the core user experience.

Each permission is used strictly to provide the features described in the Chrome Web Store listing.

## 4. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be posted on this page.

## 5. Contact Us

If you have any questions about this Privacy Policy, please open an issue on our [GitHub repository](https://github.com/kuk1song/Tab-Mission).
