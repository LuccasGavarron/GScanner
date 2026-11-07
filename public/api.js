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
