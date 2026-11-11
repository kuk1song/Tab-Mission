// feedback.js: the settings page's "Report a problem" link. It opens
// GitHub's issue form (.github/ISSUE_TEMPLATE/bug.yml) with Tab Mission's
// version, the browser and the system filled in, so a report says where it
// happened. The values go to GitHub in the link's address only when the user
// clicks it, and into an issue only if the user submits the form.

const ISSUE_FORM = 'https://github.com/kuk1song/Tab-Mission/issues/new';

// The form's address with its fields filled in: version, browser and os are
// the ids of bug.yml's fields. A value that is not known is left out, so its
// field stays empty for the user to fill.
export function issueFormUrl({ version, browser, os }) {
  const fields = { template: 'bug.yml', version, browser, os };
  const query = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${ISSUE_FORM}?${query}`;
}

// Chrome lists, among the brands it reports, a made-up one (such as
// "Not:A-Brand") so that sites do not rely on the list's order or contents.
const MADE_UP_BRAND = /^not.a.brand$/i;

// The browser and its major version: the brand that names it ("Google
// Chrome 142", "Microsoft Edge 142"), else "Chromium 142", from
// navigator.userAgentData; without it, Chrome's version in the user agent
// string ("Chrome 142"). Empty when neither says.
export function browserName(userAgentData, userAgent) {
  const brands = (userAgentData?.brands ?? []).filter((b) => b.brand && !MADE_UP_BRAND.test(b.brand));
  const brand = brands.find((b) => b.brand !== 'Chromium') ?? brands[0];
  if (brand) return `${brand.brand} ${brand.version}`;
  const version = /Chrome\/(\d+)/.exec(userAgent ?? '')?.[1];
  return version ? `Chrome ${version}` : '';
}

// chrome.runtime.getPlatformInfo().os, as people name the system.
const SYSTEMS = {
  mac: 'macOS',
  win: 'Windows',
  linux: 'Linux',
  cros: 'ChromeOS',
  android: 'Android',
  openbsd: 'OpenBSD',
  fuchsia: 'Fuchsia',
};

// The system's name, from chrome.runtime.getPlatformInfo(), else as
// navigator.userAgentData names it. Empty when neither says.
export function systemName(platformInfo, userAgentData) {
  return SYSTEMS[platformInfo?.os] ?? userAgentData?.platform ?? '';
}
