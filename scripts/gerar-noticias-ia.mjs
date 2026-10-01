#!/usr/bin/env node
/**
 * Pipeline diário: Portal de Notícias de IA
 * ------------------------------------------------------------
 * 1. Lê as fontes de data/fontes.json ({ nome, url, autoPublicar, peso }) e
 *    busca os itens recentes de cada feed RSS.
 * 2. Filtra por palavras-chave do nicho e por janela de tempo.
 * 3. Ignora tudo que já foi publicado ou está em rascunho pendente.
 * 4. Pra cada item novo, chama o LLM (Gemini, com fallback Claude) pra
 *    REESCREVER (nunca copiar) um artigo original em PT-BR.
 * 5. Decide o destino (mesma regra de scripts/generate-news.ts):
 *    - fonte com autoPublicar=true E checagem de fidelidade aprovada:
 *      grava em src/content/noticias/<slug>.md (o workflow commita);
 *    - caso contrário: cria Issue de rascunho + aviso no Telegram com
 *      botões Publicar/Descartar (webhook em src/pages/api/telegram-webhook.ts).
 *
 * Uso:
 *   GEMINI_API_KEY=... ANTHROPIC_API_KEY=sk-ant-... node scripts/gerar-noticias-ia.mjs
 *
 * Variáveis de ambiente:
 *   GEMINI_API_KEY      (provedor principal; sem ela cai direto pro Claude)
 *   GEMINI_MODEL        (opcional, default gemini-3.5-flash)
 *   ANTHROPIC_API_KEY   (fallback; ao menos uma das duas chaves é obrigatória)
 *   CLAUDE_MODEL        (opcional, ver docs.claude.com/en/docs/about-claude/models)
 *   GH_TOKEN + GITHUB_REPOSITORY  (criam as Issues de rascunho; sem eles, rascunhos não são criados)
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID  (avisos e alertas de falha)
 *   MAX_NOTICIAS        (opcional, default 3 por execução)
 * ------------------------------------------------------------
 */

import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import Parser from "rss-parser";
import { Octokit } from "@octokit/rest";
import { GoogleGenAI } from "@google/genai";

const CONTENT_DIR = path.join(process.cwd(), "src/content/noticias");
const PUBLISHED_SOURCES_PATH = path.join(process.cwd(), "data/published-sources.json");
const FONTES_PATH = path.join(process.cwd(), "data/fontes.json");
const ALERT_STATE_PATH = path.join(process.cwd(), ".alert-state/last-alert.json");
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 1 alerta de falha a cada 6h
const MAX_NOTICIAS = Number(process.env.MAX_NOTICIAS ?? 3);
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
// Segundo modelo Gemini, tentado antes do Claude (os modelos "flash" mais novos
// oscilam entre 200 e 503 por demanda; o lite costuma estar disponível).
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";

const octokit = process.env.GH_TOKEN ? new Octokit({ auth: process.env.GH_TOKEN }) : null;
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "/").split("/");

const PALAVRAS_CHAVE = [
  "ia", "ai", "artificial intelligence", "llm", "modelo de linguagem",
  "agente", "agent", "agentic", "anthropic", "claude", "openai", "chatgpt",
  "gemini", "google ai", "meta ai", "llama", "machine learning",
  "generative ai", "multimodal", "copilot", "midjourney", "stable diffusion",
];

const JANELA_HORAS = 36; // um pouco mais largo que 24h pra não perder nada no fuso

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------

// Limitado a 50 chars: o callback_data do Telegram aceita no máximo 64 bytes e
// "unpublish:<slug>" precisa caber.
function slugify(texto) {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50)
    .replace(/-+$/, "");
}

function bateComKeyword(texto) {
  const t = texto.toLowerCase();
  // "ai" e "ia" são curtos demais e batem como substring dentro de palavras
  // comuns (ex: "raises", "brasilia") — por isso exigem palavra inteira.
  const termosCurtos = ["ai", "ia"];
  const termosLongos = PALAVRAS_CHAVE.filter((k) => !termosCurtos.includes(k));

  const bateLongo = termosLongos.some((k) => t.includes(k));
  const bateCurto = termosCurtos.some((k) => new RegExp(`\\b${k}\\b`, "i").test(t));

  return bateLongo || bateCurto;
}

function dentroDaJanela(timestampMs) {
  const horasAtras = (Date.now() - timestampMs) / (1000 * 60 * 60);
  return horasAtras >= 0 && horasAtras <= JANELA_HORAS;
}

async function carregarFontesJaUsadas() {
  const usadas = new Set();
  try {
    const arquivos = await fs.readdir(CONTENT_DIR);
    for (const arquivo of arquivos) {
      if (!arquivo.endsWith(".md")) continue;
      const raw = await fs.readFile(path.join(CONTENT_DIR, arquivo), "utf-8");
      const { data } = matter(raw);
      if (data.fonte_url) usadas.add(data.fonte_url);
    }
  } catch {
    // pasta ainda não existe na primeira execução — tudo bem
  }
  // Inclui data/published-sources.json: notícia despublicada via Telegram sai de
  // src/content/noticias, mas a fonte continua registrada aqui e não deve voltar.
  try {
    const lista = JSON.parse(await fs.readFile(PUBLISHED_SOURCES_PATH, "utf-8"));
    if (Array.isArray(lista)) lista.forEach((u) => usadas.add(u));
  } catch {
    // arquivo ainda não existe ou ilegível — segue só com os .md
  }
  return usadas;
}

// Rascunhos já esperando aprovação (Issues abertas com label news-draft), pra
// não criar Issue duplicada a cada execução.
async function carregarRascunhosPendentes() {
  const urls = new Set();
  if (!octokit) return urls;
  try {
    const issues = await octokit.issues.listForRepo({ owner, repo, state: "open", labels: "news-draft" });
    for (const issue of issues.data) {
      const match = issue.body?.match(/fonte_url:\s*"(.+?)"/);
      if (match) urls.add(match[1]);
    }
  } catch (err) {
    console.warn("Não consegui listar rascunhos pendentes:", redact(err.message));
  }
  return urls;
}

// Grava a fonte_url em data/published-sources.json — o mesmo arquivo que
// scripts/generate-news.ts lê pra não recriar rascunho de notícia já publicada
// por este script. Lê o array atual, dá push e escreve de volta (read-modify-
// write) a cada chamada, em vez de guardar uma cópia em memória durante todo
// o loop — reduz a janela de sobrescrita caso outro processo grave o mesmo
// arquivo entre duas iterações.
async function registrarFontePublicada(url) {
  let lista = [];
  try {
    const raw = await fs.readFile(PUBLISHED_SOURCES_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) lista = parsed;
  } catch {
    // arquivo ainda não existe ou está vazio/corrompido — começa do zero
  }

  if (lista.includes(url)) return;
  lista.push(url);

  await fs.mkdir(path.dirname(PUBLISHED_SOURCES_PATH), { recursive: true });
  await fs.writeFile(PUBLISHED_SOURCES_PATH, JSON.stringify(lista, null, 2) + "\n", "utf-8");
}

// ------------------------------------------------------------
// Fontes: data/fontes.json (todas RSS)
// ------------------------------------------------------------

async function carregarFontes() {
  const lista = JSON.parse(await fs.readFile(FONTES_PATH, "utf-8"));
  if (!Array.isArray(lista) || lista.length === 0) throw new Error("data/fontes.json vazio ou inválido");
  return lista;
}

async function buscarFontes(fontes) {
  const parser = new Parser();
  const itens = [];

  for (const fonte of fontes) {
    try {
      const feed = await parser.parseURL(fonte.url);
      for (const item of feed.items) {
        if (!item.title || !item.link) continue;
        const timestamp = new Date(item.isoDate ?? item.pubDate ?? 0).getTime();
        if (!dentroDaJanela(timestamp)) continue;
        if (!bateComKeyword(item.title)) continue;

        itens.push({
          titulo_original: item.title,
          link: item.link,
          fonte_nome: fonte.nome,
          autoPublicar: fonte.autoPublicar === true,
          peso: fonte.peso ?? 0,
          trecho: item.contentSnippet ?? "",
          publicado_em: new Date(timestamp).toISOString(),
        });
      }
    } catch (err) {
      console.warn(`Fonte "${fonte.nome}" falhou:`, redact(err.message));
    }
  }
  return itens;
}

// ------------------------------------------------------------
// LLM com fallback: Gemini (principal) -> Claude
// ------------------------------------------------------------

class AllProvidersFailedError extends Error {}

// Defesa em profundidade: nenhuma chave/token pode vazar em log ou alerta, mesmo
// que uma mensagem de erro de SDK/fetch inclua a URL ou o header da requisição.
function redact(texto) {
  let out = String(texto);
  for (const nome of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN", "GH_TOKEN"]) {
    const valor = process.env[nome];
    if (valor && valor.length >= 8) out = out.split(valor).join(`[${nome}]`);
  }
  return out;
}

async function chamarGemini(system, user, model) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY ausente");

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model,
    contents: user,
    config: { systemInstruction: system, responseMimeType: "application/json" },
  });
  if (!response.text) throw new Error("resposta vazia do Gemini (possível bloqueio de segurança)");
  return response.text;
}

async function chamarClaude(system, user) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Erro na API da Anthropic: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const texto = data.content.find((b) => b.type === "text")?.text;
  if (!texto) throw new Error("resposta do Claude sem bloco de texto");
  return texto;
}

// 503 "alta demanda" do Gemini costuma passar em segundos: 2 retentativas curtas
// antes de gastar o fallback (Claude). Outros erros (429 de cota, chave) não repetem.
async function comRetry(fn, rotulo) {
  const esperasMs = [2000, 6000];
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!/503|UNAVAILABLE/i.test(String(err.message)) || i >= esperasMs.length) throw err;
      console.warn(`  [LLM] ${rotulo} indisponível (503) — nova tentativa em ${esperasMs[i] / 1000}s.`);
      await new Promise((resolve) => setTimeout(resolve, esperasMs[i]));
    }
  }
}

async function callLLM(system, user) {
  const errosGemini = [];
  for (const modelo of new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL])) {
    try {
      const texto = await comRetry(() => chamarGemini(system, user, modelo), modelo);
      console.log(`  [LLM] respondeu: Gemini (${modelo})${modelo === GEMINI_MODEL ? "" : " [modelo reserva]"}`);
      return texto;
    } catch (err) {
      errosGemini.push(`${modelo}: ${redact(err.message)}`);
      console.warn(`  [LLM] Gemini ${modelo} falhou (${redact(err.message)}).`);
    }
  }
  console.warn("  [LLM] Gemini indisponível — tentando Claude.");

  try {
    const texto = await chamarClaude(system, user);
    console.log(`  [LLM] respondeu: Claude (${MODEL}) [fallback]`);
    return texto;
  } catch (err) {
    throw new AllProvidersFailedError(`Gemini: ${errosGemini.join(" / ")} | Claude: ${redact(err.message)}`);
  }
}

function removerCercas(texto) {
  return texto.replace(/```json|```/g, "").trim();
}

// ------------------------------------------------------------
// Telegram (todas as chamadas checam res.ok e nunca lançam)
// ------------------------------------------------------------

async function telegramSend(payload, rotulo) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) {
    console.warn(`Telegram (${rotulo}) não enviado: TELEGRAM_CHAT_ID/TELEGRAM_BOT_TOKEN ausentes.`);
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...payload }),
    });
    if (!res.ok) {
      console.error(`Telegram recusou (${rotulo}): ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Falha ao chamar o Telegram (${rotulo}):`, redact(err.message));
    return false;
  }
}

// Alerta de falha: no máximo 1 a cada 6h. O estado (.alert-state/last-alert.json)
// é restaurado/salvo entre execuções pelo actions/cache nos workflows. O exit
// code 1 do job não depende disso — o limite só evita spam no Telegram.
async function enviarAlertaTelegram(texto) {
  try {
    const { ts } = JSON.parse(await fs.readFile(ALERT_STATE_PATH, "utf-8"));
    if (Date.now() - ts < ALERT_COOLDOWN_MS) {
      console.warn("Alerta suprimido (já houve um alerta de falha nas últimas 6h):", texto);
      return;
    }
  } catch {
    // sem estado anterior — pode alertar
  }

  if (await telegramSend({ text: texto }, "alerta")) {
    await fs.mkdir(path.dirname(ALERT_STATE_PATH), { recursive: true });
    await fs.writeFile(ALERT_STATE_PATH, JSON.stringify({ ts: Date.now() }), "utf-8");
  }
}

// ------------------------------------------------------------
// Geração do artigo (LLM reescreve, nunca copia)
// ------------------------------------------------------------

async function gerarArtigo(item) {
  const systemPrompt = `Você é um editor de um portal de notícias de IA em português brasileiro.
Sua tarefa é ESCREVER UM ARTIGO ORIGINAL a partir de um título e link de notícia,
usando seu conhecimento geral do assunto. NUNCA copie frases da fonte — você não tem
acesso ao texto completo dela, então escreva com base no que o título indica e no
contexto que você já conhece sobre o tema.

Regras:
- Português brasileiro, tom jornalístico, direto, sem clickbait vazio.
- Corpo do artigo: 3 a 5 parágrafos curtos, formato markdown simples.
- Sempre deixe claro que a informação original veio da fonte citada, com uma frase
  do tipo "segundo [fonte]" ou "de acordo com [fonte]" pelo menos uma vez no texto.
- Nunca invente números, citações diretas ou fatos específicos que você não tem
  certeza — se não souber um detalhe, mantenha o parágrafo mais geral.
- Retorne APENAS um JSON válido, sem markdown fences, no formato:
{
  "titulo": "título reescrito, natural em PT-BR, sem ser tradução literal",
  "resumo": "1-2 linhas, gatilho de curiosidade pro card e pro carrossel",
  "tags": ["tag1", "tag2"],
  "corpo": "corpo do artigo em markdown, 3 a 5 parágrafos"
}`;

  const regraExtra = item.autoPublicar
    ? "\nREGRA EXTRA: esta matéria pode ser publicada sem revisão humana. Use APENAS fatos, números, nomes e afirmações presentes no título/trecho acima — não acrescente números, citações, datas ou detalhes que não estejam lá; no contexto, seja genérico."
    : "";

  const userPrompt = `Título original (pode estar em inglês): ${item.titulo_original}
Trecho: ${item.trecho || "(sem trecho disponível)"}
Fonte: ${item.fonte_nome}
Link: ${item.link}${regraExtra}`;

  const textoResposta = await callLLM(systemPrompt, userPrompt);
  return JSON.parse(removerCercas(textoResposta));
}

// Checagem de segurança (mesma de scripts/generate-news.ts): só o que está no
// título/trecho da fonte pode aparecer no artigo. fiel != true, JSON inválido
// ou qualquer dúvida = NÃO publica direto.
async function checarFidelidade(item, artigo) {
  const system = "Você é um verificador de fatos rigoroso.";
  const user = `Compare o ARTIGO com a FONTE.
A FONTE é só o título e o trecho abaixo — nada além disso pode ser considerado conhecido.

FONTE (${item.fonte_nome}):
Título: ${item.titulo_original}
Trecho: ${item.trecho || "(sem trecho disponível)"}

ARTIGO (em português):
Título: ${artigo.titulo}
Resumo: ${artigo.resumo}
Corpo:
${artigo.corpo}

Verifique se TODOS os números, datas, nomes (pessoas, empresas, produtos) e afirmações factuais do artigo constam no título/trecho da fonte. Tradução e reformulação são aceitas; qualquer fato, número, nome, citação ou conclusão que NÃO conste na fonte torna o artigo infiel.

Responda em JSON puro: {"fiel": true|false, "motivo": "explicação curta; se infiel, cite o que não consta na fonte"}`;

  const texto = await callLLM(system, user);
  try {
    const parsed = JSON.parse(removerCercas(texto));
    return { fiel: parsed.fiel === true, motivo: String(parsed.motivo ?? "") };
  } catch {
    return { fiel: false, motivo: "resposta da checagem de fidelidade não era JSON válido" };
  }
}

// ------------------------------------------------------------
// Destinos: rascunho (Issue + Telegram) ou publicação direta (arquivo)
// ------------------------------------------------------------

// Mesmo formato do rascunho de scripts/generate-news.ts — o webhook grava o
// corpo da Issue (sem os comentários de controle) em src/content/noticias/.
// Sem `capa`: a capa é resolvida pelo site/scripts de capa (src/lib/capa.ts).
async function criarRascunho(item, artigo, slug) {
  if (!octokit) {
    console.warn("  GH_TOKEN ausente — rascunho NÃO criado (rode no GitHub Actions).");
    return false;
  }

  const body = `<!-- slug: ${slug} -->
---
titulo: "${artigo.titulo.replace(/"/g, '\\"')}"
resumo: "${artigo.resumo.replace(/"/g, '\\"')}"
data: "${new Date().toISOString()}"
fonte_url: "${item.link}"
fonte_nome: "${item.fonte_nome}"
tags: [${(artigo.tags ?? []).map((t) => `"${t}"`).join(", ")}]
---

${artigo.corpo}
`;

  const issue = await octokit.issues.create({
    owner,
    repo,
    title: `[draft] ${artigo.titulo}`,
    body,
    labels: ["news-draft"],
  });

  await telegramSend(
    {
      text: `📰 Novo rascunho: *${artigo.titulo}*`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Publicar", callback_data: `publish:${issue.data.number}` },
            { text: "❌ Descartar", callback_data: `discard:${issue.data.number}` },
          ],
        ],
      },
    },
    `rascunho #${issue.data.number}`
  );
  return true;
}

async function slugUnico(titulo) {
  const base = slugify(titulo) || `noticia-${Date.now().toString(36)}`;
  try {
    await fs.access(path.join(CONTENT_DIR, `${base}.md`));
  } catch {
    return base;
  }
  return `${base.slice(0, 45)}-${Date.now().toString(36).slice(-4)}`;
}

async function publicarArquivo(item, artigo, slug) {
  const frontmatter = {
    titulo: artigo.titulo,
    resumo: artigo.resumo,
    data: new Date().toISOString().slice(0, 10),
    fonte_url: item.link,
    fonte_nome: item.fonte_nome,
    tags: artigo.tags,
  };

  const caminho = path.join(CONTENT_DIR, `${slug}.md`);
  await fs.writeFile(caminho, matter.stringify(artigo.corpo, frontmatter), "utf-8");
  await registrarFontePublicada(item.link);
  console.log(`  -> publicado direto em ${caminho}`);
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {
  if (!GEMINI_API_KEY && !API_KEY) {
    console.error("ERRO: defina GEMINI_API_KEY e/ou ANTHROPIC_API_KEY antes de rodar.");
    await enviarAlertaTelegram("⚠️ Pipeline falhou: nenhuma chave de LLM configurada (GEMINI_API_KEY/ANTHROPIC_API_KEY)");
    process.exit(1);
  }

  console.log("Buscando notícias de IA...");
  const fontes = await carregarFontes();
  const candidatos = await buscarFontes(fontes);
  console.log(`Encontrados ${candidatos.length} candidatos (${fontes.length} fontes) dentro da janela e do filtro.`);

  const [jaUsadas, pendentes] = await Promise.all([carregarFontesJaUsadas(), carregarRascunhosPendentes()]);
  const novos = candidatos
    .filter((c) => !jaUsadas.has(c.link) && !pendentes.has(c.link))
    .sort((a, b) => b.peso - a.peso)
    .slice(0, MAX_NOTICIAS);

  if (novos.length === 0) {
    console.log("Nada novo pra publicar hoje. Encerrando.");
    return;
  }

  await fs.mkdir(CONTENT_DIR, { recursive: true });

  let publicados = 0;
  let rascunhos = 0;
  let falhaApi = null;
  for (const item of novos) {
    try {
      console.log(`Gerando artigo: ${item.titulo_original}`);
      const artigo = await gerarArtigo(item);
      const slug = await slugUnico(artigo.titulo);

      let publicarDireto = false;
      if (item.autoPublicar) {
        const check = await checarFidelidade(item, artigo);
        publicarDireto = check.fiel;
        if (!check.fiel) console.log(`  Fidelidade reprovada — vai pra aprovação manual: ${check.motivo}`);
      }

      if (publicarDireto) {
        await publicarArquivo(item, artigo, slug);
        publicados++;
        // O arquivo só vai pro ar quando o workflow commitar/push (próximos passos).
        await telegramSend(
          {
            text: `✅ Publicado: ${artigo.titulo} (fonte: ${item.fonte_nome})`,
            reply_markup: {
              inline_keyboard: [[{ text: "↩️ Despublicar", callback_data: `unpublish:${slug}` }]],
            },
          },
          `publicado ${slug}`
        );
      } else if (await criarRascunho(item, artigo, slug)) {
        rascunhos++;
      }
    } catch (err) {
      console.error(`  Falhou pra "${item.titulo_original}":`, redact(err.message));
      if (err instanceof AllProvidersFailedError) {
        // Os dois provedores caíram — insistir nos próximos itens só gasta tempo.
        falhaApi = err.message;
        await enviarAlertaTelegram(`⚠️ Pipeline falhou: todos os provedores de LLM falharam (${falhaApi})`);
        break;
      }
    }
  }

  console.log(`Concluído. Publicados direto: ${publicados} | Rascunhos p/ aprovação: ${rascunhos} (de ${novos.length} item(ns)).`);

  // Falha de API sem nada processado: o job precisa ficar vermelho, não verde.
  if (falhaApi && publicados + rascunhos === 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(redact(err?.stack ?? String(err)));
  await enviarAlertaTelegram(`⚠️ Pipeline falhou: ${redact(err?.message ?? String(err))}`);
  process.exit(1);
});
