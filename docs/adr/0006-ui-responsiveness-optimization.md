# ADR-003: Initial UI Responsiveness Optimization

**Context:**
Users reported a significant, jarring delay on their *first* hover or click interaction after the extension window opened. Subsequent interactions were instantaneous. Extensive debugging ruled out CSS rendering performance (`transform`, `will-change`, `backdrop-filter`) as the root cause.

**Decision:**
The root cause was identified as **main thread contention**. Upon opening, the application was executing several heavy tasks simultaneously: fetching all tabs, rendering the entire DOM grid, and immediately initiating thumbnail captures for visible tabs. This "traffic jam" on the main thread blocked the initial user interaction event from being processed in a timely manner.

The chosen solution was to **defer non-essential work**. The `startThumbnailCapture()` function call in `main.js` was wrapped in a `setTimeout` with a 100ms delay.

**Consequences:**
*   **Pros:**
    *   **Instant Responsiveness:** This small, imperceptible delay in starting thumbnail captures is sufficient to free up the main thread, allowing it to process the user's first interaction immediately. This completely resolves the "first hover lag" issue.
    *   **Low Risk:** This is a standard, low-risk performance optimization technique that only changes the timing of an operation without altering its logic.
*   **Cons:**
    *   Thumbnail loading for the very first visible tabs is technically delayed by 100ms, though this is not noticeable to the user.
