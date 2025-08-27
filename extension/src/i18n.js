// i18n.js

/**
 * Apply localized strings to static UI text in the overview window.
 * This function uses chrome.i18n.getMessage to populate labels, titles,
 * placeholders, and the document title.
 */
export function localizeStaticText() {
	const t = (key) => {
		try {
			return chrome.i18n.getMessage(key) || '';
		} catch {
			return '';
		}
	};

	// Title
	document.title = t('pageTitle') || document.title;

	// Search placeholder
	const searchInput = document.getElementById('search');
	if (searchInput) {
		const placeholder = t('searchPlaceholder');
		if (placeholder) searchInput.setAttribute('placeholder', placeholder);
	}

	// Labels for checkboxes
	const sleepInput = document.getElementById('toggle-hide-discarded');
	if (sleepInput && sleepInput.parentElement) {
		const span = sleepInput.parentElement.querySelector('span');
		if (span) span.textContent = t('showSleepingLabel') || span.textContent;
	}

	const allWindowsInput = document.getElementById('toggle-current-window');
	if (allWindowsInput && allWindowsInput.parentElement) {
		const span = allWindowsInput.parentElement.querySelector('span');
		if (span) span.textContent = t('showAllWindowsLabel') || span.textContent;
	}

	// Buttons (titles and aria-labels)
	const shortcutsBtn = document.getElementById('open-shortcuts');
	if (shortcutsBtn) {
		const msg = t('changeShortcutTitle');
		if (msg) {
			shortcutsBtn.title = msg;
			shortcutsBtn.setAttribute('aria-label', msg);
		}
	}

	const resetBtn = document.getElementById('reset-window');
	if (resetBtn) {
		const msg = t('resetWindowTitle');
		if (msg) {
			resetBtn.title = msg;
			resetBtn.setAttribute('aria-label', msg);
		}
	}
}
