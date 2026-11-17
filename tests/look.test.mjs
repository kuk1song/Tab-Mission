import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// look.js is a plain script in the overview's <head>: run here with the few
// things of a page it reads.
const source = readFileSync(new URL('../extension/src/look.js', import.meta.url), 'utf8');
function run({ search = '', framed = false } = {}) {
  const listeners = {};
  const searchBox = { focus: vi.fn() };
  const document = {
    documentElement: { dataset: {} },
    readyState: 'loading',
    addEventListener: (type, listener) => { listeners[type] = listener; },
    getElementById: (id) => (id === 'search' ? searchBox : null),
  };
  const window = {};
  window.top = framed ? {} : window;
  new Function('window', 'document', 'location', 'matchMedia', source)(window, document, { search }, () => ({ matches: false }));
  const state = (readyState) => {
    document.readyState = readyState;
    listeners.readystatechange?.();
  };
  return { document, searchBox, state };
}

describe('look.js', () => {
  it('in its own window, puts the keyboard in the search box as soon as the page is read, once', () => {
    const { searchBox, state } = run({ search: '?layout=spread' });
    expect(searchBox.focus).not.toHaveBeenCalled();
    state('interactive');
    expect(searchBox.focus).toHaveBeenCalledTimes(1);
    state('complete');
    expect(searchBox.focus).toHaveBeenCalledTimes(1);
  });

  it('in a frame on a page, leaves the keyboard alone: the page hands it over', () => {
    const { searchBox, state, document } = run({ search: '?host=page&layout=spread', framed: true });
    state('interactive');
    state('complete');
    expect(searchBox.focus).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.host).toBe('page');
  });

  it('the overview pages carry no autofocus attribute: Chrome logs an error for one in a frame on a page', () => {
    for (const name of ['overview.html', 'overlay.html']) {
      expect(readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8')).not.toMatch(/\bautofocus\b/);
    }
  });
});
