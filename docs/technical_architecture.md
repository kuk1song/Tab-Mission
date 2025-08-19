# Technical Architecture

## 1. Overview
Tab Mission is a Chrome Extension composed of a background service worker, a main UI document (`overview.html`), and a modular set of JavaScript ES6 modules that handle the application's logic and rendering.

## 2. Component Breakdown

### 2.1. `background.js` (Service Worker)
*   **Role:** The persistent backbone of the extension. It manages state that must survive the UI window's lifecycle.
*   **Key Responsibilities:**
    *   **Window Management:** Handles the creation, toggling, and closing of the main extension popup window. It contains all logic for determining the window's initial size (adaptive) and position, as well as restoring the last-used bounds.
    *   **State Persistence:** Solely responsible for reliably saving and retrieving the window's `overviewBounds` to/from `chrome.storage.local` using the `onBoundsChanged` and `onRemoved` browser events.
    *   **Command Listener:** Listens for the `open-overview` command (keyboard shortcut) and browser action clicks to trigger the window.
    *   **Message Handling:** Responds to messages from the UI for privileged operations, such as `resetWindowBounds`.

### 2.2. `overview.html` & `overview.css`
*   **Role:** The user-facing interface.
*   **`overview.html`:** A minimal HTML document that defines the static structure of the UI: the toolbar, search input, filter checkboxes, icon buttons, and the main grid container (`<main id="grid">`).
*   **`overview.css`:** Contains all styling information for the extension.
    *   **Theme:** Uses CSS custom properties (variables) for a consistent and easily maintainable color palette and design system.
    *   **Animations:** Defines all keyframe animations for opening (`fadeInUp`), closing (`fadeOutUp`), and window transitions (`rootFadeIn`, `rootFadeOut`). It uses custom properties like `--stagger` and `--stagger-out` which are set dynamically by JavaScript to orchestrate animations.
    *   **Layout:** Primarily uses CSS Grid for the main tab layout, allowing for a responsive, auto-filling grid. Flexbox is used for toolbar and card layouts.

### 2.3. JavaScript Modules (`/src`)

The application logic is broken down into several single-responsibility modules.

*   **`main.js` (Entry Point):**
    *   Orchestrates the application startup sequence after the DOM is loaded.
    *   Fetches initial data (tabs, settings), applies settings to the UI, performs the initial render, and initializes all event listeners.
    *   Contains the crucial `setTimeout` logic to defer `startThumbnailCapture`, preventing main thread blocking on startup.

*   **`state.js` (Single Source of Truth):**
    *   Manages the application's state, including the complete list of all tabs (`allTabs`) and the currently visible tabs (`filteredTabs`).
    *   Contains the core filtering logic (`applyFilters`) that processes search terms and checkbox states to determine which tabs to display.

*   **`dom.js` (Rendering Logic):**
    *   Responsible for all direct manipulation of the DOM.
    *   The `render()` function populates the `#grid` with tab tiles based on the current `state.filteredTabs`.
    *   Contains functions for creating individual elements like tiles (`createTile`), preview areas (`createPreviewElement`), and meta info (`createMetaElement`).
    *   Manages the selection state visuals (`updateSelection`).

*   **`events.js` (User Interaction):**
    *   Initializes all event listeners for the UI (search input, filter changes, button clicks, keyboard navigation).
    *   Contains the `debounce` function to optimize the search input handler.
    *   Handles the logic for closing the window (`closeOverview`), including calculating the correct `setTimeout` delay to sync with CSS animations.

*   **`thumbnail.js` (Visuals & Fallbacks):**
    *   Manages the complex process of capturing and displaying tab thumbnails.
    *   Uses an `IntersectionObserver` to lazily load thumbnails only for tiles that are currently visible in the viewport, optimizing performance.
    *   Contains the logic for the "sleeping tab" style fallback, which is now the universal fallback for any uncapturable page. It determines when to show the fallback and hides the `<img>` element accordingly.

*   **`settings.js` (Persistence):**
    *   A simple, dedicated module for interacting with `chrome.storage.local`.
    *   Exports `loadSettings` and `saveSettings` async functions, providing a clean interface for other modules to persist and retrieve user preferences (e.g., filter states).

*   **`utils.js` (Shared Helpers):**
    *   A collection of pure, stateless helper functions used across multiple modules.
    *   Includes URL parsing (`getHostname`), validation (`isCapturableUrl`), and dynamic placeholder generation (`getPlaceholderDataUrl`).

## 3. Data Flow
1.  **Activation:** User hits shortcut or clicks icon. `background.js` creates the window.
2.  **Initialization:** `main.js` runs, calls `fetchAllTabs` from `state.js` to populate the master tab list. It also calls `loadSettings`.
3.  **Filtering:** `main.js` applies the loaded settings via `applyFilters` in `state.js`, creating the initial `filteredTabs` list.
4.  **Rendering:** `main.js` calls `render()` in `dom.js`. `render` iterates over `filteredTabs` and builds the DOM.
5.  **Interaction:** User types in the search box. The debounced event listener in `events.js` fires.
6.  **Re-render Loop:** The event handler calls `applyFilters` (updating `state.filteredTabs`), which then calls `render` (updating the DOM).
7.  **Thumbnail Capture:** As tiles scroll into view, the `IntersectionObserver` in `thumbnail.js` triggers, calling `loadThumbnail` to fetch or fall back on a visual for each tab.
8.  **Persistence:** Changing a filter calls `saveSettings`. Changing window size triggers events in `background.js` to save bounds.
