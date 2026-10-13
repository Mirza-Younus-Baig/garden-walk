/**
 * Entry point: picks a mode from the URL and loads only that mode's code.
 *
 *   /                  the menu
 *   /?mode=garden      the flower garden
 *   /?mode=birthday    the birthday room
 *
 * Each mode is its own chunk, so the garden never downloads the room and vice versa.
 * Switching modes is a page navigation: every mode starts from a clean page and GPU,
 * and the browser cache keeps shared assets (the girl) from downloading twice.
 */
import { MODES, modeFromUrl, showMenu, addMenuButton } from './menu/menu';

/**
 * A mode's code failed to load: most often a tab opened before a redeploy asking for a
 * chunk that no longer exists, or a dropped connection. Say so, and offer a reload.
 */
function loadFailed(err: unknown) {
  console.error(err);
  document.getElementById('loading')?.remove();
  const box = document.createElement('div');
  box.className = 'load-failed';
  box.setAttribute('role', 'alert');
  box.innerHTML = '<p>This page could not finish loading.</p><button type="button">Reload</button>';
  box.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.append(box);
}

const mode = modeFromUrl(location.search);
// The garden's loading screen and key hint live in index.html. Only the garden uses them
// (and the garden's CSS would show the loading screen despite its `hidden`).
if (mode !== 'garden') {
  document.getElementById('loading')?.remove();
  document.getElementById('hint')?.remove();
}
if (!mode) {
  showMenu(MODES);
} else {
  addMenuButton();
  if (mode === 'garden') {
    document.getElementById('loading')!.hidden = false;
    import('./modes/garden/index').catch(loadFailed);
  } else {
    import('./modes/birthday/index').catch(loadFailed);
  }
}
