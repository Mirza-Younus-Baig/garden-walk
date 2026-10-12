import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/dancing-script/700.css';
import './menu.css';

export type ModeId = 'garden' | 'birthday';

export interface ModeCard {
  id: ModeId;
  title: string;
  blurb: string;
  art: string;          // inline SVG
  accent: string;
}

/** `?mode=` → a known mode, or null for the menu. Anything unknown falls back to the menu. */
export function modeFromUrl(search: string): ModeId | null {
  const m = new URLSearchParams(search).get('mode');
  return m === 'garden' || m === 'birthday' ? m : null;
}

/** the URL for a mode, keeping any other query parameters (name, debug flags) */
export function urlForMode(mode: ModeId | null, search = location.search): string {
  const q = new URLSearchParams(search);
  if (mode) q.set('mode', mode); else q.delete('mode');
  const s = q.toString();
  return s ? `?${s}` : location.pathname;
}

const CAKE_ART = `
<svg viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <radialGradient id="glw" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <linearGradient id="choc" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6b3d26"/><stop offset="1" stop-color="#3b2016"/></linearGradient>
  </defs>
  <circle cx="60" cy="40" r="34" fill="url(#glw)"/>
  <ellipse cx="60" cy="101" rx="44" ry="6" fill="#000" opacity=".18"/>
  <rect x="26" y="60" width="68" height="38" rx="6" fill="url(#choc)"/>
  <path d="M26 66 q0-8 8-8 h52 q8 0 8 8 v4 q-4 6-7 0 t-7 2 t-8 -1 t-8 6 t-8 -5 t-8 3 t-7 -2 t-8 4 t-5 -4z" fill="#2c160e"/>
  <ellipse cx="60" cy="60" rx="34" ry="6" fill="#4a2618"/>
  ${[0, 1, 2, 3, 4].map((i) => {
    const x = 38 + i * 11;
    return `<rect x="${x - 2}" y="40" width="4" height="18" rx="1.5" fill="${['#ffb3c7', '#bde4ff', '#fff1a8', '#c9f2d0', '#e3c8ff'][i]}"/>
      <path class="fl" style="animation-delay:${i * 0.17}s" d="M${x} 30 q4 5 0 9 q-4 -4 0 -9z" fill="#ffcf5c"/>`;
  }).join('')}
</svg>`;

const FLOWER_ART = `
<svg viewBox="0 0 120 120" aria-hidden="true">
  <ellipse cx="60" cy="104" rx="46" ry="6" fill="#000" opacity=".15"/>
  <path d="M60 104 C58 84 62 70 60 52" stroke="#4f8a46" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M60 86 q-18 -6 -22 -18 q16 2 22 18z" fill="#6aa85e"/>
  <path d="M61 78 q16 -8 22 -20 q-16 2 -22 20z" fill="#5c9b51"/>
  <g class="spin">${Array.from({ length: 10 }, (_, i) => `<ellipse cx="60" cy="31" rx="6" ry="13" fill="#fff" stroke="#f1e9e2" transform="rotate(${i * 36} 60 44)"/>`).join('')}</g>
  <circle cx="60" cy="44" r="8" fill="#f6c13b"/>
  <circle cx="22" cy="92" r="5" fill="#f08bb0"/><circle cx="98" cy="88" r="6" fill="#8fb5ff"/><circle cx="90" cy="100" r="4" fill="#ffd36b"/>
</svg>`;

export const MODES: ModeCard[] = [
  { id: 'birthday', title: 'Birthday Room', blurb: 'A cosy little party is waiting — candles, cake and a few surprises.', art: CAKE_ART, accent: '#ff9fb5' },
  { id: 'garden', title: 'Flower Garden', blurb: 'Wander through an endless meadow of lilies, roses, tulips and daisies.', art: FLOWER_ART, accent: '#9fd49a' },
];

/** The first screen: one card per mode. */
export function showMenu(modes: ModeCard[]) {
  const name = new URLSearchParams(location.search).get('name') ?? 'Mithra';
  const root = document.createElement('main');
  root.className = 'menu';
  root.innerHTML = `
    <div class="menu-sky" aria-hidden="true">${Array.from({ length: 26 }, (_, i) =>
      `<i style="--x:${(i * 37) % 100}%;--y:${(i * 53) % 100}%;--d:${4 + (i % 7)}s;--s:${4 + (i % 5) * 3}px"></i>`).join('')}</div>
    <header>
      <p class="menu-eyebrow">a little world made for</p>
      <h1></h1>
      <p class="menu-sub">Where would you like to go?</p>
    </header>
    <div class="menu-cards"></div>
    <footer>Use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk · on a phone, your left thumb</footer>`;
  root.querySelector('h1')!.textContent = name;
  const cards = root.querySelector('.menu-cards')!;
  for (const m of modes) {
    const a = document.createElement('a');
    a.className = 'menu-card';
    a.href = urlForMode(m.id);
    a.style.setProperty('--accent', m.accent);
    a.innerHTML = `<div class="art">${m.art}</div><div class="txt"><h2></h2><p></p><span class="go">Enter →</span></div>`;
    a.querySelector('h2')!.textContent = m.title;
    a.querySelector('p')!.textContent = m.blurb;
    cards.append(a);
  }
  document.body.append(root);
  document.body.classList.add('menu-open');
  requestAnimationFrame(() => root.classList.add('in'));
}

/** A small round button, top left, back to the menu. Shared by every mode. */
export function addMenuButton() {
  const b = document.createElement('a');
  b.className = 'menu-home';
  b.href = urlForMode(null);
  b.title = 'Back to the menu';
  b.setAttribute('aria-label', 'Back to the menu');
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5M6.5 10v8.5h11V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.append(b);
}
