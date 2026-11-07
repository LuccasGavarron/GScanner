// Medidor de passos: compara o espectro dos momentos de som forte e curto (passos) com o fundo.

export const BANDS = [125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000];

const pow = db => 10 ** (db / 10);
const toDb = p => (p > 0 ? 10 * Math.log10(p) : -120);

// Espectro em dB por bin de um bloco de amostras (tamanho potência de 2), com janela Hann. FFT radix-2.
export function spectrumDb(samples) {
  const n = samples.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  for (let i = 1, j = 0; i < n; i++) { // reordena por bits invertidos
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k), wi = Math.sin(a * k), u = i + k, v = u + len / 2;
        const tr = re[v] * wr - im[v] * wi, ti = re[v] * wi + im[v] * wr;
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
      }
    }
  }
  return Float32Array.from({ length: n / 2 }, (_, k) => 20 * Math.log10(Math.hypot(re[k], im[k]) / n + 1e-12));
}

// Espectro em dB por bin -> nível médio por banda de 1/3 de oitava
export function toBands(db, sampleRate, fftSize) {
  return BANDS.map(f => {
    const lo = Math.ceil((f / 2 ** (1 / 6)) * fftSize / sampleRate), hi = Math.floor((f * 2 ** (1 / 6)) * fftSize / sampleRate);
    let s = 0, n = 0;
    for (let i = lo; i <= hi; i++) { s += pow(db[i]); n++; }
    return n ? toDb(s / n) : -120;
  });
}

// frames: lista de bandas. Evento = quadro 6 dB acima da mediana; fundo = quadros até a mediana.
export function footstepProfile(frames) {
  frames = frames.filter(b => toDb(b.reduce((a, x) => a + pow(x), 0)) > -90); // ignora silêncio
  if (frames.length < 20) return null;
  const level = frames.map(b => toDb(b.reduce((a, x) => a + pow(x), 0)));
  const med = [...level].sort((a, b) => a - b)[Math.floor(level.length / 2)];
  const avg = pick => BANDS.map((_, k) => {
    const sel = frames.filter((_, i) => pick(level[i]));
    return sel.length ? toDb(sel.reduce((a, b) => a + pow(b[k]), 0) / sel.length) : -120;
  });
  const ev = avg(l => l > med + 6), bg = avg(l => l <= med);
  // bg fica salvo: serve de referência para reconhecer chuva pelo fundo depois
  return { bg: bg.map(v => Math.round(v * 10) / 10), events: level.filter(l => l > med + 6).length, diff: BANDS.map((f, k) => ({ f, db: Math.round((ev[k] - bg[k]) * 10) / 10 })) };
}

// Qual perfil (sem chuva / com chuva) tem o fundo mais parecido com o som de agora.
// Fundo = média da metade mais baixa dos quadros; compara só de 1 kHz para cima, onde a chuva chia.
export function nearestProfile(frames, profiles) {
  const named = Object.entries(profiles).filter(([, p]) => p.bg?.length === BANDS.length);
  if (named.length < 2 || frames.length < 10) return null;
  const level = frames.map(b => b.reduce((a, x) => a + pow(x), 0));
  const quiet = frames.filter((_, i) => level[i] <= [...level].sort((a, b) => a - b)[Math.floor(level.length / 2)]);
  const bg = BANDS.map((_, k) => toDb(quiet.reduce((a, b) => a + pow(b[k]), 0) / quiet.length));
  const dist = p => BANDS.reduce((a, f, k) => a + (f >= 1000 ? Math.abs(bg[k] - p.bg[k]) : 0), 0);
  return named.sort((a, b) => dist(a[1]) - dist(b[1]))[0][0];
}

// Sugestão para o Equalizer APO: realça as 3 bandas de 800 Hz a 6,3 kHz onde os passos mais se destacam.
export function suggestEq(diff) {
  const top = diff.filter(d => d.f >= 800 && d.f <= 6300 && d.db > 0).sort((a, b) => b.db - a.db).slice(0, 3);
  const gains = [6, 4, 3];
  return ['Preamp: -6 dB', 'Filter: ON HP Fc 120 Hz',
    ...top.map((d, i) => `Filter: ON PK Fc ${d.f} Hz Gain ${gains[i]} dB Q 1.4`)].join('\n');
}
