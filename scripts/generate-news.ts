// scripts/generate-news.ts
//
// Roda via GitHub Actions (.github/workflows/generate-news.yml).
// Busca notícias de IA nas fontes de data/fontes.json, filtra o que já foi usado,
// pede pro LLM (Gemini, com fallback Claude) traduzir/gerar o gancho, escrever o
// corpo da matéria e checar clickbait, e busca uma imagem de capa.
//  - fonte com autoPublicar=true + artigo aprovado na checagem de fidelidade:
//    commita o .md direto em src/content/noticias e avisa no Telegram, com botão
//    "Despublicar".
//  - caso contrário: cria uma Issue de rascunho e pede aprovação no Telegram
//    (botões Publicar/Descartar).

import fs from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { Octokit } from "@octokit/rest";
import matter from "gray-matter";

// --- Fontes ---------------------------------------------------------------
// Editáveis em data/fontes.json: { nome, url, autoPublicar, peso }.
// peso maior = candidatos da fonte são processados primeiro.
type Source = { nome: string; url: string; autoPublicar: boolean; peso: number };

async function loadSources(): Promise<Source[]> {
  const raw = await fs.readFile(path.join(process.cwd(), "data/fontes.json"), "utf-8");
  const list = JSON.parse(raw);
  if (!Array.isArray(list) || list.length === 0) throw new Error("data/fontes.json vazio ou inválido");
  return list as Source[];
}

// Trava de volume por execução (evita publicar demais de uma vez).
// Com cron de 3 em 3h e 4 por execução, o teto teórico é 32/dia — na prática
// bem menos, porque a maioria dos candidatos é descartada pelo filtro de relevância.
const MAX_DRAFTS_PER_RUN = 4;

// Quantas manchetes recentes (publicadas + rascunhos pendentes) entram no
// prompt do Claude pra checagem de duplicata semântica (item 1 do pedido).
const RECENT_TITLES_LIMIT = 15;
const NOTICIAS_DIR = path.join(process.cwd(), "src/content/noticias");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
// Segundo modelo Gemini, tentado antes do Claude (os modelos "flash" mais novos
// oscilam entre 200 e 503 por demanda; o lite costuma estar disponível).
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const USE_GEMINI_IMAGES = process.env.USE_GEMINI_IMAGES === "true";
const CLAUDE_MODEL = "claude-sonnet-5";

// Alertas de falha: no máximo 1 a cada 6h. O estado (.alert-state/last-alert.json)
// é restaurado/salvo entre execuções pelo actions/cache nos workflows. O exit
// code 1 do job não depende disso — o limite só evita spam no Telegram.
const ALERT_STATE_PATH = path.join(process.cwd(), ".alert-state/last-alert.json");
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const octokit = new Octokit({ auth: process.env.GH_TOKEN! });
const [owner, repo] = process.env.GITHUB_REPOSITORY!.split("/");

type Candidate = {
  title: string;
  link: string;
  source: string;
  autoPublicar: boolean;
  peso: number;
  contentSnippet?: string;
};

// Nomes já em português/PT-BR pra bater direto com o schema de
// src/content/config.ts (collection "noticias").
type Draft = {
  titulo: string;
  resumo: string;
  corpo: string;
  tags: string[];
};

// --- 1. Buscar candidatos ---------------------------------------------------
async function fetchAllSources(sources: Source[]): Promise<Candidate[]> {
  const parser = new Parser();
  const all: Candidate[] = [];

  for (const src of sources) {
    try {
      const feed = await parser.parseURL(src.url);
      for (const item of feed.items.slice(0, 10)) {
        if (!item.link || !item.title) continue;
        all.push({
          title: item.title,
          link: item.link,
          source: src.nome,
          autoPublicar: src.autoPublicar === true,
          peso: src.peso ?? 0,
          contentSnippet: item.contentSnippet,
        });
      }
    } catch (err) {
      console.error(`Falha ao ler a fonte "${src.nome}":`, err);
    }
  }

  return all;
}

// --- 2. Dedupe: já publicado ou já esperando aprovação? -------------------
async function loadPublishedUrls(): Promise<Set<string>> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: "data/published-sources.json",
    });
    if ("content" in data) {
      const json = Buffer.from(data.content, "base64").toString("utf-8");
      return new Set(JSON.parse(json) as string[]);
    }
  } catch (err) {
    console.warn("Não achei data/published-sources.json ainda — seguindo com lista vazia.");
  }
  return new Set();
}

async function loadPendingDrafts(): Promise<{ urls: Set<string>; titles: string[] }> {
  const issues = await octokit.issues.listForRepo({
    owner,
    repo,
    state: "open",
    labels: "news-draft",
  });

  const urls = new Set<string>();
  const titles: string[] = [];
  for (const issue of issues.data) {
    const match = issue.body?.match(/fonte_url:\s*"(.+?)"/);
    if (match) urls.add(match[1]);
    // título da Issue já é "[draft] <título>" (ver createDraftIssue) — não
    // precisa parsear o body de novo.
    titles.push(issue.title.replace(/^\[draft\]\s*/, ""));
  }
  return { urls, titles };
}

// --- 2b. Últimas notícias publicadas, pra checagem de duplicata semântica --
async function loadRecentPublishedTitles(limit: number): Promise<string[]> {
  let arquivos: string[];
  try {
    arquivos = (await fs.readdir(NOTICIAS_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return []; // pasta ainda não existe (primeira execução)
  }

  const artigos: { titulo: string; data: number }[] = [];
  for (const arquivo of arquivos) {
    try {
      const raw = await fs.readFile(path.join(NOTICIAS_DIR, arquivo), "utf-8");
      const { data } = matter(raw);
      if (!data.titulo) continue;
      artigos.push({ titulo: data.titulo, data: new Date(data.data ?? 0).getTime() });
    } catch {
      // arquivo individual ilegível, pula
    }
  }

  return artigos
    .sort((a, b) => b.data - a.data)
    .slice(0, limit)
    .map((a) => a.titulo);
}

// --- 3a. LLM com fallback: Gemini (principal) -> Claude ----------------------
class AllProvidersFailedError extends Error {}

// Defesa em profundidade: nenhuma chave/token pode vazar em log ou alerta, mesmo
// que uma mensagem de erro de SDK/fetch inclua a URL ou o header da requisição.
function redact(text: string): string {
  let out = text;
  for (const name of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN", "GH_TOKEN"]) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join(`[${name}]`);
  }
  return out;
}

function errMsg(err: unknown): string {
  return redact(err instanceof Error ? err.message : String(err));
}

async function callGemini(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });
  const text = response.text;
  if (!text) throw new Error("resposta vazia do Gemini (possível bloqueio de segurança)");
  return text;
}

async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY ausente");

  const anthropic = new Anthropic({ apiKey });
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("resposta do Claude sem bloco de texto");
  return textBlock.text;
}

// 503 "alto demanda" do Gemini costuma passar em segundos: 2 retentativas curtas
// antes de gastar o fallback (Claude). Outros erros (429 de cota, chave) não repetem.
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delaysMs = [2000, 6000];
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!/503|UNAVAILABLE/i.test(errMsg(err)) || i >= delaysMs.length) throw err;
      console.warn(`[LLM] ${label} indisponível (503) — nova tentativa em ${delaysMs[i] / 1000}s.`);
      await new Promise((resolve) => setTimeout(resolve, delaysMs[i]));
    }
  }
}

async function callLLM(prompt: string): Promise<string> {
  const geminiErrs: string[] = [];
  const geminiModels = [...new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL])];
  for (const model of geminiModels) {
    try {
      const text = await withRetry(() => callGemini(prompt, model), model);
      console.log(`[LLM] respondeu: Gemini (${model})${model === GEMINI_MODEL ? "" : " [modelo reserva]"}`);
      return text;
    } catch (err) {
      geminiErrs.push(`${model}: ${errMsg(err)}`);
      console.warn(`[LLM] Gemini ${model} falhou (${errMsg(err)}).`);
    }
  }
  console.warn("[LLM] Gemini indisponível — tentando Claude.");

  try {
    const text = await callClaude(prompt);
    console.log(`[LLM] respondeu: Claude (${CLAUDE_MODEL}) [fallback]`);
    return text;
  } catch (err) {
    throw new AllProvidersFailedError(`Gemini: ${geminiErrs.join(" / ")} | Claude: ${errMsg(err)}`);
  }
}

// Gemini costuma envolver o JSON em ```json ... ```.
function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

// --- 3b. Traduzir, gerar gancho, escrever corpo, julgar clickbait e duplicata --
async function judgeAndDraft(candidate: Candidate, recentTitles: string[]): Promise<Draft | null> {
  const listaTitulosRecentes =
    recentTitles.length > 0
      ? recentTitles.map((t) => `- ${t}`).join("\n")
      : "(nenhuma notícia recente registrada)";

  const prompt = `Você é o editor-chefe do PromptMídia, portal de notícias de IA em português do Brasil.
Tom: direto, jornalístico. Gatilho de curiosidade real, NUNCA clickbait enganoso — o título tem que ser cumprido pela matéria.

Notícia original (fonte: ${candidate.source}):
Título: ${candidate.title}
Resumo/trecho: ${candidate.contentSnippet ?? "(sem resumo disponível, use só o título)"}
Link: ${candidate.link}
${candidate.autoPublicar ? "\nREGRA EXTRA: esta matéria pode ser publicada sem revisão humana. Use APENAS fatos, números, nomes e afirmações presentes no título/trecho acima — não acrescente números, citações, datas ou detalhes que não estejam lá; no contexto, seja genérico.\n" : ""}
Manchetes já publicadas ou em rascunho pendente (mais recentes primeiro — pode haver mesmo fato com fonte/URL diferente):
${listaTitulosRecentes}

Tarefas:
1. Decida se essa notícia é relevante pro nicho de IA/tecnologia pra um público brasileiro.
   Se NÃO for relevante (ex: é sobre outro assunto, é opinião fraca, é reciclagem de algo já batido), responda só: {"relevante": false}
2. Verifique se o candidato cobre o MESMO FATO/acontecimento de alguma manchete da lista acima — não precisa ser texto idêntico, é sobre o mesmo evento. Se sim, preencha "duplicataDe" com o título exato da lista que já cobre isso; se não houver duplicata, "duplicataDe": null.
3. Se for relevante E não for duplicata, traduza/adapte pro português do Brasil e gere:
   - titulo: manchete com gancho real (máximo 90 caracteres)
   - resumo: 1 a 2 frases que expandem o gancho sem entregar tudo (usado como teaser/meta description)
   - corpo: matéria completa em 3 a 4 parágrafos, em markdown puro (sem título, o título já vai no frontmatter), com contexto e desenvolvimento — não repita o resumo literalmente
   - tags: até 4 tags curtas em português
   - clickbaitCheck: "ok" se o titulo é totalmente cumprido pelo resumo + corpo, senão "ajustar" (e nesse caso não gere o restante, retorne relevante: false)

Responda em JSON puro, sem markdown e sem texto fora do JSON:
{"relevante": true, "duplicataDe": null, "titulo": "...", "resumo": "...", "corpo": "...", "tags": ["...", "..."], "clickbaitCheck": "ok"}`;

  const text = await callLLM(prompt);

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    console.warn("Resposta do LLM não era JSON válido, pulando candidato.");
    return null;
  }

  if (parsed.duplicataDe) {
    console.log(`Duplicata evitada: "${candidate.title}" já coberta por "${parsed.duplicataDe}".`);
    return null;
  }

  if (!parsed.relevante || parsed.clickbaitCheck !== "ok") return null;

  return {
    titulo: parsed.titulo,
    resumo: parsed.resumo,
    corpo: parsed.corpo ?? "",
    tags: parsed.tags ?? [],
  };
}

// --- 3c. Checagem de segurança (fidelidade à fonte) --------------------------
// Segundo passe: só o que está no título/trecho da fonte pode aparecer no artigo.
// Qualquer dúvida (resposta ilegível, fiel != true) = não publica direto.
async function checkFidelity(candidate: Candidate, draft: Draft): Promise<{ fiel: boolean; motivo: string }> {
  const prompt = `Você é um verificador de fatos rigoroso. Compare o ARTIGO com a FONTE.
A FONTE é só o título e o trecho abaixo — nada além disso pode ser considerado conhecido.

FONTE (${candidate.source}):
Título: ${candidate.title}
Trecho: ${candidate.contentSnippet ?? "(sem trecho disponível)"}

ARTIGO (em português):
Título: ${draft.titulo}
Resumo: ${draft.resumo}
Corpo:
${draft.corpo}

Verifique se TODOS os números, datas, nomes (pessoas, empresas, produtos) e afirmações factuais do artigo constam no título/trecho da fonte. Tradução e reformulação são aceitas; qualquer fato, número, nome, citação ou conclusão que NÃO conste na fonte torna o artigo infiel.

Responda em JSON puro: {"fiel": true|false, "motivo": "explicação curta; se infiel, cite o que não consta na fonte"}`;

  const text = await callLLM(prompt);
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    return { fiel: parsed.fiel === true, motivo: String(parsed.motivo ?? "") };
  } catch {
    return { fiel: false, motivo: "resposta da checagem de fidelidade não era JSON válido" };
  }
}

// --- 4. Imagem de capa -------------------------------------------------------
// Padrão: Unsplash. Com USE_GEMINI_IMAGES=true tenta Gemini primeiro; qualquer
// erro/cota cai pro Unsplash. A imagem do Gemini vai pra public/capas-ia/<slug>.png,
// que o site já resolve por slug (src/lib/capa.ts) — por isso nesse caso o
// frontmatter fica sem o campo `capa`.
type Cover = { url: string; credit: string; creditUrl: string };

async function fetchUnsplashCover(query: string): Promise<Cover> {
  const res = await fetch(
    `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } }
  );
  const data = await res.json();
  return {
    url: data?.urls?.regular ?? "",
    credit: data?.user?.name ?? "Unsplash",
    creditUrl: data?.user?.links?.html ?? "",
  };
}

async function generateGeminiCover(draft: Draft, slug: string): Promise<Cover> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_IMAGE_MODEL,
    contents: `Ilustração editorial moderna e limpa, formato paisagem, SEM nenhum texto ou letra na imagem, para a matéria de tecnologia: "${draft.titulo}"`,
  });
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Gemini não devolveu imagem");

  await commitFile(
    `public/capas-ia/${slug}.png`,
    Buffer.from(part.inlineData.data, "base64"),
    `chore(capas): capa gerada por IA para "${slug}"`
  );
  return { url: "", credit: "Gerada por IA (Gemini)", creditUrl: "" };
}

async function resolveCover(draft: Draft, slug: string): Promise<Cover> {
  if (USE_GEMINI_IMAGES) {
    try {
      const cover = await generateGeminiCover(draft, slug);
      console.log("[Capa] Gemini");
      return cover;
    } catch (err) {
      console.warn(`[Capa] Gemini falhou (${errMsg(err)}) — usando Unsplash.`);
    }
  }
  const cover = await fetchUnsplashCover(draft.tags[0] ?? "inteligência artificial");
  console.log("[Capa] Unsplash");
  return cover;
}

// --- 5. Persistência no repo -------------------------------------------------
// Frontmatter bate com o schema real de src/content/config.ts
// (titulo, resumo, data, fonte_url, fonte_nome, tags, capa).
// No fluxo de rascunho, o slug e o crédito da imagem viajam como comentários
// HTML fora do frontmatter — o webhook usa e depois remove antes de gravar o
// arquivo final.
// slug limitado a 50 chars: o callback_data do Telegram aceita no máximo 64
// bytes e "unpublish:<slug>" precisa caber.
function buildSlug(title: string) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50)
    .replace(/-$/, "");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await octokit.repos.getContent({ owner, repo, path: filePath });
    return true;
  } catch (err: any) {
    if (err?.status === 404) return false;
    throw err;
  }
}

async function uniqueSlug(title: string): Promise<string> {
  const base = buildSlug(title) || `noticia-${Date.now().toString(36)}`;
  if (!(await fileExists(`src/content/noticias/${base}.md`))) return base;
  return `${base.slice(0, 45)}-${Date.now().toString(36).slice(-4)}`;
}

async function commitFile(filePath: string, content: string | Buffer, message: string) {
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message,
    content: buf.toString("base64"),
  });
}

function buildArticleMarkdown(candidate: Candidate, draft: Draft, cover: Cover): string {
  return `---
titulo: "${draft.titulo.replace(/"/g, '\\"')}"
resumo: "${draft.resumo.replace(/"/g, '\\"')}"
data: "${new Date().toISOString()}"
fonte_url: "${candidate.link}"
fonte_nome: "${candidate.source}"
tags: [${draft.tags.map((t) => `"${t}"`).join(", ")}]
${cover.url ? `capa: "${cover.url}"\n` : ""}---

${draft.corpo}
`;
}

async function createDraftIssue(candidate: Candidate, draft: Draft, cover: Cover, slug: string) {
  const body = `<!-- slug: ${slug} -->
<!-- capa-credit: ${cover.credit} (${cover.creditUrl}) -->
${buildArticleMarkdown(candidate, draft, cover)}`;

  const issue = await octokit.issues.create({
    owner,
    repo,
    title: `[draft] ${draft.titulo}`,
    body,
    labels: ["news-draft"],
  });

  return { issueNumber: issue.data.number, title: draft.titulo };
}

// Mesma lógica de appendPublishedUrl do webhook (read-modify-write com sha).
async function appendPublishedUrl(url: string) {
  const filePath = "data/published-sources.json";
  let current: string[] = [];
  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath });
    if ("content" in data) {
      current = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
      sha = data.sha;
    }
  } catch (err: any) {
    if (err?.status !== 404) throw err;
  }
  if (current.includes(url)) return;
  current.push(url);

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: "chore: atualiza lista de fontes publicadas",
    content: Buffer.from(JSON.stringify(current, null, 2) + "\n").toString("base64"),
    sha,
  });
}

// Publicação direta. A URL é registrada em data/published-sources.json ANTES de
// commitar o .md: este script só consulta esse arquivo pra saber o que já foi
// usado, então uma falha no meio nunca pode permitir republicar a mesma notícia.
//  - registro falha  -> lança; nada foi publicado, o próximo run tenta de novo.
//  - .md falha (após 1 retry) -> a fonte já está registrada, então cai pra rascunho
//    (Issue + Telegram) em vez de a notícia se perder. Retorna "draft" nesse caso.
async function publishDirect(candidate: Candidate, draft: Draft, cover: Cover, slug: string): Promise<"published" | "draft"> {
  await appendPublishedUrl(candidate.link);

  const mdPath = `src/content/noticias/${slug}.md`;
  const message = `feat(noticias): publica "${slug}" automaticamente (fonte: ${candidate.source})`;
  const markdown = buildArticleMarkdown(candidate, draft, cover);
  try {
    try {
      await commitFile(mdPath, markdown, message);
    } catch (err) {
      console.warn(`Commit de "${slug}" falhou (${errMsg(err)}) — tentando de novo.`);
      await new Promise((r) => setTimeout(r, 2000));
      await commitFile(mdPath, markdown, message);
    }
    return "published";
  } catch (err) {
    console.error(`Não consegui commitar "${slug}" (fonte já registrada) — criando rascunho: ${errMsg(err)}`);
    const issueRef = await createDraftIssue(candidate, draft, cover, slug);
    await notifyTelegram(issueRef);
    return "draft";
  }
}

// --- 6. Telegram -------------------------------------------------------------
// Todas as chamadas checam res.ok e logam o erro; nunca lançam (uma falha de
// notificação não pode derrubar o pipeline nem desfazer uma publicação).
async function telegramSend(payload: Record<string, unknown>, label: string): Promise<boolean> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) {
    console.warn(`Telegram (${label}) não enviado: TELEGRAM_CHAT_ID/TELEGRAM_BOT_TOKEN ausentes.`);
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...payload }),
    });
    if (!res.ok) {
      console.error(`Telegram recusou (${label}): ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Falha ao chamar o Telegram (${label}): ${errMsg(err)}`);
    return false;
  }
}

async function notifyTelegram(draft: { issueNumber: number; title: string }) {
  await telegramSend(
    {
      text: `📰 Novo rascunho: *${draft.title}*`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Publicar", callback_data: `publish:${draft.issueNumber}` },
            { text: "❌ Descartar", callback_data: `discard:${draft.issueNumber}` },
          ],
        ],
      },
    },
    `rascunho #${draft.issueNumber}`
  );
}

async function notifyPublished(info: { slug: string; title: string; source: string }) {
  await telegramSend(
    {
      text: `✅ Publicado: ${info.title} (fonte: ${info.source})`,
      reply_markup: {
        inline_keyboard: [[{ text: "↩️ Despublicar", callback_data: `unpublish:${info.slug}` }]],
      },
    },
    `publicado ${info.slug}`
  );
}

// Alerta de falha do pipeline (no máximo 1 a cada 6h).
async function sendTelegramAlert(text: string) {
  try {
    const { ts } = JSON.parse(await fs.readFile(ALERT_STATE_PATH, "utf-8"));
    if (Date.now() - ts < ALERT_COOLDOWN_MS) {
      console.warn(`Alerta suprimido (já houve um alerta de falha nas últimas 6h): ${text}`);
      return;
    }
  } catch {
    // sem estado anterior — pode alertar
  }

  if (await telegramSend({ text }, "alerta")) {
    await fs.mkdir(path.dirname(ALERT_STATE_PATH), { recursive: true });
    await fs.writeFile(ALERT_STATE_PATH, JSON.stringify({ ts: Date.now() }), "utf-8");
  }
}

// --- main --------------------------------------------------------------------
async function main() {
  const sources = await loadSources();
  const [candidates, published, pending, recentPublishedTitles] = await Promise.all([
    fetchAllSources(sources),
    loadPublishedUrls(),
    loadPendingDrafts(),
    loadRecentPublishedTitles(RECENT_TITLES_LIMIT),
  ]);

  const recentTitles = [...recentPublishedTitles, ...pending.titles];

  // sort é estável: dentro do mesmo peso mantém a ordem original das fontes.
  const fresh = candidates
    .filter((c) => !published.has(c.link) && !pending.urls.has(c.link))
    .sort((a, b) => b.peso - a.peso);

  let drafts = 0;
  let autoPublished = 0;
  let apiFailure: string | null = null;
  for (const candidate of fresh) {
    if (drafts + autoPublished >= MAX_DRAFTS_PER_RUN) break;

    try {
      const draft = await judgeAndDraft(candidate, recentTitles);
      if (!draft) continue;

      let publicarDireto = false;
      if (candidate.autoPublicar) {
        const check = await checkFidelity(candidate, draft);
        publicarDireto = check.fiel;
        if (!check.fiel) {
          console.log(`Fidelidade reprovada ("${draft.titulo}") — vai pra aprovação manual: ${check.motivo}`);
        }
      }

      const slug = await uniqueSlug(draft.titulo);
      const cover = await resolveCover(draft, slug);

      if (publicarDireto) {
        if ((await publishDirect(candidate, draft, cover, slug)) === "published") {
          await notifyPublished({ slug, title: draft.titulo, source: candidate.source });
          autoPublished++;
        } else {
          drafts++;
        }
      } else {
        const issueRef = await createDraftIssue(candidate, draft, cover, slug);
        await notifyTelegram(issueRef);
        drafts++;
      }
      recentTitles.unshift(draft.titulo);
      published.add(candidate.link);
    } catch (err) {
      if (!(err instanceof AllProvidersFailedError)) throw err;
      // Os dois provedores caíram — insistir nos próximos candidatos só gasta tempo.
      apiFailure = err.message;
      console.error(`Todos os provedores de LLM falharam: ${apiFailure}`);
      await sendTelegramAlert(`⚠️ Pipeline falhou: todos os provedores de LLM falharam (${apiFailure})`);
      break;
    }
  }

  console.log(
    `Publicadas direto: ${autoPublished} | Rascunhos p/ aprovação: ${drafts} (de ${fresh.length} candidatos novos)`
  );

  // Falha de API sem nada processado: o job precisa ficar vermelho, não verde.
  if (apiFailure && drafts + autoPublished === 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(redact(err instanceof Error ? (err.stack ?? err.message) : String(err)));
  await sendTelegramAlert(`⚠️ Pipeline falhou: ${errMsg(err)}`);
  process.exit(1);
});
