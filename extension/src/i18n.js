// i18n.js

/**
 * Look up a localized message; returns '' when it is missing or chrome.i18n
 * is unavailable, so callers can fall back to an English literal.
 */
export function t(key, substitutions) {
	try {
		return chrome.i18n.getMessage(key, substitutions) || '';
	} catch {
		return '';
	}
}

/**
 * Apply localized strings to static markup. Elements opt in with
 * data-i18n (text content) or data-i18n-title / -placeholder / -aria-label
 * (attributes). The English text already in the HTML is the fallback.
 */
export function localizeStaticText(root = document) {
	try {
		document.documentElement.lang = chrome.i18n.getUILanguage();
	} catch {}

	for (const el of root.querySelectorAll('[data-i18n]')) {
		const msg = t(el.getAttribute('data-i18n'));
		if (msg) el.textContent = msg;
	}

	for (const attr of ['title', 'placeholder', 'aria-label']) {
		for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) {
			const msg = t(el.getAttribute(`data-i18n-${attr}`));
			if (msg) el.setAttribute(attr, msg);
		}
	}
}
