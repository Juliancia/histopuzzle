/**
 * solver.js – Zachłanne układanie puzzli na podstawie kompatybilności krawędzi.
 *
 * Algorytm (uproszczony „placer” z pracy Pomeranz i in., 2011):
 *   1. Startuje od kafelka, który ma najwięcej „najlepszych kumpli” (best buddies).
 *   2. W każdym kroku sprawdza wszystkie wolne pola przylegające do już ułożonej części
 *      i wszystkie nieużyte kafelki, a następnie wybiera parę (pole, kafelek) o najwyższej
 *      średniej kompatybilności z sąsiadami. Pierwszeństwo mają kafelki, które są
 *      best buddies ze wszystkimi sąsiadami.
 *   3. Ułożona część nie może wyjść poza ramkę n×n.
 * Algorytm nie zna poprawnego ułożenia – korzysta wyłącznie z pikseli na krawędziach.
 */

import { neighbourScore } from './vision.js';

const DIRECTIONS = [
  { name: 'right', dr: 0, dc: 1 },
  { name: 'left', dr: 0, dc: -1 },
  { name: 'down', dr: 1, dc: 0 },
  { name: 'up', dr: -1, dc: 0 },
];

/**
 * Wyznacza najlepszego kandydata na sąsiada każdego kafelka w każdym kierunku.
 *
 * @param {object} compat - Wynik computeCompatibility z vision.js.
 * @returns {Record<string, Int32Array>} Dla każdego kierunku: indeks najlepszego sąsiada.
 */
function bestNeighbours(compat) {
  const best = {};
  for (const { name } of DIRECTIONS) {
    best[name] = new Int32Array(compat.count);
    for (let t = 0; t < compat.count; t++) {
      let top = -1;
      let topScore = -1;
      for (let o = 0; o < compat.count; o++) {
        if (o === t) continue;
        const s = neighbourScore(compat, t, o, name);
        if (s > topScore) {
          topScore = s;
          top = o;
        }
      }
      best[name][t] = top;
    }
  }
  return best;
}

/**
 * Układa puzzle wyłącznie na podstawie kompatybilności krawędzi.
 *
 * @param {object} compat - Wynik computeCompatibility (zawiera n i count).
 * @returns {{slots: Int32Array, order: Array<{tile: number, slot: number}>, correct: number,
 *   correctNeighbours: number, totalNeighbours: number, ms: number}}
 *   slots[pole] = kafelek, kolejność układania (do animacji), liczba kafelków na właściwym
 *   miejscu, liczba poprawnych par sąsiadów i czas obliczeń.
 */
export function solvePuzzle(compat) {
  const start = performance.now();
  const { n, count } = compat;
  const best = bestNeighbours(compat);
  const opposite = { right: 'left', left: 'right', down: 'up', up: 'down' };
  const isBuddy = (t, o, dir) => best[dir][t] === o && best[opposite[dir]][o] === t;

  // Kafelek startowy: najwięcej obustronnych dopasowań, remisy rozstrzyga suma kompatybilności.
  let seed = 0;
  let seedKey = -1;
  for (let t = 0; t < count; t++) {
    let buddies = 0;
    let sum = 0;
    for (const { name } of DIRECTIONS) {
      const o = best[name][t];
      if (isBuddy(t, o, name)) buddies++;
      sum += neighbourScore(compat, t, o, name);
    }
    const key = buddies * 10 + sum;
    if (key > seedKey) {
      seedKey = key;
      seed = t;
    }
  }

  const grid = new Map();
  const key = (r, c) => `${r},${c}`;
  const used = new Uint8Array(count);
  const placed = [{ tile: seed, r: 0, c: 0 }];
  grid.set(key(0, 0), seed);
  used[seed] = 1;
  const bounds = { minR: 0, maxR: 0, minC: 0, maxC: 0 };

  while (placed.length < count) {
    let bestMove = null;
    const visited = new Set();
    for (const p of placed) {
      for (const d of DIRECTIONS) {
        const r = p.r + d.dr;
        const c = p.c + d.dc;
        const k = key(r, c);
        if (grid.has(k) || visited.has(k)) continue;
        visited.add(k);
        if (Math.max(bounds.maxR, r) - Math.min(bounds.minR, r) >= n) continue;
        if (Math.max(bounds.maxC, c) - Math.min(bounds.minC, c) >= n) continue;

        // Sąsiedzi wolnego pola: kierunek opisuje, gdzie sąsiad leży względem pola.
        const neighbours = [];
        for (const nd of DIRECTIONS) {
          const t = grid.get(key(r + nd.dr, c + nd.dc));
          if (t !== undefined) neighbours.push({ tile: t, dir: nd.name });
        }
        for (let cand = 0; cand < count; cand++) {
          if (used[cand]) continue;
          let sum = 0;
          let buddies = 0;
          for (const nb of neighbours) {
            sum += neighbourScore(compat, cand, nb.tile, nb.dir);
            if (isBuddy(cand, nb.tile, nb.dir)) buddies++;
          }
          const allBuddies = buddies === neighbours.length ? 1 : 0;
          const score = allBuddies * 10 + buddies + sum / neighbours.length;
          if (!bestMove || score > bestMove.score) bestMove = { score, tile: cand, r, c };
        }
      }
    }
    grid.set(key(bestMove.r, bestMove.c), bestMove.tile);
    used[bestMove.tile] = 1;
    placed.push({ tile: bestMove.tile, r: bestMove.r, c: bestMove.c });
    bounds.minR = Math.min(bounds.minR, bestMove.r);
    bounds.maxR = Math.max(bounds.maxR, bestMove.r);
    bounds.minC = Math.min(bounds.minC, bestMove.c);
    bounds.maxC = Math.max(bounds.maxC, bestMove.c);
  }

  const slots = new Int32Array(count);
  const order = placed.map((p) => {
    const slot = (p.r - bounds.minR) * n + (p.c - bounds.minC);
    slots[slot] = p.tile;
    return { tile: p.tile, slot };
  });
  const ms = performance.now() - start;
  return { slots, order, ms, ...scoreArrangement(slots, n) };
}

/**
 * Ocenia ułożenie: ile kafelków leży na swoim miejscu i ile par sąsiadów jest poprawnych.
 *
 * Druga miara jest sprawiedliwsza, gdy całość jest poprawna, ale przesunięta.
 *
 * @param {ArrayLike<number>} slots - slots[pole] = kafelek.
 * @param {number} n - Liczba kafelków w wierszu.
 * @returns {{correct: number, correctNeighbours: number, totalNeighbours: number}} Wyniki oceny.
 */
export function scoreArrangement(slots, n) {
  let correct = 0;
  let correctNeighbours = 0;
  for (let s = 0; s < n * n; s++) {
    if (slots[s] === s) correct++;
    const r = Math.floor(s / n);
    const c = s % n;
    if (c < n - 1 && slots[s + 1] === slots[s] + 1 && slots[s] % n !== n - 1) correctNeighbours++;
    if (r < n - 1 && slots[s + n] === slots[s] + n) correctNeighbours++;
  }
  return { correct, correctNeighbours, totalNeighbours: 2 * n * (n - 1) };
}
