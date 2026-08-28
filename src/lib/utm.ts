// Captura utm_source/utm_medium (e utm_campaign, se vier) na primeira página
// visitada, guarda em sessionStorage, e reaplica em toda navegação interna
// e no envio do formulário de e-mail — mesmo se o usuário navegar sem UTM
// na URL (ex: clicou num link interno do próprio site).

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
const STORAGE_KEY = 'utm_params';

export function capturarUTM(): void {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const capturados: Record<string, string> = {};

  for (const key of UTM_KEYS) {
    const val = params.get(key);
    if (val) capturados[key] = val;
  }

  // só sobrescreve o que já está salvo se vier algo novo na URL
  if (Object.keys(capturados).length > 0) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(capturados));
  }
}

export function obterUTM(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

// Reescreve todo <a href="/..."> (link interno) da página injetando os
// parâmetros UTM salvos, pra eles sobreviverem a navegação entre páginas.
export function propagarUTMEmLinksInternos(): void {
  if (typeof window === 'undefined') return;

  const utm = obterUTM();
  if (Object.keys(utm).length === 0) return;

  document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach((a) => {
    const url = new URL(a.href, window.location.origin);
    for (const [k, v] of Object.entries(utm)) {
      if (!url.searchParams.has(k)) url.searchParams.set(k, v);
    }
    a.href = url.pathname + '?' + url.searchParams.toString();
  });
}
