// Far-LOD index buffers (meshoptimizer's simplifier, vendor/meshopt_simplifier.module.js), shared by the people
// (chars.js) and the Meshy cars (vehicles.js). The simplified copy reuses the original vertices; only the index
// buffer is new.
//
// Meshy meshes split vertices along every UV seam (their atlases have hundreds of islands). Simplifying that as-is
// opens cracks along the seams, so the mesh is welded by position first, simplified, and each output corner is
// mapped back to the original vertex at that position whose UV is closest to the triangle's first corner (so a
// triangle keeps to one island of the texture).
import { MeshoptSimplifier } from "../vendor/meshopt_simplifier.module.js";

export const lodReady = MeshoptSimplifier.supported ? MeshoptSimplifier.ready : Promise.resolve();
export const lodSupported = () => !!MeshoptSimplifier.supported;

// The weld for one vertex set (positions xyz, uv): reuse it for every index range of the same geometry.
export function weld(pos, uv) {
  const nv = pos.length / 3, key = new Map(), canon = new Uint32Array(nv), dups = [];
  for (let v = 0; v < nv; v++) {
    const k = Math.round(pos[v * 3] * 1e3) + "," + Math.round(pos[v * 3 + 1] * 1e3) + "," + Math.round(pos[v * 3 + 2] * 1e3);
    let c = key.get(k);
    if (c === undefined) { c = v; key.set(k, v); dups[v] = [v]; } else dups[c].push(v);
    canon[v] = c;
  }
  return { pos, uv, canon, dups };
}

// index[s .. s+n) simplified to about `ratio` of its triangles (stopping early if the error passes `err`, a
// fraction of the mesh's size). Returns a plain array of original vertex indices.
//
// 2026-11-05 (user: "patched look at a distance, goes away as you near them"): the weld-and-remap below put ~30% of
// a Meshy body's far triangles across two unrelated texture islands (Mixamo stock bodies ~1%). meshoptimizer already
// finds UV seams itself (vertices sharing a position) and keeps them closed, so the split mesh is simplified as-is:
// 0% stretched, no extra cracks, about the same triangle count (Node check, dre/nia/g1_suit/crew1/Ch02).
// ?lodweld=1 brings the old weld method back for comparing.
const OLD_WELD = typeof location !== "undefined" && /[?&]lodweld=1/.test(location.search);
export function simplifyRange(Wd, index, s, n, ratio, err) {
  const { pos, uv, canon, dups } = Wd;
  const target = Math.max(3, Math.floor(n * ratio / 3) * 3);
  if (!OLD_WELD) {
    const [res] = MeshoptSimplifier.simplify(new Uint32Array(index.subarray(s, s + n)), pos, 3, target, err, []);
    return Array.from(res);
  }
  const src = new Uint32Array(n);
  for (let i = 0; i < n; i++) src[i] = canon[index[s + i]];
  const [res] = MeshoptSimplifier.simplify(src, pos, 3, target, err, []);
  const out = new Array(res.length);
  for (let t = 0; t < res.length; t += 3) {
    const a = dups[res[t]][0];
    out[t] = a;
    if (!uv) { out[t + 1] = dups[res[t + 1]][0]; out[t + 2] = dups[res[t + 2]][0]; continue; }
    const au = uv[a * 2], av = uv[a * 2 + 1];
    for (let j = 1; j < 3; j++) {
      const cand = dups[res[t + j]];
      let best = cand[0], bd = Infinity;
      for (const c of cand) { const d = (uv[c * 2] - au) ** 2 + (uv[c * 2 + 1] - av) ** 2; if (d < bd) { bd = d; best = c; } }
      out[t + j] = best;
    }
  }
  return out;
}
