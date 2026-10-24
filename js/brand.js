import { BRAND, PLATFORM_LINK } from './config.js';

// Site settings that the admin page can change without touching code (settings.json in the site folder).
// Defaults come from config.js; settings.json overrides them when present.
let SETTINGS = {};
export const settingsReady = fetch('settings.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then((s) => { SETTINGS = s || {}; applySettings(); return SETTINGS; });
export const siteSettings = () => SETTINGS;

function applySettings() {
  const s = SETTINGS;
  if (s.brandName) BRAND.name = s.brandName;
  if (s.tagline) BRAND.tagline = s.tagline;
  const root = document.documentElement.style;
  if (s.accent) root.setProperty('--accent', s.accent);
  if (s.accent2) root.setProperty('--accent2', s.accent2);
  if (s.accent || s.accent2) root.setProperty('--grad', `linear-gradient(135deg, ${s.accent || '#7c5cff'} 0%, ${s.accent2 || '#ff5c8a'} 100%)`);
  fillBrand();
  const old = document.getElementById('siteBanner');
  if (old) old.remove();
  if (s.banner && s.banner.trim() && !document.body.classList.contains('admin')) {
    const bar = document.createElement('div');
    bar.id = 'siteBanner'; bar.className = 'site-banner'; bar.textContent = s.banner;
    document.body.prepend(bar);
  }
}

function fillBrand() {
  document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = BRAND.name; });
  // Wordmark: split the name at its second capital ("ClipKraft" -> "Clip" + "Kraft") and colour the second half.
  const m = BRAND.name.match(/^(.[^A-Z]*)([A-Z].*)$/);
  document.querySelectorAll('[data-wordmark]').forEach((el) => {
    el.textContent = '';
    const a = document.createElement('span'); a.textContent = m ? m[1] : BRAND.name; el.appendChild(a);
    if (m) { const b = document.createElement('span'); b.className = 'grad-text'; b.textContent = m[2]; el.appendChild(b); }
  });
  document.querySelectorAll('[data-tagline]').forEach((el) => { el.textContent = BRAND.tagline; });
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
  document.querySelectorAll('[data-platform-link]').forEach((el) => { el.textContent = PLATFORM_LINK.label; el.href = PLATFORM_LINK.href; });
  const suffix = document.body.dataset.titleSuffix;
  document.title = suffix ? `${suffix} · ${BRAND.name}` : `${BRAND.name} · ${BRAND.tagline}`;
}

// Fill every [data-brand] element and the page title from the config.
export function applyBrand() {
  fillBrand();
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.content = BRAND.description;
  const og = document.querySelector('meta[property="og:title"]');
  if (og) og.content = `${BRAND.name} · ${BRAND.tagline}`;
  // Web app manifest built from the same config so the name lives in one place.
  const base = new URL('./', location.href).href;
  const manifest = {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: new URL('app.html', base).href,
    scope: base,
    display: 'standalone',
    background_color: BRAND.themeColor,
    theme_color: BRAND.themeColor,
    icons: [
      { src: new URL('icons/icon-192.png', base).href, sizes: '192x192', type: 'image/png' },
      { src: new URL('icons/icon-512.png', base).href, sizes: '512x512', type: 'image/png' },
      { src: new URL('icons/icon-512.png', base).href, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(manifest));
  document.head.appendChild(link);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // When a new version takes over, reload once so the page runs the new files.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  }
}
