# ADR-004: Search Performance Optimization

**Context:**
When searching with a large number of open tabs, rapidly typing in the search box could cause UI lag or a "sticky" feeling. This was because every `input` event (each keystroke) triggered a full, expensive re-render of the entire tab grid.

**Decision:**
We implemented a `debounce` function on the search input's event listener in `events.js`. The re-render logic (`handleFilterChange`) is now only invoked after the user has paused typing for 200ms.

**Consequences:**
*   **Pros:**
    *   **Fluid Experience:** Drastically reduces the number of re-renders during a single typing session, resulting in a smooth, responsive search experience regardless of the number of tabs.
    *   **Efficiency:** Reduces CPU usage and prevents unnecessary DOM manipulation.
*   **Cons:**
    *   There is a 200ms delay between the user stopping typing and the UI updating. This is a standard UX pattern for search inputs and is generally considered a positive trade-off for the performance gain.
