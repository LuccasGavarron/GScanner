// Medidor de passos: compara o espectro dos momentos de som forte e curto (passos) com o fundo.

export const BANDS = [125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000];

const pow = db => 10 ** (db / 10);
const toDb = p => (p > 0 ? 10 * Math.log10(p) : -120);

// Espectro em dB por bin (AnalyserNode) -> nível médio por banda de 1/3 de oitava
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
  return { events: level.filter(l => l > med + 6).length, diff: BANDS.map((f, k) => ({ f, db: Math.round((ev[k] - bg[k]) * 10) / 10 })) };
}

// Sugestão para o Equalizer APO: realça as 3 bandas de 800 Hz a 6,3 kHz onde os passos mais se destacam.
export function suggestEq(diff) {
  const top = diff.filter(d => d.f >= 800 && d.f <= 6300 && d.db > 0).sort((a, b) => b.db - a.db).slice(0, 3);
  const gains = [6, 4, 3];
  return ['Preamp: -6 dB', 'Filter: ON HP Fc 120 Hz',
    ...top.map((d, i) => `Filter: ON PK Fc ${d.f} Hz Gain ${gains[i]} dB Q 1.4`)].join('\n');
}
