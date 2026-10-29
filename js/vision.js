/**
 * vision.js – „Oczy komputera”: jak algorytm porównuje kafelki.
 *
 * Moduł zawiera trzy elementy:
 *   1. Wyciąganie pasków pikseli z krawędzi kafelków i przeliczenie ich do przestrzeni CIE Lab,
 *      w której odległość między kolorami lepiej odpowiada temu, jak różnicę widzi człowiek.
 *   2. Miarę niepodobieństwa krawędzi opartą na predykcji (Pomeranz, Shemesh, Ben-Shahar, 2011):
 *      na podstawie dwóch ostatnich kolumn kafelka A przewidujemy, jak powinna wyglądać pierwsza
 *      kolumna sąsiada B, i mierzymy błąd tej przepowiedni.
 *   3. Dekonwolucję kolorów H&E (Ruifrok & Johnston, 2001), która rozdziela obraz na ilość
 *      hematoksyliny i eozyny w każdym pikselu.
 */

/** Kierunki sąsiedztwa: 'LR' – B leży na prawo od A, 'TB' – B leży pod A. */
export const RELATIONS = ['LR', 'TB'];

/** Wykładnik normy Lp (p < 1 zmniejsza wpływ pojedynczych, bardzo odstających pikseli). */
const P_NORM = 0.3;

/** Ostrość funkcji pewności: im większa, tym wyraźniej odstaje najlepszy kandydat. */
const SHARPNESS = 8;

/**
 * Przelicza kolor sRGB (0–255) na CIE Lab (iluminant D65).
 *
 * @param {number} r - Składowa czerwona.
 * @param {number} g - Składowa zielona.
 * @param {number} b - Składowa niebieska.
 * @returns {[number, number, number]} Współrzędne [L, a, b].
 */
export function rgbToLab(r, g, b) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Wycina z obrazu paski krawędziowe wszystkich kafelków siatki n×n.
 *
 * Dla każdego kafelka zapamiętujemy po dwa skrajne wiersze/kolumny z każdej strony,
 * bo miara predykcyjna potrzebuje zarówno krawędzi, jak i jej „gradientu”.
 *
 * @param {HTMLCanvasElement} canvas - Kwadratowy obraz źródłowy (ułożony poprawnie).
 * @param {number} n - Liczba kafelków w wierszu.
 * @returns {{n: number, tileSize: number, edges: Array<Record<string, Float32Array>>}}
 *   Paski w przestrzeni Lab; klucze: right1/right2, left1/left2, top1/top2, bottom1/bottom2
 *   (1 = skrajny, 2 = przedostatni).
 */
export function extractEdges(canvas, n) {
  const tileSize = Math.floor(canvas.width / n);
  const { data, width } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const lab = (x, y, out, offset) => {
    const i = (y * width + x) * 4;
    const [L, A, B] = rgbToLab(data[i], data[i + 1], data[i + 2]);
    out[offset] = L;
    out[offset + 1] = A;
    out[offset + 2] = B;
  };
  const edges = [];
  for (let tile = 0; tile < n * n; tile++) {
    const x0 = (tile % n) * tileSize;
    const y0 = Math.floor(tile / n) * tileSize;
    const strip = () => new Float32Array(tileSize * 3);
    const e = {
      left1: strip(), left2: strip(), right1: strip(), right2: strip(),
      top1: strip(), top2: strip(), bottom1: strip(), bottom2: strip(),
    };
    for (let k = 0; k < tileSize; k++) {
      const o = k * 3;
      lab(x0, y0 + k, e.left1, o);
      lab(x0 + 1, y0 + k, e.left2, o);
      lab(x0 + tileSize - 1, y0 + k, e.right1, o);
      lab(x0 + tileSize - 2, y0 + k, e.right2, o);
      lab(x0 + k, y0, e.top1, o);
      lab(x0 + k, y0 + 1, e.top2, o);
      lab(x0 + k, y0 + tileSize - 1, e.bottom1, o);
      lab(x0 + k, y0 + tileSize - 2, e.bottom2, o);
    }
    edges.push(e);
  }
  return { n, tileSize, edges };
}

/**
 * Liczy predykcyjną miarę niepodobieństwa dwóch krawędzi (im mniejsza, tym lepiej pasują).
 *
 * Krawędź A przedłużamy liniowo (2·a1 − a2) i porównujemy z pierwszym paskiem B;
 * to samo robimy w drugą stronę, aby miara była symetryczna.
 *
 * @param {Float32Array} a1 - Skrajny pasek kafelka A (od strony B).
 * @param {Float32Array} a2 - Przedostatni pasek kafelka A.
 * @param {Float32Array} b1 - Skrajny pasek kafelka B (od strony A).
 * @param {Float32Array} b2 - Przedostatni pasek kafelka B.
 * @returns {number} Wartość niepodobieństwa (≥ 0).
 */
function predictionDissimilarity(a1, a2, b1, b2) {
  let sum = 0;
  for (let i = 0; i < a1.length; i++) {
    sum += Math.abs(2 * a1[i] - a2[i] - b1[i]) ** P_NORM;
    sum += Math.abs(2 * b1[i] - b2[i] - a1[i]) ** P_NORM;
  }
  return sum;
}

/**
 * Buduje macierze niepodobieństwa i kompatybilności dla wszystkich par kafelków.
 *
 * Kompatybilność C(A, B) = exp(−(D(A, B) / q_A)^k), k = SHARPNESS, gdzie q_A to dolny kwartyl wartości D
 * dla kafelka A w danym kierunku (typowe „dość dobre” dopasowanie). Dzięki temu C jest bliskie
 * 100% tylko wtedy, gdy kandydat wyraźnie odstaje od pozostałych (komputer jest „pewny”).
 *
 * @param {{n: number, edges: Array<Record<string, Float32Array>>}} features - Wynik extractEdges.
 * @returns {{n: number, count: number, D: Record<string, Float64Array>, C: Record<string, Float64Array>,
 *   comparisons: number, ms: number}} Macierze (indeks a·count + b) dla relacji 'LR' i 'TB',
 *   liczba porównań krawędzi i czas obliczeń w milisekundach.
 */
export function computeCompatibility(features) {
  const start = performance.now();
  const { n, edges } = features;
  const count = n * n;
  const D = { LR: new Float64Array(count * count), TB: new Float64Array(count * count) };
  const C = { LR: new Float64Array(count * count), TB: new Float64Array(count * count) };
  let comparisons = 0;
  for (let a = 0; a < count; a++) {
    for (let b = 0; b < count; b++) {
      if (a === b) {
        D.LR[a * count + b] = Infinity;
        D.TB[a * count + b] = Infinity;
        continue;
      }
      const ea = edges[a];
      const eb = edges[b];
      D.LR[a * count + b] = predictionDissimilarity(ea.right1, ea.right2, eb.left1, eb.left2);
      D.TB[a * count + b] = predictionDissimilarity(ea.bottom1, ea.bottom2, eb.top1, eb.top2);
      comparisons += 2;
    }
  }
  for (const rel of RELATIONS) {
    for (let a = 0; a < count; a++) {
      const row = Array.from(D[rel].subarray(a * count, (a + 1) * count)).sort((x, y) => x - y);
      const q = Math.max(row[Math.floor((count - 1) / 4)], 1e-9);
      for (let b = 0; b < count; b++) {
        const ratio = D[rel][a * count + b] / q;
        C[rel][a * count + b] = a === b ? 0 : Math.exp(-(ratio ** SHARPNESS));
      }
    }
  }
  return { n, count, D, C, comparisons, ms: performance.now() - start };
}

/**
 * Zwraca kompatybilność kafelka `other` jako sąsiada kafelka `tile` w danym kierunku.
 *
 * @param {{count: number, C: Record<string, Float64Array>}} compat - Wynik computeCompatibility.
 * @param {number} tile - Kafelek odniesienia.
 * @param {number} other - Kandydat na sąsiada.
 * @param {'right' | 'left' | 'down' | 'up'} direction - Gdzie kandydat leży względem `tile`.
 * @returns {number} Kompatybilność z przedziału [0, 1].
 */
export function neighbourScore(compat, tile, other, direction) {
  const { count, C } = compat;
  switch (direction) {
    case 'right': return C.LR[tile * count + other];
    case 'left': return C.LR[other * count + tile];
    case 'down': return C.TB[tile * count + other];
    case 'up': return C.TB[other * count + tile];
    default: throw new Error(`Nieznany kierunek: ${direction}`);
  }
}

/**
 * Szereguje kandydatów na sąsiada kafelka w danym kierunku.
 *
 * @param {object} compat - Wynik computeCompatibility.
 * @param {number} tile - Kafelek odniesienia.
 * @param {'right' | 'left' | 'down' | 'up'} direction - Kierunek szukanego sąsiada.
 * @returns {Array<{tile: number, score: number}>} Kandydaci od najlepszego do najgorszego.
 */
export function rankNeighbours(compat, tile, direction) {
  const result = [];
  for (let other = 0; other < compat.count; other++) {
    if (other !== tile) result.push({ tile: other, score: neighbourScore(compat, tile, other, direction) });
  }
  return result.sort((a, b) => b.score - a.score);
}

/**
 * Sprawdza, czy dwa kafelki są „najlepszymi kumplami” (best buddies): każdy z nich
 * jest dla drugiego najlepszym kandydatem w przeciwnych kierunkach.
 *
 * @param {object} compat - Wynik computeCompatibility.
 * @param {number} tile - Pierwszy kafelek.
 * @param {number} other - Drugi kafelek.
 * @param {'right' | 'left' | 'down' | 'up'} direction - Gdzie `other` leży względem `tile`.
 * @returns {boolean} True, jeśli wybór jest obustronny.
 */
export function areBestBuddies(compat, tile, other, direction) {
  const opposite = { right: 'left', left: 'right', down: 'up', up: 'down' }[direction];
  return rankNeighbours(compat, tile, direction)[0].tile === other
    && rankNeighbours(compat, other, opposite)[0].tile === tile;
}

/**
 * Wektory barwników (gęstość optyczna RGB) według Ruifrok & Johnston (2001):
 * hematoksylina, eozyna i trzeci wektor resztkowy (DAB).
 */
const STAIN_MATRIX = [
  [0.65, 0.70, 0.29],
  [0.07, 0.99, 0.11],
  [0.27, 0.57, 0.78],
].map((v) => {
  const len = Math.hypot(...v);
  return v.map((c) => c / len);
});

/**
 * Odwraca macierz 3×3.
 *
 * @param {number[][]} m - Macierz wejściowa.
 * @returns {number[][]} Macierz odwrotna.
 */
function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const STAIN_INVERSE = invert3(STAIN_MATRIX);

/**
 * Rozkłada kolor piksela na stężenia barwników (dekonwolucja kolorów).
 *
 * Prawo Lamberta–Beera: gęstość optyczna OD = −log10(I / I0) jest sumą wkładów barwników,
 * więc stężenia otrzymujemy, mnożąc wektor OD przez odwrotność macierzy barwników.
 *
 * @param {number} r - Składowa czerwona (0–255).
 * @param {number} g - Składowa zielona (0–255).
 * @param {number} b - Składowa niebieska (0–255).
 * @returns {{h: number, e: number}} Względne stężenia hematoksyliny i eozyny (≥ 0).
 */
export function stainConcentrations(r, g, b) {
  const od = [r, g, b].map((v) => -Math.log10(Math.max(v, 1) / 255));
  const conc = [0, 1].map((s) => od[0] * STAIN_INVERSE[0][s] + od[1] * STAIN_INVERSE[1][s] + od[2] * STAIN_INVERSE[2][s]);
  return { h: Math.max(0, conc[0]), e: Math.max(0, conc[1]) };
}

/**
 * Tworzy obrazy pojedynczych barwników: tylko hematoksylina albo tylko eozyna.
 *
 * @param {HTMLCanvasElement} source - Obraz H&E.
 * @returns {{hematoxylin: HTMLCanvasElement, eosin: HTMLCanvasElement}} Dwa płótna tego samego rozmiaru.
 */
export function separateStains(source) {
  const { width, height } = source;
  const input = source.getContext('2d').getImageData(0, 0, width, height).data;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  };
  const hCanvas = make();
  const eCanvas = make();
  const hImg = hCanvas.getContext('2d').createImageData(width, height);
  const eImg = eCanvas.getContext('2d').createImageData(width, height);
  // Odtwarzamy kolor każdego barwnika osobno: I = 255 · 10^(−stężenie · wektor barwnika).
  const paint = (out, i, conc, vec) => {
    out[i] = 255 * 10 ** (-conc * vec[0]);
    out[i + 1] = 255 * 10 ** (-conc * vec[1]);
    out[i + 2] = 255 * 10 ** (-conc * vec[2]);
    out[i + 3] = 255;
  };
  for (let i = 0; i < input.length; i += 4) {
    const { h, e } = stainConcentrations(input[i], input[i + 1], input[i + 2]);
    paint(hImg.data, i, h, STAIN_MATRIX[0]);
    paint(eImg.data, i, e, STAIN_MATRIX[1]);
  }
  hCanvas.getContext('2d').putImageData(hImg, 0, 0);
  eCanvas.getContext('2d').putImageData(eImg, 0, 0);
  return { hematoxylin: hCanvas, eosin: eCanvas };
}
