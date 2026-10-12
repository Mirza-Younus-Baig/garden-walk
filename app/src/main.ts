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

const mode = modeFromUrl(location.search);
if (!mode) {
  // the garden's loading screen and key hint live in index.html; the menu has no use for
  // them (and the garden's CSS would show the loading screen despite its `hidden`)
  document.getElementById('loading')?.remove();
  document.getElementById('hint')?.remove();
  showMenu(MODES);
} else {
  addMenuButton();
  if (mode === 'garden') {
    // the garden's own loading screen lives in index.html
    document.getElementById('loading')!.hidden = false;
    import('./modes/garden/index');
  } else {
    import('./modes/birthday/index');
  }
}
