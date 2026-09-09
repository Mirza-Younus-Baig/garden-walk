import * as THREE from 'three';
import type { DayNight } from '../world/daynight';

/**
 * A compass that answers one question: which way do I turn to see the sun or the moon?
 *
 * The dial is a top-down map of the sky drawn in camera-relative terms. Straight up on the
 * dial is whichever way the camera is looking, the shaded wedge is what the lens actually
 * covers, the rim is the horizon and the centre is directly overhead — so a body drawn
 * inside the wedge is on screen right now, one drawn off to the right is found by turning
 * right, and one drawn near the centre is overhead and found by looking up. Below the
 * horizon it is pinned to the rim and hollowed out, which keeps the bearing readable while
 * saying plainly that there is nothing to see there yet.
 *
 * The world's sun rises towards +X and sets towards -X, so +X is east and -Z is north, the
 * usual right-handed Y-up map orientation. Every bearing below is measured clockwise from
 * north in that frame.
 */

/** the dial's own coordinate space; RENDER_PX is only how big it is drawn on screen */
const SIZE = 100;
const RENDER_PX = 112;
const C = SIZE / 2;
const DISC = 46;   // the dial's own backdrop; everything else sits inside it
const RING = 38;   // cardinal letters
const WEDGE = 30;  // the field-of-view wedge
const RIM = 30;    // horizon; altitude scales inwards from here to the centre

const NS = 'http://www.w3.org/2000/svg';
const node = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
};

const WRAP_CSS = 'position:fixed;right:12px;bottom:12px;z-index:9;display:flex;flex-direction:column;' +
  'align-items:center;gap:3px;pointer-events:none;user-select:none;' +
  'filter:drop-shadow(0 1px 3px rgba(0,0,0,.65))';
const HINT_CSS = 'font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;letter-spacing:.4px;' +
  'text-shadow:0 1px 3px rgba(0,0,0,.75)';

const DEG = 180 / Math.PI;
const CARDINALS = [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const;

/** clockwise from north, for a direction in the XZ plane */
const bearingOf = (x: number, z: number) => Math.atan2(x, -z);
/** shortest signed angle from `a` to `b`, in radians */
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Altitude maps to radius: on the horizon a body sits on the rim, overhead it sits at the
 * centre. Below the horizon it stays on the rim so the bearing is still readable.
 */
const radiusFor = (elevation: number) => {
  const alt = Math.asin(THREE.MathUtils.clamp(elevation, -1, 1));
  return alt <= 0 ? RIM : RIM * (1 - alt / (Math.PI / 2));
};

const polar = (angle: number, r: number) => [C + Math.sin(angle) * r, C - Math.cos(angle) * r] as const;

export function createCompass(dayNight: DayNight) {
  const wrap = document.createElement('div');
  wrap.id = 'compass';
  wrap.style.cssText = WRAP_CSS;

  const svg = node('svg', { width: RENDER_PX, height: RENDER_PX, viewBox: `0 0 ${SIZE} ${SIZE}` });
  // The dial is read against a meadow in full sun as often as against a night sky, so it
  // carries its own ground: a dark disc big enough to sit under the lettering too, since a
  // cardinal letter over sunlit daisies is not legible at any weight.
  svg.append(
    node('circle', { cx: C, cy: C, r: DISC, fill: 'rgba(5,9,15,.66)' }),
    node('circle', { cx: C, cy: C, r: DISC, fill: 'none', stroke: 'rgba(255,255,255,.30)', 'stroke-width': 1 }),
    node('circle', { cx: C, cy: C, r: RIM, fill: 'none', stroke: 'rgba(255,255,255,.30)', 'stroke-width': 1 }),
  );

  // what the camera can actually see, so "is it on screen" needs no arithmetic from the viewer
  const wedge = node('path', { id: 'compass-wedge', d: '', fill: 'rgba(255,255,255,.17)' });
  svg.append(wedge);

  // the rose turns under a fixed heading marker, the way a real compass card does
  const rose = node('g', { id: 'compass-rose', transform: `rotate(0 ${C} ${C})` });
  for (const [label, deg] of CARDINALS) {
    const [x, y] = polar(deg / DEG, RING);
    const t = node('text', {
      x, y, 'data-cardinal': label, fill: label === 'N' ? '#ffd9a0' : 'rgba(255,255,255,.92)',
      'font-size': label === 'N' ? 11.5 : 10, 'font-family': 'ui-monospace,Menlo,monospace',
      'font-weight': 700, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    });
    t.textContent = label;
    rose.append(t);
    const [ix, iy] = polar(deg / DEG, RIM);
    const [ox, oy] = polar(deg / DEG, RIM + 3.5);
    rose.append(node('line', { x1: ix, y1: iy, x2: ox, y2: oy, stroke: 'rgba(255,255,255,.6)', 'stroke-width': 1 }));
  }
  svg.append(rose);

  // a spoke to whichever body is worth watching, so the turn direction reads at a glance
  const spoke = node('line', { x1: C, y1: C, x2: C, y2: C, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.2 });
  svg.append(spoke);

  const sun = node('circle', { id: 'compass-sun', cx: C, cy: C, r: 5.5, fill: '#ffc861', stroke: '#ffe4ab', 'stroke-width': 1.2 });
  const moon = node('circle', { id: 'compass-moon', cx: C, cy: C, r: 4.5, fill: '#e6ecf8', stroke: '#ffffff', 'stroke-width': 1.2 });
  svg.append(sun, moon);

  // fixed heading marker at the top: the direction the camera is pointing
  svg.append(node('path', { d: `M ${C - 4.5} 2.5 L ${C + 4.5} 2.5 L ${C} 10.5 Z`, fill: '#fff' }));

  const hint = document.createElement('div');
  hint.id = 'compass-hint';
  hint.style.cssText = HINT_CSS;

  wrap.append(svg, hint);
  document.body.appendChild(wrap);

  const fwd = new THREE.Vector3();
  let shownHint = '';
  let shownWedge = -1;
  let shownRose = 1e3;

  const place = (marker: SVGCircleElement, relAngle: number, elevation: number) => {
    const [x, y] = polar(relAngle, radiusFor(elevation));
    marker.setAttribute('cx', String(x));
    marker.setAttribute('cy', String(y));
    // below the horizon: hollow and dim, so the bearing survives but "nothing to see" is plain
    const up = elevation > 0;
    marker.setAttribute('fill-opacity', up ? '1' : '0');
    marker.setAttribute('opacity', up ? '1' : '0.42');
    return [x, y] as const;
  };

  return (camera: THREE.Camera): void => {
    camera.getWorldDirection(fwd);
    const heading = bearingOf(fwd.x, fwd.z);

    const roseDeg = -heading * DEG;
    if (Math.abs(roseDeg - shownRose) > 0.15) {
      rose.setAttribute('transform', `rotate(${roseDeg.toFixed(2)} ${C} ${C})`);
      shownRose = roseDeg;
    }

    const d = dayNight;
    const sunRel = wrapPi(bearingOf(d.sunDir.x, d.sunDir.z) - heading);
    const moonRel = wrapPi(bearingOf(d.moonDir.x, d.moonDir.z) - heading);
    const sunAt = place(sun, sunRel, d.sunDir.y);
    const moonAt = place(moon, moonRel, d.moonDir.y);

    // whichever is higher is the one worth turning towards
    const sunLeads = d.sunDir.y >= d.moonDir.y;
    const [tx, ty] = sunLeads ? sunAt : moonAt;
    spoke.setAttribute('x2', String(tx));
    spoke.setAttribute('y2', String(ty));

    const half = camera instanceof THREE.PerspectiveCamera
      ? Math.atan(Math.tan((camera.fov / 2) / DEG) * camera.aspect)
      : 0.6;
    if (Math.abs(half - shownWedge) > 0.01) {
      const [ax, ay] = polar(-half, WEDGE);
      const [bx, by] = polar(half, WEDGE);
      wedge.setAttribute('d', `M ${C} ${C} L ${ax.toFixed(2)} ${ay.toFixed(2)} ` +
        `A ${WEDGE} ${WEDGE} 0 0 1 ${bx.toFixed(2)} ${by.toFixed(2)} Z`);
      shownWedge = half;
    }

    // The hint is a turn instruction, so it talks about bearing, not about whether the disc
    // has cleared the top of the frame: "ahead" means the body is within the wedge. Once it
    // is high enough that the bearing stops meaning anything, say so instead.
    const name = sunLeads ? 'Sun' : 'Moon';
    const rel = sunLeads ? sunRel : moonRel;
    const alt = Math.asin(THREE.MathUtils.clamp(sunLeads ? d.sunDir.y : d.moonDir.y, -1, 1)) * DEG;
    const off = Math.abs(rel);
    const deg = Math.round(off * DEG);
    const text = alt > 55 ? `${name} overhead`
      : off <= half ? `${name} ahead`
      : deg >= 172 ? `${name} behind you`
      : `${name} ${deg}\u00b0 ${rel > 0 ? 'right' : 'left'}`;
    if (text !== shownHint) { shownHint = text; hint.textContent = text; }
  };
}
