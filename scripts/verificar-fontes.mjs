// Verifica por GET se cada URL de data/fontes.json responde (HTTP 2xx) e parece
// um feed RSS/Atom. Lista as que falharam e sai com código 1 se houver alguma.
//
// Uso: npm run verificar-fontes
//
// Não altera nada — só leitura. Serve para rodar antes de ligar o schedule do
// pipeline ou depois de editar data/fontes.json.

import fs from "node:fs/promises";
import path from "node:path";

const FONTES_PATH = path.join(process.cwd(), "data/fontes.json");
const TIMEOUT_MS = 15_000;

async function verificar(fonte) {
  try {
    const res = await fetch(fonte.url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "portal-noticias-ia/verificar-fontes", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, motivo: `HTTP ${res.status}` };
    const inicio = (await res.text()).slice(0, 2000).toLowerCase();
    if (!/<(rss|feed|rdf:rdf)[\s>]/.test(inicio)) return { ok: false, motivo: "resposta 2xx, mas não parece RSS/Atom" };
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err?.name === "TimeoutError" ? `timeout (${TIMEOUT_MS / 1000}s)` : (err?.cause?.code ?? err?.message ?? "erro de rede") };
  }
}

const fontes = JSON.parse(await fs.readFile(FONTES_PATH, "utf-8"));
if (!Array.isArray(fontes) || fontes.length === 0) {
  console.error("data/fontes.json vazio ou inválido");
  process.exit(1);
}

const resultados = await Promise.all(fontes.map(async (f) => ({ fonte: f, ...(await verificar(f)) })));
for (const r of resultados) console.log(`${r.ok ? "OK  " : "FALHA"} ${r.fonte.nome} — ${r.ok ? r.fonte.url : `${r.motivo} (${r.fonte.url})`}`);

const falhas = resultados.filter((r) => !r.ok);
if (falhas.length) {
  console.error(`\n${falhas.length} de ${fontes.length} fonte(s) falharam:`);
  for (const r of falhas) console.error(`- ${r.fonte.nome}: ${r.motivo}`);
  process.exit(1);
}
console.log(`\nTodas as ${fontes.length} fontes responderam.`);
