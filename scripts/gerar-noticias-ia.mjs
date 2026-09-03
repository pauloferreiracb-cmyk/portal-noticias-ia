#!/usr/bin/env node
/**
 * Pipeline: Portal de Notícias de IA
 * ------------------------------------------------------------
 * 1. Busca itens recentes no Hacker News (API oficial) e no feed
 *    RSS da categoria de IA do TechCrunch.
 * 2. Filtra por palavras-chave do nicho e por janela de tempo.
 * 3. Ignora tudo que já foi publicado antes (dedupe por fonte_url).
 * 4. Pra cada item novo, chama a API da Anthropic pra REESCREVER
 *    (nunca copiar) um artigo original em PT-BR, com resumo pro
 *    card/carrossel e frontmatter no formato que o site espera.
 * 5. Salva em src/content/noticias/<slug>.md
 *
 * Uso:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/gerar-noticias-ia.mjs
 *
 * Variáveis de ambiente:
 *   ANTHROPIC_API_KEY   (obrigatória)
 *   CLAUDE_MODEL        (opcional, ver docs.claude.com/en/docs/about-claude/models)
 *   MAX_NOTICIAS        (opcional, default 3 por execução)
 * ------------------------------------------------------------
 */

import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const CONTENT_DIR = path.join(process.cwd(), "src/content/noticias");
const MAX_NOTICIAS = Number(process.env.MAX_NOTICIAS ?? 3);
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;

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

function slugify(texto) {
  return texto
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
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
  return usadas;
}

// ------------------------------------------------------------
// Fonte 1: Hacker News (API oficial, sem scraping)
// ------------------------------------------------------------

async function buscarHackerNews() {
  const idsResp = await fetch("https://hacker-news.firebaseio.com/v0/newstories.json");
  const ids = (await idsResp.json()).slice(0, 100); // primeiras 100 mais novas

  const itens = [];
  for (const id of ids) {
    try {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      const item = await r.json();
      if (!item?.title || !item?.url) continue;
      if (!dentroDaJanela(item.time * 1000)) continue;
      if (!bateComKeyword(item.title)) continue;

      itens.push({
        titulo_original: item.title,
        link: item.url,
        fonte_nome: "Hacker News",
        pontos: item.score ?? 0,
        publicado_em: new Date(item.time * 1000).toISOString(),
      });
    } catch {
      // item individual falhou, segue o baile
    }
  }
  return itens;
}

// ------------------------------------------------------------
// Fonte 2: TechCrunch AI (RSS oficial, sem scraping de HTML)
// ------------------------------------------------------------

function extrairTagsRSS(xml, tag) {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
  return [...xml.matchAll(regex)].map((m) =>
    m[1].replace("<![CDATA[", "").replace("]]>", "").trim()
  );
}

async function buscarTechCrunch() {
  const resp = await fetch("https://techcrunch.com/category/artificial-intelligence/feed/");
  const xml = await resp.text();

  const blocos = xml.split("<item>").slice(1);
  const itens = [];

  for (const bloco of blocos) {
    const titulo = extrairTagsRSS(bloco, "title")[0];
    const link = extrairTagsRSS(bloco, "link")[0];
    const pubDateStr = extrairTagsRSS(bloco, "pubDate")[0];
    if (!titulo || !link || !pubDateStr) continue;

    const timestamp = new Date(pubDateStr).getTime();
    if (!dentroDaJanela(timestamp)) continue;
    if (!bateComKeyword(titulo)) continue;

    itens.push({
      titulo_original: titulo,
      link,
      fonte_nome: "TechCrunch",
      pontos: 0,
      publicado_em: new Date(timestamp).toISOString(),
    });
  }
  return itens;
}

// ------------------------------------------------------------
// Geração do artigo (Claude reescreve, nunca copia)
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

  const userPrompt = `Título original (pode estar em inglês): ${item.titulo_original}
Fonte: ${item.fonte_nome}
Link: ${item.link}`;

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
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Erro na API da Anthropic: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const textoResposta = data.content.find((b) => b.type === "text")?.text ?? "";
  const limpo = textoResposta.replace(/```json|```/g, "").trim();

  return JSON.parse(limpo);
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {
  if (!API_KEY) {
    console.error("ERRO: defina ANTHROPIC_API_KEY antes de rodar.");
    process.exit(1);
  }

  console.log("Buscando notícias de IA...");
  const [hn, tc] = await Promise.allSettled([buscarHackerNews(), buscarTechCrunch()]);

  const candidatos = [
    ...(hn.status === "fulfilled" ? hn.value : []),
    ...(tc.status === "fulfilled" ? tc.value : []),
  ];

  if (hn.status === "rejected") console.warn("Hacker News falhou:", hn.reason?.message);
  if (tc.status === "rejected") console.warn("TechCrunch falhou:", tc.reason?.message);

  console.log(`Encontrados ${candidatos.length} candidatos (HN + TechCrunch) dentro da janela e do filtro.`);

  const jaUsadas = await carregarFontesJaUsadas();
  const novos = candidatos
    .filter((c) => !jaUsadas.has(c.link))
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, MAX_NOTICIAS);

  if (novos.length === 0) {
    console.log("Nada novo pra publicar hoje. Encerrando.");
    return;
  }

  await fs.mkdir(CONTENT_DIR, { recursive: true });

  let sucesso = 0;
  for (const item of novos) {
    try {
      console.log(`Gerando artigo: ${item.titulo_original}`);
      const artigo = await gerarArtigo(item);

      const slug = slugify(artigo.titulo);
      const dataHoje = new Date().toISOString().slice(0, 10);

      const frontmatter = {
        titulo: artigo.titulo,
        resumo: artigo.resumo,
        data: dataHoje,
        fonte_url: item.link,
        fonte_nome: item.fonte_nome,
        tags: artigo.tags,
      };

      const conteudoFinal = matter.stringify(artigo.corpo, frontmatter);
      const caminho = path.join(CONTENT_DIR, `${slug}.md`);
      await fs.writeFile(caminho, conteudoFinal, "utf-8");

      console.log(`  -> salvo em ${caminho}`);
      sucesso++;
    } catch (err) {
      console.error(`  Falhou pra "${item.titulo_original}":`, err.message);
    }
  }

  console.log(`Concluído. ${sucesso} de ${novos.length} artigo(s) gerado(s) com sucesso.`);
}

main();
