# ADR-002: Window Size & Position Persistence

**Context:**
The extension window's size and position needed to be remembered across sessions to provide a consistent user experience. Initial attempts using page-level events in the UI (`beforeunload` in `overview.js`) proved unreliable. The ephemeral nature of the extension's popup window and the lifecycle of the service worker caused race conditions where the window would close before its final bounds could be saved.

**Decision:**
We centralized all window bounds management within the `background.js` service worker, which persists independently of the UI window.
1.  **Primary Mechanism:** Use `chrome.windows.onBoundsChanged` to listen for any size or position change. This event immediately updates an in-memory `latestBounds` variable and asynchronously saves it to `chrome.storage.local`.
2.  **Safeguard Mechanism:** Use `chrome.windows.onRemoved` as a final, robust safeguard. Just before the window is destroyed, this listener performs a final, synchronous-like save of the `latestBounds` variable, ensuring that even rapid closures are captured.

**Consequences:**
*   **Pros:**
    *   **Reliability:** This approach is significantly more reliable than page-level event listeners, as it's tied to the browser's window management events, not the page's lifecycle.
    *   **Separation of Concerns:** The background script, which is responsible for creating the window, is now also solely responsible for managing its persistent state.
*   **Cons:**
    *   Requires careful state management between the in-memory variable (`latestBounds`) and `chrome.storage` to ensure the most up-to-date information is saved.
