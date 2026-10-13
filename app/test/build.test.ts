import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { std, phys, own, mergeStatic } from '../src/modes/birthday/room/build';

describe('shared materials', () => {
  it('returns the same material for the same look', () => {
    expect(std('#c0ffee', 0.4)).toBe(std('#c0ffee', 0.4));
    expect(phys('#c0ffee', 0.4, { sheen: 0.3, sheenColor: new THREE.Color('#ffffff') }))
      .toBe(phys('#c0ffee', 0.4, { sheen: 0.3, sheenColor: new THREE.Color('#ffffff') }));
  });

  it('tells looks apart, including by texture and by kind', () => {
    const a = new THREE.Texture(), b = new THREE.Texture();
    expect(std('#c0ffee', 0.4)).not.toBe(std('#c0ffee', 0.5));
    expect(std('#ffffff', 0.5, 0, { map: a })).not.toBe(std('#ffffff', 0.5, 0, { map: b }));
    expect(std('#ffffff', 0.5, 0, { map: a })).toBe(std('#ffffff', 0.5, 0, { map: a }));
    expect(std('#abcdef', 0.5)).not.toBe(phys('#abcdef', 0.5) as THREE.Material);
  });

  it('own() gives a separate copy that can be changed alone', () => {
    const shared = phys('#123456', 0.3, { emissive: new THREE.Color('#ff0000'), emissiveIntensity: 1 });
    const mine = own(shared);
    expect(mine).not.toBe(shared);
    mine.emissiveIntensity = 0;
    expect(shared.emissiveIntensity).toBe(1);
  });
});

describe('mergeStatic', () => {
  const box = () => new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const worldBox = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

  it('merges meshes sharing a material, keeping where everything is', () => {
    const root = new THREE.Group();
    root.position.set(1, 2, 3); root.rotation.y = 0.7;
    const m1 = std('#101010', 0.5), m2 = std('#202020', 0.5);
    const sub = new THREE.Group(); sub.position.set(0.5, 0, 0); sub.scale.setScalar(2); root.add(sub);
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(box(), i % 2 ? m1 : m2); m.position.set(i * 0.3, 0, 0); m.castShadow = true; sub.add(m); }
    const before = worldBox(root);
    const r = mergeStatic(root);
    expect(r).toEqual({ before: 4, after: 2 });
    expect(root.children).toHaveLength(2);                      // the emptied group is gone
    const after = worldBox(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-5);
    for (const c of root.children) expect((c as THREE.Mesh).castShadow).toBe(true);
  });

  it('keeps shadow settings apart and leaves kept, instanced and hidden meshes alone', () => {
    const root = new THREE.Group();
    const mat = std('#303030', 0.5);
    const a = new THREE.Mesh(box(), mat), b = new THREE.Mesh(box(), mat), c = new THREE.Mesh(box(), mat);
    a.castShadow = true; b.castShadow = false; c.castShadow = false;
    const keep = new THREE.Group(); keep.add(new THREE.Mesh(box(), mat), new THREE.Mesh(box(), mat));
    const inst = new THREE.InstancedMesh(box(), mat, 3);
    const hidden = new THREE.Mesh(box(), mat); hidden.visible = false;
    root.add(a, b, c, keep, inst, hidden);
    mergeStatic(root, [keep]);
    expect(root.children).toContain(a);                         // alone in its group: untouched
    expect(root.children).not.toContain(b);                     // b and c merged
    expect(root.children).toContain(keep);
    expect(keep.children).toHaveLength(2);
    expect(root.children).toContain(inst);
    expect(root.children).toContain(hidden);
    expect(root.children).toHaveLength(5);
  });
});
