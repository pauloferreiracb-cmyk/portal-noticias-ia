// scripts/generate-news.ts
//
// Roda via GitHub Actions (.github/workflows/generate-news.yml).
// Busca notícias de IA em várias fontes, filtra o que já foi usado,
// pede pro Claude traduzir/gerar o gancho, escrever o corpo da matéria
// e checar clickbait, busca uma imagem de capa e cria uma Issue de rascunho
// no repo — notificando você no Telegram com botões de Publicar/Descartar.

import fs from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import matter from "gray-matter";

// --- Fontes ---------------------------------------------------------------
// Ajuste/adicione fontes livremente. Todas têm RSS gratuito.
const SOURCES = [
  { name: "Hacker News (IA)", url: "https://hnrss.org/newest?q=AI+OR+%22artificial+intelligence%22" },
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
  { name: "Ars Technica AI", url: "https://arstechnica.com/ai/feed/" },
  { name: "MIT Tech Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed" },
  { name: "OpenAI Blog", url: "https://openai.com/news/rss.xml" },
  { name: "Google DeepMind Blog", url: "https://deepmind.google/blog/rss.xml" },
];

// Trava de volume por execução (evita publicar demais de uma vez).
// Com cron de 3 em 3h e 4 por execução, o teto teórico é 32/dia — na prática
// bem menos, porque a maioria dos candidatos é descartada pelo filtro de relevância.
const MAX_DRAFTS_PER_RUN = 4;

// Quantas manchetes recentes (publicadas + rascunhos pendentes) entram no
// prompt do Claude pra checagem de duplicata semântica (item 1 do pedido).
const RECENT_TITLES_LIMIT = 15;
const NOTICIAS_DIR = path.join(process.cwd(), "src/content/noticias");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const octokit = new Octokit({ auth: process.env.GH_TOKEN! });
const [owner, repo] = process.env.GITHUB_REPOSITORY!.split("/");

type Candidate = {
  title: string;
  link: string;
  source: string;
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
async function fetchAllSources(): Promise<Candidate[]> {
  const parser = new Parser();
  const all: Candidate[] = [];

  for (const src of SOURCES) {
    try {
      const feed = await parser.parseURL(src.url);
      for (const item of feed.items.slice(0, 10)) {
        if (!item.link || !item.title) continue;
        all.push({
          title: item.title,
          link: item.link,
          source: src.name,
          contentSnippet: item.contentSnippet,
        });
      }
    } catch (err) {
      console.error(`Falha ao ler a fonte "${src.name}":`, err);
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

// --- 3. Claude: traduzir, gerar gancho, escrever corpo, julgar clickbait e duplicata --
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

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  let parsed: any;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    console.warn("Resposta do Claude não era JSON válido, pulando candidato.");
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

// --- 4. Imagem de capa (Unsplash) ------------------------------------------
async function fetchCoverImage(query: string) {
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

// --- 5. Criar Issue de rascunho ---------------------------------------------
// Frontmatter bate com o schema real de src/content/config.ts
// (titulo, resumo, data, fonte_url, fonte_nome, tags, capa).
// O slug e o crédito da imagem viajam como comentários HTML fora do
// frontmatter — o webhook usa e depois remove antes de gravar o arquivo final.
function buildSlug(title: string) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function createDraftIssue(
  candidate: Candidate,
  draft: Draft,
  cover: { url: string; credit: string; creditUrl: string }
) {
  const slug = buildSlug(draft.titulo);

  const body = `<!-- slug: ${slug} -->
<!-- capa-credit: ${cover.credit} (${cover.creditUrl}) -->
---
titulo: "${draft.titulo.replace(/"/g, '\\"')}"
resumo: "${draft.resumo.replace(/"/g, '\\"')}"
data: "${new Date().toISOString()}"
fonte_url: "${candidate.link}"
fonte_nome: "${candidate.source}"
tags: [${draft.tags.map((t) => `"${t}"`).join(", ")}]
capa: "${cover.url}"
---

${draft.corpo}
`;

  const issue = await octokit.issues.create({
    owner,
    repo,
    title: `[draft] ${draft.titulo}`,
    body,
    labels: ["news-draft"],
  });

  return { issueNumber: issue.data.number, title: draft.titulo };
}

// --- 6. Notificar no Telegram ------------------------------------------------
async function notifyTelegram(draft: { issueNumber: number; title: string }) {
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
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
    }),
  });
}

// --- main --------------------------------------------------------------------
async function main() {
  const [candidates, published, pending, recentPublishedTitles] = await Promise.all([
    fetchAllSources(),
    loadPublishedUrls(),
    loadPendingDrafts(),
    loadRecentPublishedTitles(RECENT_TITLES_LIMIT),
  ]);

  const recentTitles = [...recentPublishedTitles, ...pending.titles];

  const fresh = candidates.filter((c) => !published.has(c.link) && !pending.urls.has(c.link));

  let created = 0;
  for (const candidate of fresh) {
    if (created >= MAX_DRAFTS_PER_RUN) break;

    const draft = await judgeAndDraft(candidate, recentTitles);
    if (!draft) continue;

    const cover = await fetchCoverImage(draft.tags[0] ?? "inteligência artificial");
    const issueRef = await createDraftIssue(candidate, draft, cover);
    await notifyTelegram(issueRef);
    created++;
  }

  console.log(`Rascunhos criados nesta execução: ${created} (de ${fresh.length} candidatos novos)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
