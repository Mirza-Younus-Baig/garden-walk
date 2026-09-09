import type { DayNight } from '../world/daynight';
import { DAY_CYCLE_DURATION_MS } from '../world/daynight';

const CLOCK_CSS = 'position:fixed;top:10px;right:12px;z-index:9;font:500 15px/1 ui-monospace,SFMono-Regular,Menlo,monospace;' +
  'color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.65);letter-spacing:.5px;pointer-events:none;user-select:none';
const PANEL_CSS = 'position:fixed;top:34px;right:12px;z-index:9;display:flex;flex-direction:column;gap:4px;' +
  'align-items:flex-end;font:12px system-ui,sans-serif';
const ROW_CSS = 'display:flex;gap:4px';
const BTN_CSS = 'appearance:none;border:0;border-radius:5px;padding:3px 7px;cursor:pointer;' +
  'background:rgba(0,0,0,.45);color:#fff;font:inherit';

const SPEEDS = [1, 2, 5] as const;
const JUMPS = [['Sunrise', 6], ['Noon', 12], ['Sunset', 18], ['Midnight', 0]] as const;

/**
 * Clock readout, plus development controls behind `?dev`. The readout is rewritten only
 * when the displayed minute actually changes, so the render loop touches the DOM about
 * four times a second instead of every frame.
 */
export function createTimeUI(dayNight: DayNight, dev: boolean, showClock = true) {
  if (!showClock && !dev) return () => {};
  const clock = document.createElement('div');
  clock.style.cssText = CLOCK_CSS;
  document.body.appendChild(clock);
  let shown = '';

  if (dev) buildPanel(dayNight);

  return (): void => {
    const text = dayNight.formatTime();
    if (text !== shown) {
      shown = text;
      clock.textContent = text;
    }
  };
}

function buildPanel(dayNight: DayNight) {
  const panel = document.createElement('div');
  panel.style.cssText = PANEL_CSS;

  const button = (label: string, action: string, value = '') => {
    const b = document.createElement('button');
    b.style.cssText = BTN_CSS;
    b.textContent = label;
    b.dataset.action = action;
    b.dataset.value = value;
    return b;
  };

  const playPause = button('Pause', 'toggle');
  const transport = document.createElement('div');
  transport.style.cssText = ROW_CSS;
  transport.append(playPause, button('Reset', 'reset'));

  const speeds = document.createElement('div');
  speeds.style.cssText = ROW_CSS;
  for (const s of SPEEDS) speeds.append(button(`×${s}`, 'speed', String(s)));

  const jumps = document.createElement('div');
  jumps.style.cssText = ROW_CSS;
  for (const [label, hour] of JUMPS) jumps.append(button(label, 'hour', String(hour)));

  panel.append(transport, speeds, jumps);

  // one delegated listener for the whole panel, so nothing accumulates per button
  panel.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button');
    if (!target) return;
    const { action, value } = target.dataset;
    if (action === 'toggle') {
      dayNight.clock.setPaused(!dayNight.clock.paused);
      playPause.textContent = dayNight.clock.paused ? 'Play' : 'Pause';
    } else if (action === 'reset') {
      dayNight.clock.setCycleMs(DAY_CYCLE_DURATION_MS);
      dayNight.clock.reset();
      playPause.textContent = 'Pause';
    } else if (action === 'speed') {
      dayNight.clock.setSpeed(Number(value));
    } else if (action === 'hour') {
      dayNight.clock.setHour(Number(value));
    }
  });

  document.body.appendChild(panel);
}
