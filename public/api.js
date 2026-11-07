// Consulta o tarkov.dev pelo servidor local, que guarda cópia para quando a API cair.
export async function gql(query, variables) {
  const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (!j.data) throw new Error(j.errors?.[0]?.message ?? 'Sem dados do tarkov.dev.');
  const at = r.headers.get('X-Cache-Date');
  return { data: j.data, note: at ? `API fora do ar: usando cópia de ${new Date(at).toLocaleString('pt-BR')}.` : 'Dados ao vivo do tarkov.dev.' };
}

export const $ = s => document.querySelector(s);
export const rub = n => (n ? n.toLocaleString('pt-BR') + ' ₽' : '—');

// Uma conexão de eventos para a página toda: o Chrome só abre 6 por site, e cada aba usando a sua travava os tiles
export const events = new EventSource('/events');
export const onEvent = f => events.addEventListener('message', e => { const m = JSON.parse(e.data); f(m.type, m.data); });
