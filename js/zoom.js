/**
 * zoom.js – Akt 4: odjazd kamery od planszy do całego preparatu (WSI).
 *
 * Pokazuje skalę problemu: ułożony fragment to drobny punkt na szkiełku, a cały preparat
 * w analizie komputerowej dzieli się na dziesiątki tysięcy kafelków. Na koniec nakładamy
 * poglądową mapę cieplną, jaką mógłby zwrócić model klasyfikujący każdy kafelek osobno.
 */

import { mulberry32 } from './synth.js';

/** Bok komórki mapy cieplnej w pikselach miniatury (jedna komórka = setki prawdziwych kafelków). */
const DISPLAY_CELL = 14;

/** Płynne przyspieszanie i hamowanie animacji. */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Zamienia wartość z przedziału [0, 1] na kolor mapy cieplnej (zielony → żółty → karminowy).
 *
 * @param {number} v - Wartość prawdopodobieństwa zmiany.
 * @returns {string} Kolor CSS z przezroczystością.
 */
function heatColor(v) {
  const stops = [[16, 185, 129], [250, 204, 21], [196, 69, 92]];
  const x = Math.min(1, Math.max(0, v)) * 2;
  const i = Math.min(1, Math.floor(x));
  const t = x - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * t));
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.6)`;
}

export class SlideExplorer {
  /**
   * @param {HTMLCanvasElement} canvas - Płótno widoku (rozmiar CSS ustala arkusz stylów).
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = null;
    this.camera = { cx: 0, cy: 0, s: 1 };
    this.overlay = 'none';
    this.animation = null;
    this.handleResize = () => this.resize();
    window.addEventListener('resize', this.handleResize);
  }

  /**
   * Ustawia dane preparatu i liczy maskę tkanki.
   *
   * @param {object} data - Dane do wyświetlenia.
   * @param {HTMLCanvasElement} data.slide - Miniatura całego preparatu.
   * @param {{x: number, y: number, w: number, h: number}} data.region - Fragment w pikselach miniatury.
   * @param {HTMLCanvasElement} data.fragment - Fragment w pełnej rozdzielczości.
   * @param {{width: number, height: number, mpp: number, fragmentSize: number}} data.slideInfo - Wymiary preparatu.
   * @param {number} data.n - Liczba kafelków w wierszu planszy gracza.
   */
  setData(data) {
    this.data = data;
    this.cells = this.computeTissueCells();
    this.overlay = 'none';
    this.resize();
    this.setCamera(this.startCamera());
  }

  /**
   * Dzieli miniaturę na komórki i oznacza te, które zawierają tkankę (a nie puste szkło).
   *
   * @returns {Array<{x: number, y: number, heat: number}>} Komórki z tkanką i poglądowe
   *   prawdopodobieństwo zmiany.
   */
  computeTissueCells() {
    const { slide } = this.data;
    const { data, width, height } = slide.getContext('2d').getImageData(0, 0, slide.width, slide.height);
    const rng = mulberry32(7);
    const hotspots = Array.from({ length: 2 }, () => ({
      x: width * (0.3 + rng() * 0.4), y: height * (0.3 + rng() * 0.4), r: width * (0.06 + rng() * 0.06),
    }));
    const cells = [];
    for (let y = 0; y + DISPLAY_CELL <= height; y += DISPLAY_CELL) {
      for (let x = 0; x + DISPLAY_CELL <= width; x += DISPLAY_CELL) {
        let tissue = 0;
        let samples = 0;
        for (let yy = y; yy < y + DISPLAY_CELL; yy += 3) {
          for (let xx = x; xx < x + DISPLAY_CELL; xx += 3) {
            const i = (yy * width + xx) * 4;
            const max = Math.max(data[i], data[i + 1], data[i + 2]);
            const min = Math.min(data[i], data[i + 1], data[i + 2]);
            if (max - min > 22 || max < 200) tissue++;
            samples++;
          }
        }
        if (tissue / samples < 0.5) continue;
        let heat = 0.12 + rng() * 0.15;
        for (const h of hotspots) {
          const d = Math.hypot(x - h.x, y - h.y) / h.r;
          heat += Math.exp(-d * d) * (0.75 + rng() * 0.2);
        }
        cells.push({ x, y, heat: Math.min(1, heat) });
      }
    }
    return cells;
  }

  /**
   * Liczy statystyki skali preparatu.
   *
   * @returns {{tileSizePx: number, tiles: number, gigabytes: number, widthMm: number, heightMm: number}}
   *   Rozmiar kafelka w pikselach skanera, liczba kafelków z tkanką, rozmiar nieskompresowanego
   *   obrazu i wymiary preparatu w milimetrach.
   */
  stats() {
    const { slide, slideInfo, n } = this.data;
    const totalCells = Math.floor(slide.width / DISPLAY_CELL) * Math.floor(slide.height / DISPLAY_CELL);
    const tissueFraction = this.cells.length / totalCells;
    const tileSizePx = slideInfo.fragmentSize / n;
    const tiles = Math.round(slideInfo.width * slideInfo.height * tissueFraction / (tileSizePx * tileSizePx));
    return {
      tileSizePx: Math.round(tileSizePx),
      tiles,
      gigabytes: slideInfo.width * slideInfo.height * 3 / 1e9,
      widthMm: slideInfo.width * slideInfo.mpp / 1000,
      heightMm: slideInfo.height * slideInfo.mpp / 1000,
    };
  }

  /** Dopasowuje rozdzielczość płótna do rozmiaru na ekranie (z uwzględnieniem gęstości pikseli). */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 600;
    this.height = rect.height || 420;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.data) this.draw();
  }

  /** @returns {{cx: number, cy: number, s: number}} Kamera, w której fragment wypełnia widok. */
  startCamera() {
    const { region } = this.data;
    return {
      cx: region.x + region.w / 2,
      cy: region.y + region.h / 2,
      s: Math.min(this.width, this.height) * 0.9 / region.w,
    };
  }

  /** @returns {{cx: number, cy: number, s: number}} Kamera, w której widać cały preparat. */
  endCamera() {
    const { slide } = this.data;
    return {
      cx: slide.width / 2,
      cy: slide.height / 2,
      s: Math.min(this.width / slide.width, this.height / slide.height) * 0.96,
    };
  }

  /**
   * Ustawia kamerę i przerysowuje widok.
   *
   * @param {{cx: number, cy: number, s: number}} camera - Środek widoku (piksele miniatury) i skala.
   */
  setCamera(camera) {
    this.camera = camera;
    this.draw();
  }

  /**
   * @returns {number} Szerokość pola widzenia w milimetrach (przy bieżącej kamerze).
   */
  fieldWidthMm() {
    const { slide, slideInfo } = this.data;
    return this.width / this.camera.s * (slideInfo.width / slide.width) * slideInfo.mpp / 1000;
  }

  /**
   * Odtwarza animację odjazdu od fragmentu do całego preparatu.
   *
   * Skala zmienia się logarytmicznie, dzięki czemu każde podwojenie pola widzenia trwa tyle samo.
   *
   * @param {number} durationMs - Czas trwania animacji.
   * @param {(fieldMm: number) => void} [onFrame] - Wywoływane w każdej klatce z szerokością pola widzenia.
   * @returns {Promise<void>} Rozwiązywane po zakończeniu animacji.
   */
  zoomOut(durationMs, onFrame = () => {}) {
    cancelAnimationFrame(this.animation);
    this.overlay = 'none';
    const from = this.startCamera();
    const to = this.endCamera();
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        const t = easeInOutCubic(Math.min(1, (now - t0) / durationMs));
        const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * t);
        // Środek przesuwa się proporcjonalnie do zmiany skali (a nie czasu), więc fragment gracza
        // zostaje w kadrze, dopóki nie zrobi się z niego mała kropka na tle całego szkiełka.
        const w = (from.s - s) / (from.s - to.s);
        this.setCamera({ cx: from.cx + (to.cx - from.cx) * w, cy: from.cy + (to.cy - from.cy) * w, s });
        onFrame(this.fieldWidthMm());
        if (t < 1) this.animation = requestAnimationFrame(step);
        else resolve();
      };
      this.animation = requestAnimationFrame(step);
    });
  }

  /**
   * Zmienia nakładkę na preparacie.
   *
   * @param {'none' | 'tiles' | 'heatmap'} overlay - Rodzaj nakładki.
   */
  setOverlay(overlay) {
    this.overlay = overlay;
    this.draw();
  }

  /** Rysuje miniaturę, fragment gracza i wybraną nakładkę. */
  draw() {
    if (!this.data) return;
    const { ctx, width, height, camera } = this;
    const { slide, region, fragment } = this.data;
    ctx.fillStyle = '#0f1024';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.s, camera.s);
    ctx.translate(-camera.cx, -camera.cy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(slide, 0, 0);
    ctx.drawImage(fragment, region.x, region.y, region.w, region.h);

    if (this.overlay === 'tiles') {
      ctx.strokeStyle = 'rgba(223, 239, 246, 0.55)';
      ctx.lineWidth = 1 / camera.s;
      for (const c of this.cells) ctx.strokeRect(c.x, c.y, DISPLAY_CELL, DISPLAY_CELL);
    } else if (this.overlay === 'heatmap') {
      for (const c of this.cells) {
        ctx.fillStyle = heatColor(c.heat);
        ctx.fillRect(c.x, c.y, DISPLAY_CELL, DISPLAY_CELL);
      }
    }
    ctx.restore();

    // Ramka fragmentu w pikselach ekranu, aby była widoczna przy każdym powiększeniu.
    const sx = (region.x - camera.cx) * camera.s + width / 2;
    const sy = (region.y - camera.cy) * camera.s + height / 2;
    const sw = Math.max(region.w * camera.s, 6);
    const sh = Math.max(region.h * camera.s, 6);
    ctx.strokeStyle = '#C4455C';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(sx - (sw - region.w * camera.s) / 2, sy - (sh - region.h * camera.s) / 2, sw, sh);
  }

  /** Zatrzymuje animację i usuwa nasłuchiwanie zmiany rozmiaru okna. */
  destroy() {
    cancelAnimationFrame(this.animation);
    window.removeEventListener('resize', this.handleResize);
  }
}
