/** Parameters of the region a ViewGrid should keep populated this frame. */
export interface ViewParams {
  camX: number; camZ: number;
  dirX: number; dirZ: number;   // camera forward, projected on XZ and normalised
  halfFov: number;              // horizontal half-angle in radians
  range: number;                // how far ahead to populate, in metres
  nearX: number; nearZ: number; // the girl: her surroundings stay populated whichever way she looks
  nearR: number;
  budget: number;               // max tiles to fill this frame
}

/**
 * A pool of instance slots that follows the camera's view instead of a disc around the
 * player, so the whole budget is spent on plants that are actually on screen. A 35-degree
 * half-angle covers about a fifth of a circle, so the same number of instances buys
 * several times the density in front of the player.
 *
 * The world is cut into square tiles of k x k cells. A tile entering the view claims a
 * block of k*k consecutive slots; a tile leaving gives its block back. What grows in a
 * cell is a pure function of the cell, so a tile looks identical every time it is
 * reclaimed and the meadow is stable when you walk back over it.
 *
 * Tiles are claimed nearest-first under a per-frame budget, so a fast turn refills the
 * ground near the player before the distance, and running out of tiles shows up as
 * thinning far away rather than a hole underfoot.
 */
export class ViewGrid {
  readonly count: number;
  readonly tile: number;                 // tile side in metres
  live = 0;                              // tiles currently held, for stats
  starved = 0;                           // running total of wanted tiles that found no free slot

  private held = new Map<number, number>();   // tile key -> tile index
  private tx: Int32Array;
  private tz: Int32Array;
  private used: Uint8Array;
  private free: Int32Array;
  private nFree: number;
  private outD2: Float32Array;
  private candX = new Int32Array(CAND_CAP);
  private candZ = new Int32Array(CAND_CAP);
  private candD = new Float32Array(CAND_CAP);
  private taken = new Uint8Array(CAND_CAP);
  private primed = false;

  constructor(
    readonly k: number,
    readonly cell: number,
    readonly maxTiles: number,
    /** fill slot `slot` with the plant for world cell (wx, wz) */
    private readonly fill: (wx: number, wz: number, slot: number) => void,
    /** slot is being recycled: hide it */
    private readonly clear: (slot: number) => void,
  ) {
    this.tile = k * cell;
    this.count = maxTiles * k * k;
    this.tx = new Int32Array(maxTiles);
    this.tz = new Int32Array(maxTiles);
    this.used = new Uint8Array(maxTiles);
    this.outD2 = new Float32Array(maxTiles);
    this.free = new Int32Array(maxTiles);
    for (let i = 0; i < maxTiles; i++) this.free[i] = maxTiles - 1 - i;
    this.nFree = maxTiles;
  }

  /**
   * Squared distance from the camera if the tile is inside the region, else -1.
   * The view is a convex wedge, so a tile is inside when its bounding circle is on the
   * inner side of both edges; `slack` widens the wedge so tiles are not dropped and
   * reclaimed on every small camera wobble.
   */
  private test(tx: number, tz: number, p: ViewParams, slack: number) {
    const T = this.tile, r = T * 0.7072;
    const cx = (tx + 0.5) * T, cz = (tz + 0.5) * T;
    const ndx = cx - p.nearX, ndz = cz - p.nearZ;
    const dx = cx - p.camX, dz = cz - p.camZ;
    const d2 = dx * dx + dz * dz;
    if (ndx * ndx + ndz * ndz <= (p.nearR + r) * (p.nearR + r)) return d2;
    const reach = p.range + r;
    if (d2 > reach * reach) return -1;
    if (d2 <= r * r) return d2;               // camera inside the tile
    const h = Math.min(Math.PI * 0.48, p.halfFov + slack);
    const s = Math.sin(h), c = Math.cos(h);
    // inward normals of the two wedge edges, in the XZ plane
    const nlx = p.dirX * s + p.dirZ * c, nlz = p.dirZ * s - p.dirX * c;
    const nrx = p.dirX * s - p.dirZ * c, nrz = p.dirZ * s + p.dirX * c;
    if (dx * nlx + dz * nlz < -r) return -1;
    if (dx * nrx + dz * nrz < -r) return -1;
    return d2;
  }

  private key(tx: number, tz: number) { return tz * 4194304 + tx; }

  private release(i: number) {
    const n = this.k * this.k, base = i * n;
    for (let s = 0; s < n; s++) this.clear(base + s);
    this.held.delete(this.key(this.tx[i], this.tz[i]));
    this.used[i] = 0;
    this.free[this.nFree++] = i;
  }

  /** free the held tile that is furthest outside the view; -1 if every tile is still wanted */
  private evictWorst() {
    let best = -1, bd = -1;
    for (let i = 0; i < this.maxTiles; i++) {
      if (!this.used[i] || this.outD2[i] < 0) continue;
      if (this.outD2[i] > bd) { bd = this.outD2[i]; best = i; }
    }
    if (best < 0) return -1;
    this.release(best);
    return best;
  }

  private claim(tx: number, tz: number) {
    if (this.nFree === 0 && this.evictWorst() < 0) return false;
    const i = this.free[--this.nFree];
    this.used[i] = 1; this.tx[i] = tx; this.tz[i] = tz;
    this.held.set(this.key(tx, tz), i);
    const k = this.k, base = i * k * k, ox = tx * k, oz = tz * k;
    for (let cz = 0; cz < k; cz++) for (let cx = 0; cx < k; cx++) {
      this.fill(ox + cx, oz + cz, base + cz * k + cx);
    }
    return true;
  }

  /** returns the number of tiles filled this frame */
  update(p: ViewParams) {
    const T = this.tile;
    // Tiles that have left the view are not dropped here: turning quickly would drop
    // hundreds at once and cost a visible hitch. They are marked evictable and recycled
    // one at a time as new tiles need slots, which also means turning straight back finds
    // them still populated.
    for (let i = 0; i < this.maxTiles; i++) {
      if (!this.used[i]) continue;
      const d2 = this.test(this.tx[i], this.tz[i], p, KEEP_SLACK);
      this.outD2[i] = d2 < 0 ? this.farness(this.tx[i], this.tz[i], p) : -1;
    }
    let n = 0;
    const reach = p.range + T;
    const x0 = Math.floor((p.camX - reach) / T), x1 = Math.floor((p.camX + reach) / T);
    const z0 = Math.floor((p.camZ - reach) / T), z1 = Math.floor((p.camZ + reach) / T);
    for (let tz = z0; tz <= z1 && n < CAND_CAP; tz++) {
      for (let tx = x0; tx <= x1 && n < CAND_CAP; tx++) {
        if (this.held.has(this.key(tx, tz))) continue;
        const d2 = this.test(tx, tz, p, CLAIM_SLACK);
        if (d2 < 0) continue;
        this.candX[n] = tx; this.candZ[n] = tz; this.candD[n] = d2; n++;
      }
    }
    let budget = this.primed ? p.budget : this.maxTiles;
    this.primed = true;
    let done = 0;
    if (n <= budget) {
      for (let i = 0; i < n; i++) if (this.claim(this.candX[i], this.candZ[i])) done++; else this.starved++;
    } else {
      // Nearest first, by repeated selection: `budget` is small, so this beats sorting
      // the whole candidate list on the rare frame where many tiles enter at once.
      this.taken.fill(0, 0, n);
      while (budget-- > 0) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < n; i++) if (!this.taken[i] && this.candD[i] < bd) { bd = this.candD[i]; best = i; }
        if (best < 0) break;
        this.taken[best] = 1;
        if (!this.claim(this.candX[best], this.candZ[best])) { this.starved++; break; }
        done++;
      }
    }
    this.live = this.maxTiles - this.nFree;
    return done;
  }

  /** how stale a tile is: distance from the camera, so the furthest is recycled first */
  private farness(tx: number, tz: number, p: ViewParams) {
    const T = this.tile;
    const dx = (tx + 0.5) * T - p.camX, dz = (tz + 0.5) * T - p.camZ;
    return dx * dx + dz * dz;
  }

  /** slot currently holding a world cell, or -1 if that cell is not populated */
  slotOf(cx: number, cz: number) {
    const k = this.k;
    const tx = Math.floor(cx / k), tz = Math.floor(cz / k);
    const i = this.held.get(this.key(tx, tz));
    if (i === undefined) return -1;
    return i * k * k + (cz - tz * k) * k + (cx - tx * k);
  }
}

const CAND_CAP = 4096;
const KEEP_SLACK = 0.16;    // radians of hysteresis: wider to keep than to claim
const CLAIM_SLACK = 0.07;

/** deterministic hash of a world cell -> four uncorrelated floats in [0,1) */
export function cellHash(x: number, z: number, out: Float32Array) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    out[i] = (h >>> 0) / 4294967296;
  }
  return out;
}

/** smooth value noise over world position, for clumping plants into stands and drifts */
function vh(x: number, z: number) {
  let h = Math.imul(x, 1597334677) ^ Math.imul(z, 3812015801);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
export function clumpNoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = vh(xi, zi), b = vh(xi + 1, zi), c = vh(xi, zi + 1), d = vh(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
