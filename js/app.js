/**
 * app.js – Przebieg gry HistoPuzzle: ekrany, liczniki i przejścia między aktami.
 *
 * Akty:
 *   0. Rozgrzewka – łatwe puzzle z logo koła (punkt odniesienia).
 *   1. Ułóż tkankę – puzzle z preparatu H&E (człowiek).
 *   2. Oczami komputera – piksele, rozdzielanie barwników, porównywanie krawędzi.
 *   3. Komputer układa – animacja solvera i porównanie z graczem.
 *   4. Skala – odjazd do całego preparatu, podział na kafelki i poglądowa mapa AI.
 */

import { derangement, PuzzleBoard } from './puzzle.js';
import { loadImage, loadManifest, loadTissue, toSquareCanvas } from './tissues.js';
import {
  computeCompatibility, extractEdges, neighbourScore, rankNeighbours, separateStains, stainConcentrations,
} from './vision.js';
import { solvePuzzle } from './solver.js';
import { SlideExplorer } from './zoom.js';

/** Bok obrazu roboczego w pikselach (każda plansza jest cięta z kwadratu tej wielkości). */
const WORK_SIZE = 600;
/** Po ilu sekundach układania pojawia się przycisk „Poproś komputer o pomoc”. */
const HELP_AFTER_SECONDS = 90;
/** Adres strony koła (kod QR na końcu gry). */
const CLUB_URL = 'https://biologiacyfrowa.github.io/website_BC/';
const DIRECTION_ARROWS = { right: '→', left: '←', down: '↓', up: '↑' };

const $ = (id) => document.getElementById(id);

/** Cały stan gry; resetowany przyciskiem „Od nowa” dla kolejnej osoby. */
const state = {
  manifest: [],
  tissueCache: new Map(),
  timer: null,
  warmup: null,
  tissue: null,
  loaded: null,
  n: 5,
  board: null,
  moves: 0,
  startedAt: 0,
  finishedMs: null,
  helperUnlocked: false,
  compat: null,
  visionTile: 0,
  visionDirection: 'right',
  solverBoard: null,
  solverRun: 0,
  explorer: null,
};

/**
 * Formatuje czas jako m:ss.
 *
 * @param {number} ms - Czas w milisekundach.
 * @returns {string} Sformatowany czas.
 */
function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Formatuje liczbę z polskimi separatorami tysięcy.
 *
 * @param {number} value - Liczba do sformatowania.
 * @returns {string} Sformatowana liczba.
 */
function formatNumber(value) {
  return Math.round(value).toLocaleString('pl-PL');
}

/** Odświeża ikony Lucide (o ile biblioteka się wczytała). */
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

/**
 * Pokazuje wybrany ekran i podświetla odpowiedni etap w nagłówku.
 *
 * @param {string} name - Nazwa ekranu (sufiks identyfikatora `screen-…`).
 */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('hidden', el.id !== `screen-${name}`));
  const step = name === 'choose' ? 'puzzle' : name;
  document.querySelectorAll('#stepper button').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.step === step);
    btn.disabled = btn.dataset.step !== 'warmup' && btn.dataset.step !== 'puzzle' && !state.board;
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Uruchamia licznik czasu, który co sekundę wywołuje podaną funkcję.
 *
 * @param {() => void} tick - Funkcja odświeżająca widok.
 */
function startTimer(tick) {
  clearInterval(state.timer);
  tick();
  state.timer = setInterval(tick, 500);
}

/* ------------------------------------------------------------------ */
/* Akt 0: rozgrzewka                                                   */
/* ------------------------------------------------------------------ */

/** Buduje łatwe puzzle 3×3 z logo koła. */
async function startWarmup() {
  showScreen('warmup');
  const logo = await loadImage('assets/img/logo_puzzle.jpg');
  const image = toSquareCanvas(logo, WORK_SIZE);
  const warmup = { moves: 0, startedAt: performance.now(), done: false };
  state.warmup = warmup;
  state.warmupBoard?.destroy();
  $('warmup-done').classList.add('hidden');
  state.warmupBoard = new PuzzleBoard($('board-warmup'), {
    image,
    n: 3,
    slots: derangement(9),
    onMove: () => {
      warmup.moves++;
      $('warmup-moves').textContent = warmup.moves;
    },
    onSolved: () => {
      warmup.done = true;
      clearInterval(state.timer);
      $('warmup-result').textContent = `${formatTime(performance.now() - warmup.startedAt)} (${warmup.moves} ruchów)`;
      $('warmup-done').classList.remove('hidden');
    },
  });
  $('warmup-moves').textContent = '0';
  startTimer(() => {
    if (!warmup.done) $('warmup-time').textContent = formatTime(performance.now() - warmup.startedAt);
  });
}

/* ------------------------------------------------------------------ */
/* Akt 1: wybór tkanki i układanie                                    */
/* ------------------------------------------------------------------ */

/**
 * Zwraca obrazy tkanki, generując je tylko raz.
 *
 * @param {object} entry - Wpis manifestu.
 * @returns {Promise<object>} Wynik loadTissue.
 */
async function getTissue(entry) {
  if (!state.tissueCache.has(entry.id)) state.tissueCache.set(entry.id, await loadTissue(entry, WORK_SIZE));
  return state.tissueCache.get(entry.id);
}

/** Pokazuje karty tkanek do wyboru. */
async function showTissueChoice() {
  clearInterval(state.timer);
  showScreen('choose');
  const container = $('tissue-cards');
  try {
    if (!state.manifest.length) state.manifest = await loadManifest();
  } catch (error) {
    $('tissue-error').textContent = `${error.message}. Uruchom grę przez serwer HTTP (patrz README).`;
    $('tissue-error').classList.remove('hidden');
    return;
  }
  container.innerHTML = '';
  for (const entry of state.manifest) {
    const card = document.createElement('button');
    card.className = 'glass-panel tissue-card';
    const levels = [1, 2, 3].map((l) => `<i class="${l <= entry.level ? 'on' : ''}"></i>`).join('');
    card.innerHTML = `
      <canvas width="300" height="300"></canvas>
      <div class="p-4 space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <strong class="text-white text-lg">${entry.name}</strong>
          <span class="level" title="Trudność: ${entry.difficulty}">${levels}</span>
        </div>
        <p class="text-xs uppercase tracking-wide text-[#C4455C] font-bold">Trudność: ${entry.difficulty}</p>
        <p class="text-sm text-[#DFEFF6]/80 leading-relaxed">${entry.description}</p>
      </div>`;
    card.addEventListener('click', () => startTissue(entry));
    container.appendChild(card);
    const { fragment } = await getTissue(entry);
    card.querySelector('canvas').getContext('2d').drawImage(fragment, 0, 0, 300, 300);
  }
}

/**
 * Rozpoczyna układanie wybranej tkanki.
 *
 * @param {object} entry - Wpis manifestu.
 */
async function startTissue(entry) {
  state.tissue = entry;
  state.loaded = await getTissue(entry);
  state.n = window.innerWidth < 640 ? 4 : 5;
  state.compat = computeCompatibility(extractEdges(state.loaded.fragment, state.n));
  state.moves = 0;
  state.startedAt = performance.now();
  state.finishedMs = null;
  state.board?.destroy();
  state.board = new PuzzleBoard($('board-tissue'), {
    image: state.loaded.fragment,
    n: state.n,
    slots: derangement(state.n * state.n),
    onMove: () => {
      state.moves++;
      $('puzzle-moves').textContent = state.moves;
    },
    onSolved: () => {
      state.finishedMs = performance.now() - state.startedAt;
      $('puzzle-result').textContent = `${formatTime(state.finishedMs)} (${state.moves} ruchów)`;
      $('puzzle-done').classList.remove('hidden');
      $('btn-ask-computer').classList.remove('hidden');
      $('btn-ask-computer').lastChild.textContent = ' Zobacz, jak robi to komputer';
    },
    onSelect: updateHelperHints,
  });
  state.board.setShowCorrect($('toggle-correct').checked);
  $('puzzle-title').textContent = `${entry.name} · ${state.n}×${state.n} kafelków`;
  $('puzzle-desc').textContent = entry.description;
  $('puzzle-credit').textContent = `Źródło obrazu: ${entry.credit}${entry.license !== '—' ? ` (${entry.license})` : ''}`;
  $('puzzle-moves').textContent = '0';
  $('puzzle-done').classList.add('hidden');
  $('btn-ask-computer').classList.add('hidden');
  $('btn-ask-computer').lastChild.textContent = ' Poproś komputer o pomoc';
  showPuzzle();
}

/** Wraca do planszy gracza (bez tasowania) i wznawia licznik. */
function showPuzzle() {
  if (!state.board) {
    showTissueChoice();
    return;
  }
  showScreen('puzzle');
  $('helper-row').classList.toggle('hidden', !state.helperUnlocked);
  $('helper-info').classList.toggle('hidden', !$('toggle-helper').checked);
  startTimer(() => {
    if (state.finishedMs !== null) return;
    const elapsed = performance.now() - state.startedAt;
    $('puzzle-time').textContent = formatTime(elapsed);
    if (elapsed > HELP_AFTER_SECONDS * 1000) $('btn-ask-computer').classList.remove('hidden');
  });
}

/**
 * Pokazuje podpowiedzi pomocnika dla zaznaczonego kafelka: najlepszego kandydata w każdym kierunku.
 *
 * @param {number | null} tile - Zaznaczony kafelek albo null.
 */
function updateHelperHints(tile) {
  const hints = new Map();
  if ($('toggle-helper').checked && tile !== null) {
    for (const dir of Object.keys(DIRECTION_ARROWS)) {
      const [best] = rankNeighbours(state.compat, tile, dir);
      const label = `${DIRECTION_ARROWS[dir]}${Math.round(best.score * 100)}%`;
      hints.set(best.tile, hints.has(best.tile) ? `${hints.get(best.tile)} ${label}` : label);
    }
  }
  state.board.setHints(hints);
}

/* ------------------------------------------------------------------ */
/* Akt 2: oczami komputera                                             */
/* ------------------------------------------------------------------ */

/**
 * Wycina pojedynczy kafelek z obrazu roboczego.
 *
 * @param {number} tile - Indeks kafelka.
 * @returns {HTMLCanvasElement} Płótno o boku równym rozmiarowi kafelka.
 */
function tileCanvas(tile) {
  const size = Math.floor(WORK_SIZE / state.n);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(state.loaded.fragment, (tile % state.n) * size, Math.floor(tile / state.n) * size,
    size, size, 0, 0, size, size);
  return canvas;
}

/** Otwiera akt 2 dla kafelka zaznaczonego przez gracza (albo środkowego). */
function openVision() {
  clearInterval(state.timer);
  state.helperUnlocked = true;
  state.visionTile = state.board.selected ?? state.board.slots[Math.floor(state.n * state.n / 2)];
  showScreen('vision');
  renderMiniBoard();
  selectVisionTile(state.visionTile);
}

/**
 * Ustawia kafelek analizowany w akcie 2 i odświeża wszystkie trzy panele.
 *
 * @param {number} tile - Indeks kafelka.
 */
function selectVisionTile(tile) {
  state.visionTile = tile;
  const source = tileCanvas(tile);
  renderPixelPanel(source, Math.floor(source.width / 2), Math.floor(source.height / 2));
  renderStains(source);
  renderEdgePanel();
}

/**
 * Rysuje kafelek z celownikiem oraz powiększenie 11×11 pikseli wokół wskazanego punktu.
 *
 * @param {HTMLCanvasElement} source - Kafelek w rozdzielczości roboczej.
 * @param {number} px - Wskazany piksel (oś X, współrzędne kafelka).
 * @param {number} py - Wskazany piksel (oś Y, współrzędne kafelka).
 */
function renderPixelPanel(source, px, py) {
  const view = $('pixel-tile');
  const ctx = view.getContext('2d');
  const scale = view.width / source.width;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, view.width, view.height);
  const radius = 5;
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 2;
  ctx.strokeRect((px - radius) * scale, (py - radius) * scale, (2 * radius + 1) * scale, (2 * radius + 1) * scale);

  const zoom = $('pixel-zoom');
  const zctx = zoom.getContext('2d');
  const cell = zoom.width / (2 * radius + 1);
  zctx.imageSmoothingEnabled = false;
  zctx.fillStyle = '#14162e';
  zctx.fillRect(0, 0, zoom.width, zoom.height);
  zctx.drawImage(source, px - radius, py - radius, 2 * radius + 1, 2 * radius + 1, 0, 0, zoom.width, zoom.height);
  zctx.strokeStyle = 'rgba(20, 22, 46, 0.6)';
  zctx.lineWidth = 1;
  for (let i = 0; i <= 2 * radius + 1; i++) {
    zctx.beginPath(); zctx.moveTo(i * cell, 0); zctx.lineTo(i * cell, zoom.height); zctx.stroke();
    zctx.beginPath(); zctx.moveTo(0, i * cell); zctx.lineTo(zoom.width, i * cell); zctx.stroke();
  }
  zctx.strokeStyle = '#facc15';
  zctx.lineWidth = 2;
  zctx.strokeRect(radius * cell, radius * cell, cell, cell);

  const [r, g, b] = source.getContext('2d').getImageData(px, py, 1, 1).data;
  const { h, e } = stainConcentrations(r, g, b);
  $('pixel-values').innerHTML = `
    <div><span style="color:#f87171">R</span> ${r} · <span style="color:#4ade80">G</span> ${g} · <span style="color:#60a5fa">B</span> ${b}</div>
    <div class="text-[#DFEFF6]/70">hematoksylina: ${h.toFixed(2)}</div>
    <div class="text-[#DFEFF6]/70">eozyna: ${e.toFixed(2)}</div>`;
  view.onpointerdown = view.onpointermove = (event) => {
    if (event.type === 'pointermove' && event.buttons === 0 && event.pointerType !== 'mouse') return;
    const rect = view.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * source.width);
    const y = Math.floor((event.clientY - rect.top) / rect.height * source.height);
    renderPixelPanel(source, Math.min(source.width - 1, Math.max(0, x)), Math.min(source.height - 1, Math.max(0, y)));
  };
}

/**
 * Rysuje kafelek oraz jego obrazy „tylko hematoksylina” i „tylko eozyna”.
 *
 * @param {HTMLCanvasElement} source - Kafelek w rozdzielczości roboczej.
 */
function renderStains(source) {
  const { hematoxylin, eosin } = separateStains(source);
  for (const [id, img] of [['stain-orig', source], ['stain-h', hematoxylin], ['stain-e', eosin]]) {
    const canvas = $(id);
    canvas.width = canvas.height = source.width;
    canvas.getContext('2d').drawImage(img, 0, 0);
  }
}

/** Rysuje miniaturę planszy gracza (w jego bieżącym ułożeniu) do wybierania kafelka. */
function renderMiniBoard() {
  const mini = $('mini-board');
  mini.style.setProperty('--n', state.n);
  mini.innerHTML = '';
  const url = state.loaded.fragment.toDataURL('image/jpeg', 0.85);
  const pct = 100 / (state.n - 1);
  for (const tile of state.board.slots) {
    const btn = document.createElement('button');
    btn.dataset.tile = String(tile);
    btn.style.backgroundImage = `url(${url})`;
    btn.style.backgroundSize = `${state.n * 100}% ${state.n * 100}%`;
    btn.style.backgroundPosition = `${(tile % state.n) * pct}% ${Math.floor(tile / state.n) * pct}%`;
    btn.setAttribute('aria-label', `Kafelek ${tile + 1}`);
    btn.addEventListener('click', () => selectVisionTile(tile));
    mini.appendChild(btn);
  }
}

/**
 * Zwraca prawdziwego sąsiada kafelka w danym kierunku (lub null na brzegu obrazu).
 *
 * @param {number} tile - Indeks kafelka.
 * @param {'right' | 'left' | 'down' | 'up'} dir - Kierunek.
 * @returns {number | null} Indeks sąsiada albo null.
 */
function trueNeighbour(tile, dir) {
  const { n } = state;
  const r = Math.floor(tile / n);
  const c = tile % n;
  if (dir === 'right') return c < n - 1 ? tile + 1 : null;
  if (dir === 'left') return c > 0 ? tile - 1 : null;
  if (dir === 'down') return r < n - 1 ? tile + n : null;
  return r > 0 ? tile - n : null;
}

/**
 * Składa obraz pary kafelków (wybrany + kandydat) stykających się krawędzią.
 *
 * @param {number} tile - Wybrany kafelek.
 * @param {number} other - Kandydat.
 * @param {'right' | 'left' | 'down' | 'up'} dir - Gdzie leży kandydat.
 * @returns {HTMLCanvasElement} Płótno z parą kafelków.
 */
function pairCanvas(tile, other, dir) {
  const size = Math.floor(WORK_SIZE / state.n);
  const horizontal = dir === 'right' || dir === 'left';
  const canvas = document.createElement('canvas');
  canvas.width = horizontal ? 2 * size : size;
  canvas.height = horizontal ? size : 2 * size;
  const ctx = canvas.getContext('2d');
  const first = dir === 'right' || dir === 'down' ? tile : other;
  const second = first === tile ? other : tile;
  ctx.drawImage(tileCanvas(first), 0, 0);
  ctx.drawImage(tileCanvas(second), horizontal ? size : 0, horizontal ? 0 : size);
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (horizontal) { ctx.moveTo(size, 0); ctx.lineTo(size, size); } else { ctx.moveTo(0, size); ctx.lineTo(size, size); }
  ctx.stroke();
  // Obramowanie wybranego kafelka, żeby było wiadomo, który jest który.
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  const ox = horizontal && first !== tile ? size : 0;
  const oy = !horizontal && first !== tile ? size : 0;
  ctx.strokeRect(ox + 2, oy + 2, size - 4, size - 4);
  if (!horizontal) canvas.style.height = '110px';
  return canvas;
}

/** Odświeża mapę cieplną na miniaturze planszy i listę najlepszych kandydatów. */
function renderEdgePanel() {
  const { visionTile: tile, visionDirection: dir } = state;
  document.querySelectorAll('#mini-board button').forEach((btn) => {
    const other = Number(btn.dataset.tile);
    btn.classList.toggle('is-selected', other === tile);
    const score = other === tile ? 0 : neighbourScore(state.compat, tile, other, dir);
    btn.style.setProperty('--heat', `rgba(196, 69, 92, ${(score * 0.8).toFixed(2)})`);
  });
  document.querySelectorAll('#direction-buttons .chip').forEach((chip) => chip.classList.toggle('is-active', chip.dataset.dir === dir));

  const ranking = rankNeighbours(state.compat, tile, dir);
  const truth = trueNeighbour(tile, dir);
  const list = $('candidate-list');
  list.innerHTML = '';
  ranking.slice(0, 4).forEach((cand, i) => {
    const row = document.createElement('div');
    row.className = `candidate${cand.tile === truth ? ' is-true' : ''}`;
    const pct = Math.round(cand.score * 100);
    row.appendChild(pairCanvas(tile, cand.tile, dir));
    const middle = document.createElement('div');
    middle.className = 'space-y-1.5';
    middle.innerHTML = `<div class="text-xs text-[#DFEFF6]/70">Kandydat #${i + 1}${cand.tile === truth ? ' · <span class="text-emerald-300 font-bold">prawdziwy sąsiad</span>' : ''}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>`;
    row.appendChild(middle);
    const value = document.createElement('strong');
    value.textContent = `${pct}%`;
    row.appendChild(value);
    list.appendChild(row);
  });

  if (truth === null) {
    $('candidate-truth').innerHTML = 'Ten kafelek leży <strong>na brzegu obrazu</strong>, więc z tej strony nie ma żadnego sąsiada. Komputer i tak coś zaproponuje, ale zwykle z niższą pewnością. To jeden z powodów pomyłek.';
  } else {
    const place = ranking.findIndex((c) => c.tile === truth) + 1;
    $('candidate-truth').innerHTML = place === 1
      ? 'Komputer trafił: prawdziwy sąsiad jest <strong>na 1. miejscu</strong> rankingu.'
      : `Prawdziwy sąsiad jest dopiero <strong>na ${place}. miejscu</strong>. Przy powtarzalnej tkance wiele krawędzi wygląda prawie tak samo.`;
  }
}

/* ------------------------------------------------------------------ */
/* Akt 3: komputer układa                                             */
/* ------------------------------------------------------------------ */

/** Liczy rozwiązanie od zera (z pomiarem czasu) i odtwarza animację układania. */
function runSolver() {
  clearInterval(state.timer);
  showScreen('solver');
  const run = ++state.solverRun;
  const start = performance.now();
  const compat = computeCompatibility(extractEdges(state.loaded.fragment, state.n));
  const result = solvePuzzle(compat);
  const totalMs = performance.now() - start;
  const count = state.n * state.n;

  const humanMs = state.finishedMs ?? performance.now() - state.startedAt;
  $('vs-human-time').textContent = formatTime(humanMs);
  $('vs-human-moves').textContent = state.finishedMs !== null ? `${state.moves} ruchów · ułożone` : `${state.moves} ruchów · nie ukończono`;
  $('vs-cpu-time').textContent = totalMs < 1000 ? `${totalMs.toFixed(0)} ms` : `${(totalMs / 1000).toFixed(1)} s`;
  $('vs-cpu-comparisons').textContent = `${formatNumber(compat.comparisons)} porównań krawędzi`;
  $('solver-status').textContent = 'Komputer dokłada kafelki od najpewniejszych dopasowań… (animacja jest celowo spowolniona)';
  $('solver-result').classList.add('hidden');

  state.solverBoard?.destroy();
  state.solverBoard = new PuzzleBoard($('board-solver'), {
    image: state.loaded.fragment, n: state.n, slots: result.slots, interactive: false,
  });
  for (let t = 0; t < count; t++) state.solverBoard.setVisible(t, false);

  const delay = Math.min(220, 4000 / count);
  result.order.forEach((step, i) => {
    setTimeout(() => {
      if (run === state.solverRun) state.solverBoard.setVisible(step.tile, true);
    }, 300 + i * delay);
  });
  setTimeout(() => {
    if (run !== state.solverRun) return;
    const wrong = new Set();
    result.slots.forEach((tile, slot) => { if (tile !== slot) wrong.add(tile); });
    state.solverBoard.markWrong(wrong);
    $('solver-status').textContent = `Gotowe. Liczenie zajęło ${totalMs.toFixed(0)} ms, a komputer nie wiedział, jak wygląda cały obraz. Znał tylko piksele na krawędziach.`;
    $('solver-correct').textContent = `${result.correct} / ${count}`;
    $('solver-explain').innerHTML = wrong.size === 0
      ? 'Bezbłędnie! Człowiek widzi „dywan” podobnych komórek, a komputer porównuje setki pikseli na każdej krawędzi i wychwytuje różnice niewidoczne gołym okiem. Ale co, gdy preparat ma <strong>dziesiątki tysięcy</strong> takich kafelków? Zobacz w następnym kroku.'
      : `Komputer pomylił się przy <strong>${wrong.size}</strong> kafelkach (zaznaczone na czerwono). Przy powtarzalnej tkance wiele krawędzi pasuje prawie tak samo dobrze. Dlatego w prawdziwej analizie nikt nie skleja kafelków: skaner zapisuje położenie każdego z nich, a AI ocenia je osobno.`;
    $('solver-result').classList.remove('hidden');
  }, 500 + count * delay);
}

/* ------------------------------------------------------------------ */
/* Akt 4: skala                                                        */
/* ------------------------------------------------------------------ */

/** Otwiera akt 4, liczy statystyki preparatu i odtwarza odjazd kamery. */
async function openScale() {
  clearInterval(state.timer);
  state.solverRun++;
  showScreen('scale');
  if (!state.explorer) state.explorer = new SlideExplorer($('slide-canvas'));
  const explorer = state.explorer;
  explorer.setData({ ...state.loaded, slideInfo: state.tissue.slide, n: state.n });
  const stats = explorer.stats();
  const info = state.tissue.slide;
  $('scale-player-tiles').textContent = String(state.n * state.n);
  $('scale-slide-tiles').textContent = `~${formatNumber(stats.tiles)}`;
  $('scale-pixels').textContent = `${Math.round(info.width / 1000)}k × ${Math.round(info.height / 1000)}k`;
  $('scale-gb').textContent = `~${stats.gigabytes.toFixed(0)} GB`;
  $('heat-legend').classList.add('hidden');
  $('scale-explain').innerHTML = '';
  await playZoom();
  const tileUm = stats.tileSizePx * info.mpp;
  $('scale-explain').innerHTML = `Każdy Twój kafelek to ok. <strong>${stats.tileSizePx} × ${stats.tileSizePx} pikseli</strong> skanera (${tileUm.toFixed(0)} µm, mniej więcej grubość ludzkiego włosa). Cały preparat ma wymiary ok. ${stats.widthMm.toFixed(0)} × ${stats.heightMm.toFixed(0)} mm, czyli <strong>~${formatNumber(stats.tiles)}</strong> takich kafelków z tkanką. Twoją planszę trzeba by ułożyć ok. <strong>${formatNumber(stats.tiles / (state.n * state.n))} razy</strong>.`;
}

/** Odtwarza animację odjazdu z odczytem szerokości pola widzenia. */
function playZoom() {
  $('heat-legend').classList.add('hidden');
  return state.explorer.zoomOut(5000, (mm) => {
    $('field-width').textContent = mm < 1 ? `${(mm * 1000).toFixed(0)} µm` : `${mm.toFixed(1)} mm`;
  });
}

/** Rysuje kod QR do strony koła (jeśli biblioteka QR się wczytała). */
function renderQr() {
  if (typeof window.qrcode !== 'function') return;
  const qr = window.qrcode(0, 'M');
  qr.addData(CLUB_URL);
  qr.make();
  $('qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
}

/* ------------------------------------------------------------------ */
/* Nawigacja i reset                                                   */
/* ------------------------------------------------------------------ */

/** Przywraca grę do ekranu startowego dla kolejnej osoby. */
function restart() {
  clearInterval(state.timer);
  state.solverRun++;
  state.board?.destroy();
  state.warmupBoard?.destroy();
  state.solverBoard?.destroy();
  Object.assign(state, {
    tissue: null, loaded: null, board: null, warmupBoard: null, solverBoard: null,
    moves: 0, finishedMs: null, helperUnlocked: false, compat: null,
  });
  $('toggle-correct').checked = false;
  $('toggle-helper').checked = false;
  ['board-warmup', 'board-tissue', 'board-solver'].forEach((id) => { $(id).innerHTML = ''; });
  showScreen('intro');
}

/** Podpina obsługę wszystkich przycisków. */
function bindEvents() {
  $('btn-start').addEventListener('click', startWarmup);
  $('btn-warmup-next').addEventListener('click', showTissueChoice);
  $('btn-ask-computer').addEventListener('click', openVision);
  $('btn-puzzle-skip').addEventListener('click', openVision);
  $('btn-back-helper').addEventListener('click', () => {
    $('toggle-helper').checked = true;
    showPuzzle();
  });
  $('btn-go-solver').addEventListener('click', runSolver);
  $('btn-replay-solver').addEventListener('click', runSolver);
  $('btn-go-scale').addEventListener('click', openScale);
  $('btn-zoom-replay').addEventListener('click', playZoom);
  $('btn-show-tiles').addEventListener('click', () => {
    state.explorer.setOverlay('tiles');
    $('heat-legend').classList.add('hidden');
  });
  $('btn-show-heatmap').addEventListener('click', () => {
    state.explorer.setOverlay('heatmap');
    $('heat-legend').classList.remove('hidden');
  });
  $('btn-restart').addEventListener('click', restart);
  $('btn-restart-end').addEventListener('click', restart);
  $('toggle-correct').addEventListener('change', (e) => state.board?.setShowCorrect(e.target.checked));
  $('toggle-helper').addEventListener('change', (e) => {
    $('helper-info').classList.toggle('hidden', !e.target.checked);
    updateHelperHints(e.target.checked ? state.board.selected : null);
  });
  document.querySelectorAll('#direction-buttons .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.visionDirection = chip.dataset.dir;
      renderEdgePanel();
    });
  });
  document.querySelectorAll('#stepper button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const actions = { warmup: startWarmup, puzzle: showPuzzle, vision: openVision, solver: runSolver, scale: openScale };
      actions[btn.dataset.step]();
    });
  });
}

bindEvents();
renderQr();
refreshIcons();
showScreen('intro');
