/**
 * puzzle.js – Plansza puzzli z kwadratowymi kafelkami.
 *
 * Kafelki są kwadratowe (jak w patologii cyfrowej), więc kształt nie zdradza sąsiada.
 * Sterowanie działa tak samo na telefonie i komputerze dzięki Pointer Events:
 *   - tapnięcie dwóch kafelków zamienia je miejscami,
 *   - przeciągnięcie kafelka na inne pole również je zamienia.
 */

/** Minimalny ruch wskaźnika (w pikselach), od którego tapnięcie staje się przeciąganiem. */
const DRAG_THRESHOLD = 8;

/**
 * Losuje permutację bez punktów stałych (żaden kafelek nie zostaje na swoim miejscu).
 *
 * @param {number} count - Liczba kafelków.
 * @param {() => number} [rng=Math.random] - Generator liczb losowych.
 * @returns {number[]} slots[pole] = kafelek.
 */
export function derangement(count, rng = Math.random) {
  const slots = Array.from({ length: count }, (_, i) => i);
  do {
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
  } while (slots.some((tile, slot) => tile === slot));
  return slots;
}

export class PuzzleBoard {
  /**
   * Tworzy planszę w podanym kontenerze.
   *
   * @param {HTMLElement} container - Element, w którym zostanie narysowana plansza.
   * @param {object} options - Ustawienia planszy.
   * @param {HTMLCanvasElement} options.image - Poprawnie ułożony, kwadratowy obraz.
   * @param {number} options.n - Liczba kafelków w wierszu.
   * @param {number[]} [options.slots] - Początkowe ułożenie; domyślnie poprawne.
   * @param {boolean} [options.interactive=true] - Czy gracz może zamieniać kafelki.
   * @param {(slots: number[]) => void} [options.onMove] - Wywoływane po każdej zamianie.
   * @param {() => void} [options.onSolved] - Wywoływane po ułożeniu całego obrazu.
   * @param {(tile: number | null) => void} [options.onSelect] - Wywoływane po zaznaczeniu kafelka.
   */
  constructor(container, { image, n, slots, interactive = true, onMove, onSolved, onSelect }) {
    this.container = container;
    this.n = n;
    this.slots = slots ? [...slots] : Array.from({ length: n * n }, (_, i) => i);
    this.interactive = interactive;
    this.onMove = onMove ?? (() => {});
    this.onSolved = onSolved ?? (() => {});
    this.onSelect = onSelect ?? (() => {});
    this.selected = null;
    this.showCorrect = false;
    this.drag = null;

    container.innerHTML = '';
    container.classList.add('puzzle-board');
    container.style.setProperty('--n', n);
    const url = image.toDataURL('image/jpeg', 0.92);
    this.tiles = Array.from({ length: n * n }, (_, tile) => {
      const el = document.createElement('div');
      el.className = 'puzzle-tile';
      el.dataset.tile = String(tile);
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = `${n * 100}% ${n * 100}%`;
      const pct = n > 1 ? 100 / (n - 1) : 0;
      el.style.backgroundPosition = `${(tile % n) * pct}% ${Math.floor(tile / n) * pct}%`;
      const badge = document.createElement('span');
      badge.className = 'tile-badge';
      el.appendChild(badge);
      container.appendChild(el);
      return el;
    });

    this.handleDown = this.handleDown.bind(this);
    this.handleMove = this.handleMove.bind(this);
    this.handleUp = this.handleUp.bind(this);
    container.addEventListener('pointerdown', this.handleDown);
    this.render();
  }

  /** Ustawia pozycje wszystkich kafelków zgodnie z bieżącym ułożeniem. */
  render() {
    this.slots.forEach((tile, slot) => {
      const el = this.tiles[tile];
      el.style.left = `${(slot % this.n) * 100 / this.n}%`;
      el.style.top = `${Math.floor(slot / this.n) * 100 / this.n}%`;
      el.classList.toggle('is-correct', this.showCorrect && tile === slot);
      el.classList.toggle('is-selected', tile === this.selected);
    });
  }

  /**
   * Zastępuje bieżące ułożenie.
   *
   * @param {ArrayLike<number>} slots - slots[pole] = kafelek.
   */
  setSlots(slots) {
    this.slots = Array.from(slots);
    this.render();
  }

  /** @returns {boolean} True, jeśli każdy kafelek leży na swoim miejscu. */
  isSolved() {
    return this.slots.every((tile, slot) => tile === slot);
  }

  /**
   * Włącza lub wyłącza zielone obramowanie poprawnie leżących kafelków.
   *
   * @param {boolean} value - Czy pokazywać poprawne kafelki.
   */
  setShowCorrect(value) {
    this.showCorrect = value;
    this.render();
  }

  /**
   * Ustawia podpowiedzi pomocnika: etykiety na kafelkach (np. strzałki kierunku).
   *
   * @param {Map<number, string>} hints - Kafelek → tekst etykiety; pusta mapa czyści podpowiedzi.
   */
  setHints(hints) {
    this.tiles.forEach((el, tile) => {
      const label = hints.get(tile);
      el.classList.toggle('is-hinted', Boolean(label));
      el.querySelector('.tile-badge').textContent = label ?? '';
    });
  }

  /**
   * Pokazuje lub ukrywa kafelek (używane w animacji solvera).
   *
   * @param {number} tile - Indeks kafelka.
   * @param {boolean} visible - Czy kafelek ma być widoczny.
   */
  setVisible(tile, visible) {
    this.tiles[tile].classList.toggle('is-hidden', !visible);
  }

  /**
   * Oznacza kafelki ułożone w złym miejscu.
   *
   * @param {Set<number>} tiles - Indeksy błędnie ułożonych kafelków.
   */
  markWrong(tiles) {
    this.tiles.forEach((el, tile) => el.classList.toggle('is-wrong', tiles.has(tile)));
  }

  /**
   * Zaznacza kafelek (lub czyści zaznaczenie) i powiadamia nasłuchującego.
   *
   * @param {number | null} tile - Indeks kafelka albo null.
   */
  select(tile) {
    this.selected = tile;
    this.render();
    this.onSelect(tile);
  }

  /**
   * Zamienia miejscami kafelki leżące na dwóch polach.
   *
   * @param {number} slotA - Pierwsze pole.
   * @param {number} slotB - Drugie pole.
   */
  swapSlots(slotA, slotB) {
    if (slotA === slotB) return;
    [this.slots[slotA], this.slots[slotB]] = [this.slots[slotB], this.slots[slotA]];
    this.selected = null;
    this.render();
    this.onSelect(null);
    this.onMove([...this.slots]);
    if (this.isSolved()) this.onSolved();
  }

  /**
   * Zwraca pole planszy pod wskazanym punktem ekranu.
   *
   * @param {number} clientX - Współrzędna X wskaźnika.
   * @param {number} clientY - Współrzędna Y wskaźnika.
   * @returns {number | null} Indeks pola lub null, gdy punkt leży poza planszą.
   */
  slotAt(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    const col = Math.floor((clientX - rect.left) / rect.width * this.n);
    const row = Math.floor((clientY - rect.top) / rect.height * this.n);
    if (col < 0 || row < 0 || col >= this.n || row >= this.n) return null;
    return row * this.n + col;
  }

  /** Rozpoczyna tapnięcie lub przeciąganie. */
  handleDown(event) {
    if (!this.interactive) return;
    const el = event.target.closest('.puzzle-tile');
    if (!el) return;
    event.preventDefault();
    const tile = Number(el.dataset.tile);
    this.drag = { tile, el, startX: event.clientX, startY: event.clientY, moved: false };
    window.addEventListener('pointermove', this.handleMove);
    window.addEventListener('pointerup', this.handleUp);
    window.addEventListener('pointercancel', this.handleUp);
  }

  /** Przesuwa przeciągany kafelek za wskaźnikiem. */
  handleMove(event) {
    const d = this.drag;
    if (!d) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.el.classList.add('is-dragging');
    d.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
  }

  /** Kończy tapnięcie (zaznaczenie/zamiana) lub przeciąganie (upuszczenie na pole). */
  handleUp(event) {
    const d = this.drag;
    this.drag = null;
    window.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
    window.removeEventListener('pointercancel', this.handleUp);
    if (!d) return;
    const fromSlot = this.slots.indexOf(d.tile);
    if (d.moved) {
      const target = this.slotAt(event.clientX, event.clientY);
      // Upuszczony kafelek przeskakuje od razu na nowe pole (bez animacji „lotu” z pozycji startowej).
      if (target !== null && target !== fromSlot) d.el.style.transition = 'none';
      d.el.classList.remove('is-dragging');
      d.el.style.transform = '';
      if (target !== null) this.swapSlots(fromSlot, target);
      void d.el.offsetWidth;
      d.el.style.transition = '';
      return;
    }
    if (this.selected === null) {
      this.select(d.tile);
    } else if (this.selected === d.tile) {
      this.select(null);
    } else {
      this.swapSlots(this.slots.indexOf(this.selected), fromSlot);
    }
  }

  /** Usuwa nasłuchiwanie zdarzeń (przed zbudowaniem nowej planszy w tym samym kontenerze). */
  destroy() {
    this.container.removeEventListener('pointerdown', this.handleDown);
    window.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
  }
}
