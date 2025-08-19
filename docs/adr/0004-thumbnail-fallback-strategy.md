# ADR-001: Thumbnail Generation Fallback Strategy

**Context:**
The extension displays a visual preview (thumbnail) for each tab. However, thumbnails can fail to load for various reasons: protected system pages (`chrome://...`), local development pages (`localhost`), network errors, or pages that simply lack a suitable image. The initial fallback was a single, abstract letter icon, which users found confusing as it provided no context.

**Decision:**
We decided to unify all thumbnail fallback states to mimic the visual style of a "sleeping tab." This approach uses a canvas-generated image (`getPlaceholderDataUrl`) as a background, which programmatically draws the page's title and hostname onto a colored gradient.

**Consequences:**
*   **Pros:**
    *   **Maximizes Consistency:** This solution reuses an existing and user-understood UI pattern within the application, reducing cognitive load.
    *   **Informative:** It provides the most critical information (title and URL) directly in the preview area, answering the user's question of "what is this tab?"
    *   **Eliminates Redundancy:** By adopting this as the universal fallback, we were able to remove several intermediate, less successful design iterations (single-letter icons, system status text, adaptive layouts), simplifying the codebase.
*   **Cons:**
    *   The visual distinction between a user-designated "sleeping" tab and a tab that failed to generate a thumbnail is now minimal. This is considered an acceptable trade-off, as in both cases, the card represents a tab without a live visual preview.
