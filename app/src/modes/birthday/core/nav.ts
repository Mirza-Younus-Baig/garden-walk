/**
 * Where she can stand in the room, on the floor plane (x, z). Pure maths, no three.js, so
 * every rule here is unit-tested.
 *
 *  - `resolve` pushes a point out of every solid thing, so she slides along the sofa
 *    instead of stopping dead or passing through it.
 *  - `findPath` walks round furniture on a grid, then pulls the path taut, so a tap on the
 *    far side of the table sends her round it on a natural line.
 */

export interface Vec2 { x: number; z: number }

/** an oriented box: centre, half extents, and a turn about the vertical (radians) */
export interface BoxCollider { kind: 'box'; cx: number; cz: number; hx: number; hz: number; rot: number }
export interface CircleCollider { kind: 'circle'; cx: number; cz: number; r: number }
export type Collider = BoxCollider | CircleCollider;

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export const box = (cx: number, cz: number, w: number, d: number, rot = 0): BoxCollider =>
  ({ kind: 'box', cx, cz, hx: w / 2, hz: d / 2, rot });
export const circle = (cx: number, cz: number, r: number): CircleCollider => ({ kind: 'circle', cx, cz, r });

/**
 * Smallest push that takes a disc of radius `r` at p clear of the collider, or null when
 * it is already clear.
 */
export function separation(c: Collider, px: number, pz: number, r: number): Vec2 | null {
  if (c.kind === 'circle') {
    const dx = px - c.cx, dz = pz - c.cz;
    const d = Math.hypot(dx, dz), need = c.r + r;
    if (d >= need) return null;
    if (d < 1e-9) return { x: need, z: 0 };
    const k = (need - d) / d;
    return { x: dx * k, z: dz * k };
  }
  // into the box's own frame
  const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
  const dx = px - c.cx, dz = pz - c.cz;
  const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
  const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
  let ox: number, oz: number;
  const ex = lx - qx, ez = lz - qz;
  const d = Math.hypot(ex, ez);
  if (d > 1e-9) {
    if (d >= r) return null;
    const k = (r - d) / d;
    ox = ex * k; oz = ez * k;
  } else {
    // centre inside the box: leave by the nearest face
    const px2 = c.hx - Math.abs(lx), pz2 = c.hz - Math.abs(lz);
    if (px2 < pz2) { ox = Math.sign(lx || 1) * (px2 + r); oz = 0; }
    else { ox = 0; oz = Math.sign(lz || 1) * (pz2 + r); }
  }
  // back to the world frame
  return { x: ox * cos + oz * sin, z: -ox * sin + oz * cos };
}

export class NavWorld {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private grid: Uint8Array;   // 1 = blocked for a disc of `radius`

  constructor(readonly bounds: Bounds, readonly colliders: Collider[], readonly radius: number, cell = 0.1) {
    this.cell = cell;
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.grid = new Uint8Array(this.cols * this.rows);
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      const p = this.centre(i, j);
      this.grid[j * this.cols + i] = this.blocked(p.x, p.z) ? 1 : 0;
    }
  }

  /** true when a disc of `radius` (+ margin) at p overlaps a wall or a collider */
  blocked(x: number, z: number, margin = 0): boolean {
    const r = this.radius + margin, b = this.bounds;
    if (x < b.minX + r || x > b.maxX - r || z < b.minZ + r || z > b.maxZ - r) return true;
    for (const c of this.colliders) if (separation(c, x, z, r)) return true;
    return false;
  }

  /**
   * Push p clear of everything, in place. A few passes, because clearing one collider can
   * push into a neighbour (the gap between the sofa and the table).
   */
  resolve(p: Vec2): void {
    const r = this.radius, b = this.bounds;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const c of this.colliders) {
        const s = separation(c, p.x, p.z, r);
        if (s) { p.x += s.x; p.z += s.z; moved = true; }
      }
      const x = Math.min(Math.max(p.x, b.minX + r), b.maxX - r);
      const z = Math.min(Math.max(p.z, b.minZ + r), b.maxZ - r);
      if (x !== p.x || z !== p.z) { p.x = x; p.z = z; moved = true; }
      if (!moved) return;
    }
  }

  private centre(i: number, j: number): Vec2 {
    return { x: this.bounds.minX + (i + 0.5) * this.cell, z: this.bounds.minZ + (j + 0.5) * this.cell };
  }
  private cellOf(p: Vec2): [number, number] {
    return [
      Math.min(this.cols - 1, Math.max(0, Math.floor((p.x - this.bounds.minX) / this.cell))),
      Math.min(this.rows - 1, Math.max(0, Math.floor((p.z - this.bounds.minZ) / this.cell))),
    ];
  }
  private free(i: number, j: number) {
    return i >= 0 && j >= 0 && i < this.cols && j < this.rows && this.grid[j * this.cols + i] === 0;
  }

  /** the nearest free cell to p (breadth-first), or null if the room is solid */
  private nearestFree(p: Vec2): [number, number] | null {
    const [si, sj] = this.cellOf(p);
    if (this.free(si, sj)) return [si, sj];
    for (let ring = 1; ring < Math.max(this.cols, this.rows); ring++) {
      let best: [number, number] | null = null, bestD = Infinity;
      for (let j = sj - ring; j <= sj + ring; j++) for (let i = si - ring; i <= si + ring; i++) {
        if (Math.max(Math.abs(i - si), Math.abs(j - sj)) !== ring || !this.free(i, j)) continue;
        const c = this.centre(i, j), d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
        if (d < bestD) { bestD = d; best = [i, j]; }
      }
      if (best) return best;
    }
    return null;
  }

  /** straight line from a to b stays clear (sampled at a third of a cell) */
  lineClear(a: Vec2, b: Vec2): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / (this.cell / 3)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (this.blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, -1e-3)) return false;
    }
    return true;
  }

  /**
   * A path from `from` to `to` as waypoints, excluding the start. If `to` itself is
   * blocked the path ends at the nearest free spot. Null if there is no way at all.
   */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    if (!this.blocked(to.x, to.z, -1e-3) && this.lineClear(from, to)) return [{ ...to }];
    const s = this.nearestFree(from), g = this.nearestFree(to);
    if (!s || !g) return null;
    const N = this.cols * this.rows;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open = new MinHeap();
    const idx = (i: number, j: number) => j * this.cols + i;
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - g[0]), dz = Math.abs(j - g[1]);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);   // octile
    };
    const start = idx(s[0], s[1]), goal = idx(g[0], g[1]);
    gScore[start] = 0; open.push(start, h(s[0], s[1]));
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % this.cols, cj = (cur / this.cols) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.free(ni, nj)) continue;
        // no corner cutting past a blocked cell
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;
        const n = idx(ni, nj);
        const t = gScore[cur] + (di && dj ? Math.SQRT2 : 1);
        if (t < gScore[n]) { gScore[n] = t; came[n] = cur; open.push(n, t + h(ni, nj)); }
      }
    }
    if (start !== goal && came[goal] < 0) return null;
    const cells: Vec2[] = [];
    for (let c = goal; c !== -1 && c !== start; c = came[c]) cells.push(this.centre(c % this.cols, (c / this.cols) | 0));
    cells.reverse();
    const goalPt = this.blocked(to.x, to.z, -1e-3) ? cells[cells.length - 1] ?? this.centre(g[0], g[1]) : { ...to };
    if (cells.length) cells[cells.length - 1] = goalPt; else cells.push(goalPt);
    // string pulling: keep only the waypoints the straight line cannot skip
    const out: Vec2[] = [];
    let anchor = from;
    for (let k = 0; k < cells.length; k++) {
      const next = cells[k + 1];
      if (next && this.lineClear(anchor, next)) continue;
      out.push(cells[k]); anchor = cells[k];
    }
    return out;
  }
}

/** binary min-heap of (id, priority) */
class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, p: number) {
    const ids = this.ids, pri = this.pri;
    let i = ids.length; ids.push(id); pri.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      ids[i] = ids[up]; pri[i] = pri[up]; i = up;
    }
    ids[i] = id; pri[i] = p;
  }
  pop(): number {
    const ids = this.ids, pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!, lastP = pri.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        if (l >= ids.length) break;
        const c = r < ids.length && pri[r] < pri[l] ? r : l;
        if (pri[c] >= lastP) break;
        ids[i] = ids[c]; pri[i] = pri[c]; i = c;
      }
      ids[i] = lastId; pri[i] = lastP;
    }
    return top;
  }
}
