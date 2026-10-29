/**
 * tissues.js – Wczytywanie tkanek opisanych w assets/tissues/manifest.json.
 *
 * Każda tkanka ma dwa źródła obrazu:
 *   - "synthetic": obraz generowany proceduralnie (js/synth.js),
 *   - "image": fragment i miniatura preparatu przygotowane skryptem tools/prepare_tissue.py.
 * Niezależnie od źródła moduł zwraca ten sam format, więc reszta gry nie musi wiedzieć,
 * skąd pochodzi obraz.
 */

import { renderSyntheticSlide, renderSyntheticTissue } from './synth.js';

const MANIFEST_URL = 'assets/tissues/manifest.json';

/**
 * Pobiera listę dostępnych tkanek.
 *
 * @returns {Promise<Array<object>>} Wpisy manifestu posortowane rosnąco według trudności.
 * @throws {Error} Gdy manifestu nie da się pobrać (np. strona otwarta bez serwera HTTP).
 */
export async function loadManifest() {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) throw new Error(`Nie udało się wczytać ${MANIFEST_URL} (HTTP ${response.status})`);
  const entries = await response.json();
  return entries.sort((a, b) => a.level - b.level);
}

/**
 * Wczytuje obraz z podanego adresu.
 *
 * @param {string} url - Adres obrazu.
 * @returns {Promise<HTMLImageElement>} Wczytany obraz.
 * @throws {Error} Gdy obrazu nie da się wczytać.
 */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Nie udało się wczytać obrazu ${url}`));
    img.src = url;
  });
}

/**
 * Przycina obraz do środkowego kwadratu i skaluje go do zadanego rozmiaru.
 *
 * @param {CanvasImageSource & {width: number, height: number}} source - Obraz źródłowy.
 * @param {number} size - Bok wynikowego kwadratu w pikselach.
 * @returns {HTMLCanvasElement} Kwadratowe płótno.
 */
export function toSquareCanvas(source, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const side = Math.min(source.width, source.height);
  const sx = (source.width - side) / 2;
  const sy = (source.height - side) / 2;
  canvas.getContext('2d').drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

/**
 * Przygotowuje obrazy tkanki: fragment do puzzli i miniaturę całego preparatu.
 *
 * @param {object} entry - Wpis manifestu.
 * @param {number} size - Bok fragmentu w pikselach (rozdzielczość robocza puzzli).
 * @returns {Promise<{fragment: HTMLCanvasElement, slide: HTMLCanvasElement,
 *   region: {x: number, y: number, w: number, h: number}}>} Fragment, miniatura preparatu
 *   i położenie fragmentu w pikselach miniatury.
 * @throws {Error} Gdy typ źródła jest nieznany lub plików nie da się wczytać.
 */
export async function loadTissue(entry, size) {
  const { source, slide } = entry;
  if (source.type === 'synthetic') {
    const fragment = renderSyntheticTissue(source.kind, size, source.seed);
    const { canvas, region } = renderSyntheticSlide(fragment, source.seed, slide.fragmentSize / slide.width);
    return { fragment, slide: canvas, region };
  }
  if (source.type === 'image') {
    const [fragmentImg, thumbImg] = await Promise.all([loadImage(source.fragment), loadImage(source.thumbnail)]);
    const thumb = document.createElement('canvas');
    thumb.width = thumbImg.width;
    thumb.height = thumbImg.height;
    thumb.getContext('2d').drawImage(thumbImg, 0, 0);
    const [rx, ry, rw, rh] = source.region;
    return {
      fragment: toSquareCanvas(fragmentImg, size),
      slide: thumb,
      region: { x: rx * thumb.width, y: ry * thumb.height, w: rw * thumb.width, h: rh * thumb.height },
    };
  }
  throw new Error(`Nieznany typ źródła tkanki: ${source.type}`);
}
