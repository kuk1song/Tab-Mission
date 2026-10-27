// unseen.js
// Tabs opened in the background and not shown yet. Chrome gives a new tab
// the time it was opened as its lastAccessed, so a tab opened in the
// background (a link opened with a middle click, say) would pass for the
// one you were on last: the Tab Mission window would pre-select it, and the
// tip would offer to take you "back" to a page you have not seen. The
// service worker keeps their ids in session storage (cleared when the
// browser quits) until each is shown or closed, also when Chrome puts one
// to sleep (it comes back under a new id). The tabs Chrome restores when it
// starts are not reported as created, so they count as seen.
const KEY = 'unseenTabs';

let writes = Promise.resolve(); // one update at a time, so none is lost

function update(change) {
  writes = writes.then(async () => {
    const { [KEY]: ids = [] } = await chrome.storage.session.get(KEY);
    const next = change(ids);
    if (next !== ids) await chrome.storage.session.set({ [KEY]: next });
  }).catch(() => {});
  return writes;
}

// Called once when the service worker starts (background.js).
export function trackUnseenTabs() {
  chrome.tabs.onCreated.addListener((tab) => {
    if (!tab.active) update((ids) => [...ids, tab.id]);
  });
  const seen = (tabId) => update((ids) => (ids.includes(tabId) ? ids.filter((id) => id !== tabId) : ids));
  chrome.tabs.onActivated.addListener(({ tabId }) => seen(tabId));
  chrome.tabs.onRemoved.addListener((tabId) => seen(tabId));
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
    update((ids) => (ids.includes(removedTabId) ? ids.map((id) => (id === removedTabId ? addedTabId : id)) : ids)));
}

// The Tab Mission window's side: the ids, when it opens.
export async function unseenTabIds() {
  try {
    const { [KEY]: ids = [] } = await chrome.storage.session.get(KEY);
    return new Set(ids);
  } catch {
    return new Set();
  }
}
