/**
 * synth.js – Proceduralny generator syntetycznych obrazów tkanek barwionych H&E.
 *
 * Służy jako zamiennik prawdziwych preparatów (WSI), dopóki nie zostaną przygotowane
 * fragmenty z publicznych zbiorów (patrz tools/prepare_tissue.py). Generator odtwarza
 * najważniejsze cechy wizualne barwienia hematoksyliną i eozyną:
 *   - jądra komórkowe: fioletowo-granatowe (hematoksylina wiąże kwasy nukleinowe),
 *   - cytoplazma i kolagen: różowe (eozyna wiąże białka zasadowe),
 *   - światła naczyń i gruczołów: prawie białe (brak tkanki).
 *
 * Wszystkie funkcje są deterministyczne dla danego ziarna (seed), więc ta sama tkanka
 * wygląda identycznie przy każdym uruchomieniu.
 */

/**
 * Tworzy deterministyczny generator liczb pseudolosowych (Mulberry32).
 *
 * @param {number} seed - Ziarno generatora (liczba całkowita).
 * @returns {() => number} Funkcja zwracająca kolejne liczby z przedziału [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tworzy gładkie pole szumu jako sumę fal sinusoidalnych o losowych kierunkach.
 *
 * @param {() => number} rng - Generator liczb losowych.
 * @param {number} scale - Typowa długość fali w pikselach.
 * @param {number} [waves=6] - Liczba nakładanych fal.
 * @returns {(x: number, y: number) => number} Funkcja zwracająca wartość z przedziału [-1, 1].
 */
function smoothNoise(rng, scale, waves = 6) {
  const params = Array.from({ length: waves }, () => {
    const angle = rng() * Math.PI * 2;
    const freq = (0.6 + rng() * 0.8) * (2 * Math.PI / scale);
    return { kx: Math.cos(angle) * freq, ky: Math.sin(angle) * freq, phase: rng() * Math.PI * 2 };
  });
  return (x, y) => {
    let sum = 0;
    for (const p of params) sum += Math.sin(p.kx * x + p.ky * y + p.phase);
    return sum / waves * 1.6;
  };
}

/** Losuje liczbę z przedziału [min, max). */
function range(rng, min, max) {
  return min + rng() * (max - min);
}

/**
 * Rysuje włókna kolagenowe tkanki łącznej (zrąb) jako półprzezroczyste krzywe.
 *
 * @param {CanvasRenderingContext2D} ctx - Kontekst rysowania.
 * @param {() => number} rng - Generator liczb losowych.
 * @param {number} size - Bok obrazu w pikselach.
 * @param {number} count - Liczba włókien.
 * @param {{y0?: number, y1?: number}} [band] - Opcjonalny pionowy zakres rysowania.
 */
function drawCollagen(ctx, rng, size, count, band = {}) {
  const y0 = band.y0 ?? 0;
  const y1 = band.y1 ?? size;
  const flow = smoothNoise(rng, size * 0.8, 4);
  for (let i = 0; i < count; i++) {
    let x = rng() * size;
    let y = range(rng, y0, y1);
    const shade = Math.floor(range(rng, 0, 40));
    ctx.strokeStyle = `rgba(${215 - shade}, ${110 + shade}, ${160 + shade / 2}, ${range(rng, 0.12, 0.35)})`;
    ctx.lineWidth = range(rng, 0.8, 3.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 6 + Math.floor(rng() * 8);
    for (let s = 0; s < steps; s++) {
      const angle = flow(x, y) * 1.4;
      x += Math.cos(angle) * 7;
      y += Math.sin(angle) * 7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * Rysuje pojedyncze jądro komórkowe z drobnymi grudkami chromatyny.
 *
 * @param {CanvasRenderingContext2D} ctx - Kontekst rysowania.
 * @param {() => number} rng - Generator liczb losowych.
 * @param {number} x - Środek jądra (oś X).
 * @param {number} y - Środek jądra (oś Y).
 * @param {number} rx - Półoś długa.
 * @param {number} ry - Półoś krótka.
 * @param {number} angle - Obrót w radianach.
 * @param {number} darkness - Intensywność barwienia hematoksyliną (0 = blade, 1 = bardzo ciemne).
 */
function drawNucleus(ctx, rng, x, y, rx, ry, angle, darkness) {
  const r = Math.round(95 - 55 * darkness + range(rng, -8, 8));
  const g = Math.round(70 - 45 * darkness + range(rng, -6, 6));
  const b = Math.round(160 - 40 * darkness + range(rng, -10, 10));
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.78 + 0.2 * darkness})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
  ctx.fill();
  // Grudki chromatyny: kilka ciemniejszych punktów wewnątrz jądra.
  const speckles = Math.floor(rx * ry / 4);
  ctx.fillStyle = `rgba(${r - 30}, ${g - 25}, ${b - 30}, 0.55)`;
  for (let i = 0; i < speckles; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.75;
    const px = x + Math.cos(a) * rx * d * Math.cos(angle) - Math.sin(a) * ry * d * Math.sin(angle);
    const py = y + Math.cos(a) * rx * d * Math.sin(angle) + Math.sin(a) * ry * d * Math.cos(angle);
    ctx.fillRect(px, py, 1.4, 1.4);
  }
}

/**
 * Rysuje naczynie krwionośne: światło z erytrocytami i spłaszczonymi jądrami śródbłonka.
 *
 * @param {CanvasRenderingContext2D} ctx - Kontekst rysowania.
 * @param {() => number} rng - Generator liczb losowych.
 * @param {number} x - Środek naczynia (oś X).
 * @param {number} y - Środek naczynia (oś Y).
 * @param {number} radius - Promień światła naczynia.
 */
function drawVessel(ctx, rng, x, y, radius) {
  const squash = range(rng, 0.55, 1);
  const angle = rng() * Math.PI;
  ctx.fillStyle = 'rgba(232, 160, 190, 0.9)';
  ctx.beginPath();
  ctx.ellipse(x, y, radius + 4, (radius + 4) * squash, angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f7eef3';
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * squash, angle, 0, Math.PI * 2);
  ctx.fill();
  const cells = Math.floor(radius * radius / 18);
  for (let i = 0; i < cells; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.8;
    const lx = Math.cos(a) * radius * d;
    const ly = Math.sin(a) * radius * squash * d;
    ctx.fillStyle = `rgba(${210 + Math.floor(rng() * 30)}, 60, 85, 0.85)`;
    ctx.beginPath();
    ctx.arc(x + lx * Math.cos(angle) - ly * Math.sin(angle), y + lx * Math.sin(angle) + ly * Math.cos(angle), 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  const endothelium = Math.max(3, Math.floor(radius / 4));
  for (let i = 0; i < endothelium; i++) {
    const a = (i / endothelium) * Math.PI * 2 + rng() * 0.4;
    const lx = Math.cos(a) * (radius + 2);
    const ly = Math.sin(a) * (radius + 2) * squash;
    drawNucleus(ctx, rng, x + lx * Math.cos(angle) - ly * Math.sin(angle), y + lx * Math.sin(angle) + ly * Math.cos(angle),
      4.5, 1.6, a + angle + Math.PI / 2, 0.8);
  }
}

/**
 * Skóra: warstwa rogowa, naskórek z falistą granicą (brodawki skórne) i skóra właściwa.
 * Najłatwiejsza do ułożenia, bo warstwy wyznaczają kierunek góra–dół.
 */
function paintSkin(ctx, rng, size) {
  const boundaryNoise = smoothNoise(rng, size * 0.25, 3);
  const phase = rng() * Math.PI * 2;
  const boundary = (x) => size * 0.46 + size * 0.07 * Math.sin(x / size * Math.PI * 2 * 2.5 + phase) + size * 0.025 * boundaryNoise(x, 0);
  const corneumBottom = size * 0.11;

  // Skóra właściwa (zrąb) jako tło.
  ctx.fillStyle = '#f1cddc';
  ctx.fillRect(0, 0, size, size);
  drawCollagen(ctx, rng, size, 900, { y0: size * 0.3 });

  // Naskórek: wypełnienie nad falistą granicą.
  ctx.fillStyle = '#e4adc6';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let x = 0; x <= size; x += 4) ctx.lineTo(x, boundary(x));
  ctx.lineTo(size, 0);
  ctx.closePath();
  ctx.fill();

  // Warstwa rogowa: jasne tło szkiełka i faliste, łuszczące się pasma keratyny.
  ctx.fillStyle = '#f6eef3';
  ctx.fillRect(0, 0, size, corneumBottom * 0.55);
  for (let i = 0; i < 70; i++) {
    const y = range(rng, corneumBottom * 0.35, corneumBottom * 1.05);
    ctx.strokeStyle = `rgba(${225 + Math.floor(rng() * 20)}, ${140 + Math.floor(rng() * 40)}, 180, ${range(rng, 0.35, 0.8)})`;
    ctx.lineWidth = range(rng, 1, 2.5);
    ctx.beginPath();
    const x0 = rng() * size;
    const len = range(rng, size * 0.1, size * 0.4);
    for (let x = x0; x < x0 + len; x += 5) {
      ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.5);
    }
    ctx.stroke();
  }

  // Komórki naskórka: im bliżej warstwy podstawnej, tym gęściej i ciemniej.
  for (let i = 0; i < 1700; i++) {
    const x = rng() * size;
    const yb = boundary(x);
    const y = range(rng, corneumBottom, yb);
    const depth = (y - corneumBottom) / (yb - corneumBottom);
    if (rng() > 0.35 + 0.65 * depth) continue;
    const flatten = 1 - depth;
    drawNucleus(ctx, rng, x, y, range(rng, 3.4, 4.6), range(rng, 2.0, 3.4) * (1 - 0.45 * flatten), range(rng, -0.3, 0.3), 0.35 + 0.5 * depth);
  }
  // Warstwa ziarnista: drobne ciemne ziarna keratohialiny tuż pod warstwą rogową.
  for (let i = 0; i < 500; i++) {
    const x = rng() * size;
    const y = corneumBottom + range(rng, 0, size * 0.04);
    ctx.fillStyle = 'rgba(70, 40, 110, 0.6)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // Warstwa podstawna: jeden rząd gęsto ułożonych, ciemnych jąder wzdłuż granicy.
  for (let x = 0; x < size; x += 5.5) {
    const y = boundary(x) - range(rng, 3, 7);
    drawNucleus(ctx, rng, x + range(rng, -1, 1), y, 4.2, 2.6, Math.PI / 2 + range(rng, -0.3, 0.3), 0.9);
  }

  // Skóra właściwa: rozproszone fibroblasty i naczynia.
  for (let i = 0; i < 160; i++) {
    const x = rng() * size;
    const y = range(rng, boundary(x) + 8, size);
    drawNucleus(ctx, rng, x, y, range(rng, 4, 6), range(rng, 1.3, 2), rng() * Math.PI, 0.75);
  }
  for (let i = 0; i < 5; i++) {
    const x = rng() * size;
    drawVessel(ctx, rng, x, range(rng, boundary(x) + 30, size - 10), range(rng, 7, 16));
  }
}

/**
 * Jelito grube (przekrój poprzeczny błony śluzowej): krypty z komórkami kubkowymi
 * otoczone blaszką właściwą bogatą w komórki odpornościowe. Trudność średnia.
 */
function paintIntestine(ctx, rng, size) {
  ctx.fillStyle = '#ebc2d4';
  ctx.fillRect(0, 0, size, size);
  drawCollagen(ctx, rng, size, 500);

  // Komórki blaszki właściwej (limfocyty, plazmocyty).
  for (let i = 0; i < 2600; i++) {
    drawNucleus(ctx, rng, rng() * size, rng() * size, range(rng, 2.4, 3.4), range(rng, 2.2, 3.0), rng() * Math.PI, 0.85);
  }

  // Rozmieszczenie krypt metodą losowania z odrzucaniem (brak nakładania).
  const crypts = [];
  for (let attempt = 0; attempt < 3000 && crypts.length < 40; attempt++) {
    const r = range(rng, 30, 46);
    const x = range(rng, -r * 0.5, size + r * 0.5);
    const y = range(rng, -r * 0.5, size + r * 0.5);
    if (crypts.every((c) => Math.hypot(c.x - x, c.y - y) > c.r + r + 10)) {
      crypts.push({ x, y, r, squash: range(rng, 0.7, 1), angle: rng() * Math.PI });
    }
  }

  for (const c of crypts) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.scale(1, c.squash);
    // Nabłonek krypty.
    ctx.fillStyle = '#e2a2bf';
    ctx.beginPath();
    ctx.arc(0, 0, c.r, 0, Math.PI * 2);
    ctx.fill();
    // Komórki kubkowe: blade, lekko niebieskawe pęcherzyki śluzu.
    const goblets = Math.floor(c.r / 3);
    for (let i = 0; i < goblets; i++) {
      const a = (i / goblets) * Math.PI * 2 + rng() * 0.2;
      ctx.fillStyle = `rgba(${236 + Math.floor(rng() * 10)}, 226, 240, 0.95)`;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * c.r * 0.55, Math.sin(a) * c.r * 0.55, range(rng, 4, 6.5), 0, Math.PI * 2);
      ctx.fill();
    }
    // Światło krypty.
    ctx.fillStyle = '#f8f0f5';
    ctx.beginPath();
    ctx.arc(0, 0, c.r * 0.27, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Jądra nabłonka ułożone promieniście przy błonie podstawnej.
    const nuclei = Math.floor(c.r * 0.9);
    for (let i = 0; i < nuclei; i++) {
      const a = (i / nuclei) * Math.PI * 2;
      const lx = Math.cos(a) * c.r * 0.84;
      const ly = Math.sin(a) * c.r * 0.84 * c.squash;
      const x = c.x + lx * Math.cos(c.angle) - ly * Math.sin(c.angle);
      const y = c.y + lx * Math.sin(c.angle) + ly * Math.cos(c.angle);
      drawNucleus(ctx, rng, x, y, 4.6, 1.9, a + c.angle, 0.8);
    }
  }
  for (let i = 0; i < 3; i++) drawVessel(ctx, rng, rng() * size, rng() * size, range(rng, 6, 10));
}

/**
 * Węzeł chłonny: niemal jednorodny „dywan” limfocytów z jaśniejszymi ośrodkami rozmnażania
 * i bladymi zatokami. Najtrudniejszy: każdy kafelek wygląda prawie tak samo.
 */
function paintLymphNode(ctx, rng, size) {
  ctx.fillStyle = '#dcb5cf';
  ctx.fillRect(0, 0, size, size);
  drawCollagen(ctx, rng, size, 150);
  const density = smoothNoise(rng, size * 0.7, 5);
  const centre = smoothNoise(rng, size * 0.9, 3);

  // Zatoki: blade, lekko faliste pasma.
  for (let i = 0; i < 2; i++) {
    const y0 = rng() * size;
    ctx.strokeStyle = 'rgba(240, 220, 234, 0.55)';
    ctx.lineWidth = range(rng, 8, 16);
    ctx.beginPath();
    for (let x = -10; x < size + 10; x += 8) ctx.lineTo(x, y0 + Math.sin(x * 0.02 + i * 2) * 25);
    ctx.stroke();
  }

  const count = Math.floor(size * size / 34);
  for (let i = 0; i < count; i++) {
    const x = rng() * size;
    const y = rng() * size;
    if (rng() > 0.72 + 0.28 * density(x, y)) continue;
    const germinal = centre(x, y) > 0.55;
    if (germinal && rng() < 0.3) {
      // Centroblasty i makrofagi: większe, jaśniejsze jądra.
      drawNucleus(ctx, rng, x, y, range(rng, 4.5, 6), range(rng, 3.8, 5), rng() * Math.PI, 0.35);
    } else {
      drawNucleus(ctx, rng, x, y, range(rng, 2.6, 3.4), range(rng, 2.4, 3.2), rng() * Math.PI, 0.95);
    }
  }
}

/**
 * Dodaje ziarnisty szum (jak szum matrycy skanera), aby krawędzie kafelków nie były „idealne”.
 *
 * @param {CanvasRenderingContext2D} ctx - Kontekst rysowania.
 * @param {() => number} rng - Generator liczb losowych.
 * @param {number} size - Bok obrazu w pikselach.
 */
function addSensorNoise(ctx, rng, size) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

const PAINTERS = {
  skin: paintSkin,
  intestine: paintIntestine,
  lymph_node: paintLymphNode,
};

/**
 * Generuje kwadratowy obraz syntetycznej tkanki H&E.
 *
 * @param {'skin' | 'intestine' | 'lymph_node'} kind - Rodzaj tkanki.
 * @param {number} size - Bok obrazu w pikselach.
 * @param {number} seed - Ziarno generatora (ta sama wartość daje ten sam obraz).
 * @returns {HTMLCanvasElement} Płótno z wygenerowaną tkanką.
 * @throws {Error} Gdy rodzaj tkanki jest nieznany.
 */
export function renderSyntheticTissue(kind, size, seed) {
  const painter = PAINTERS[kind];
  if (!painter) throw new Error(`Nieznany rodzaj syntetycznej tkanki: ${kind}`);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(seed);
  painter(ctx, rng, size);
  addSensorNoise(ctx, rng, size);
  return canvas;
}

/**
 * Generuje miniaturę całego syntetycznego preparatu (WSI) i położenie fragmentu użytego w puzzlach.
 *
 * Kształt tkanki to nieregularna plama wypełniona pomniejszoną teksturą fragmentu,
 * dzięki czemu kolorystyka miniatury zgadza się z planszą.
 *
 * @param {HTMLCanvasElement} fragment - Fragment tkanki w pełnej rozdzielczości.
 * @param {number} seed - Ziarno generatora kształtu.
 * @param {number} regionFraction - Szerokość fragmentu jako ułamek szerokości preparatu.
 * @returns {{canvas: HTMLCanvasElement, region: {x: number, y: number, w: number, h: number}}}
 *   Miniatura oraz prostokąt fragmentu w pikselach miniatury.
 */
export function renderSyntheticSlide(fragment, seed, regionFraction) {
  const width = 1000;
  const height = 700;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(seed);

  ctx.fillStyle = '#f3f1f4';
  ctx.fillRect(0, 0, width, height);

  const patternSource = document.createElement('canvas');
  patternSource.width = patternSource.height = 26;
  patternSource.getContext('2d').drawImage(fragment, 0, 0, 26, 26);
  const pattern = ctx.createPattern(patternSource, 'repeat');

  const cx = width / 2;
  const cy = height / 2;
  const wobble = smoothNoise(rng, 2.2, 5);
  const blob = new Path2D();
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const r = 1 + 0.18 * wobble(Math.cos(a), Math.sin(a));
    const x = cx + Math.cos(a) * width * 0.4 * r;
    const y = cy + Math.sin(a) * height * 0.38 * r;
    if (i === 0) blob.moveTo(x, y); else blob.lineTo(x, y);
  }
  blob.closePath();
  ctx.fillStyle = pattern;
  ctx.fill(blob);
  // Delikatne zróżnicowanie gęstości tkanki widoczne w małym powiększeniu.
  const shade = smoothNoise(rng, 260, 5);
  ctx.save();
  ctx.clip(blob);
  for (let y = 0; y < height; y += 10) {
    for (let x = 0; x < width; x += 10) {
      const v = shade(x, y);
      ctx.fillStyle = v > 0 ? `rgba(70, 40, 120, ${v * 0.18})` : `rgba(255, 235, 245, ${-v * 0.25})`;
      ctx.fillRect(x, y, 10, 10);
    }
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(150, 90, 150, 0.5)';
  ctx.lineWidth = 2;
  ctx.stroke(blob);

  const w = width * regionFraction;
  const region = { x: cx + width * 0.12 - w / 2, y: cy - height * 0.08 - w / 2, w, h: w };
  return { canvas, region };
}
