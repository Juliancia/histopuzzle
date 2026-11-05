/**
 * confetti.js – Lekkie konfetti na płótnie, wystrzeliwane z obu dolnych rogów ekranu.
 *
 * Bez zewnętrznych bibliotek, żeby działało także bez internetu na stoisku.
 * Przy włączonej w systemie opcji „ogranicz ruch” animacja jest pomijana.
 */

/** Kolory konfetti: barwy koła i kolory barwienia H&E. */
const COLORS = ['#C4455C', '#4043A0', '#DFEFF6', '#facc15', '#34d399', '#e48fb3', '#7c5cd6'];

/** Przyspieszenie grawitacyjne w pikselach na klatkę². */
const GRAVITY = 0.28;

/** Opór powietrza: mnożnik prędkości w każdej klatce. */
const DRAG = 0.985;

/**
 * Tworzy jedną cząstkę konfetti wystrzeloną z lewego albo prawego dolnego rogu.
 *
 * @param {number} width - Szerokość okna w pikselach CSS.
 * @param {number} height - Wysokość okna w pikselach CSS.
 * @param {boolean} fromLeft - Czy cząstka startuje z lewej strony.
 * @returns {object} Stan cząstki (położenie, prędkość, obrót, kolor, rozmiar).
 */
function createParticle(width, height, fromLeft) {
  const speed = 12 + Math.random() * 10;
  // Kąt od poziomu: 20–65° w górę, skierowany do środka ekranu.
  const angle = 0.35 + Math.random() * 0.8;
  const direction = fromLeft ? 1 : -1;
  return {
    x: fromLeft ? 0 : width,
    y: height * 0.85,
    vx: direction * Math.cos(angle) * speed,
    vy: -Math.sin(angle) * speed,
    size: 7 + Math.random() * 7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.35,
    wobble: Math.random() * Math.PI * 2,
  };
}

/**
 * Wystrzeliwuje konfetti na cały ekran.
 *
 * @param {object} [options] - Ustawienia animacji.
 * @param {number} [options.count=220] - Liczba cząstek.
 * @param {number} [options.duration=4200] - Czas trwania w milisekundach (z wygaszaniem na końcu).
 */
export function launchConfetti({ count = 220, duration = 4200 } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = Array.from({ length: count }, (_, i) => createParticle(width, height, i % 2 === 0));

  const start = performance.now();
  let last = start;
  const frame = (now) => {
    const elapsed = now - start;
    const dt = Math.min((now - last) / 16.67, 3);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.min(1, Math.max(0, (duration - elapsed) / 900));
    for (const p of particles) {
      p.vx *= DRAG ** dt;
      p.vy = p.vy * DRAG ** dt + GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      p.wobble += 0.12 * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.scale(1, Math.cos(p.wobble));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
