// Clean page addresses (/market, /wallet/<address>, /slot/<n>) with the History API instead of #/ routes.
// Links to "/..." on this site are taken over (no reload); old #/ links still work: they are rewritten
// to the clean address when the page opens or when the hash changes.

export const NAV_EVENT = 'neurals:navigate';

/** Goes to a page of the site without reloading. Accepts "/market" or an old "#/market". */
export function navigate(to: string, replace = false) {
  const path = to.startsWith('#') ? to.slice(1) || '/' : to;
  if (path === location.pathname + location.search && !replace) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  dispatchEvent(new Event(NAV_EVENT));
}

/** An old #/ address (bookmarks, links shared before) becomes its clean address. */
function fromHash() {
  if (location.hash.startsWith('#/')) navigate(location.hash.slice(1) || '/', true);
}

export function startNav() {
  fromHash();
  addEventListener('hashchange', fromHash);
  addEventListener('popstate', () => dispatchEvent(new Event(NAV_EVENT)));
  // Same-site links: a plain left click navigates in place; new tab, modifiers and downloads are left alone.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || !(href.startsWith('/') || href.startsWith('#/')) || href.startsWith('//')) return;
    e.preventDefault();
    navigate(href);
  });
}
