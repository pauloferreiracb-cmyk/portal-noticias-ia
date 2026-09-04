#!/usr/bin/env node
/**
 * Gera uma imagem de capa por artigo usando o Gemini (modelo "Nano Banana"
 * de geração de imagem), no estilo visual PROMPT MÍDIA (dark obsidiana,
 * ciano elétrico + violeta neural, editorial tech minimalista).
 *
 * Fica em public/capas-ia/<slug>.png — separado do carrossel do Satori
 * (public/carrossel/), que continua existindo pra postagem no Instagram/TikTok.
 * A homepage prioriza essa capa de IA; se não existir, cai pro slide-1 do
 * carrossel como hoje.
 *
 * Uso:
 *   node scripts/gerar-capa-ia.mjs            -> gera só o que falta
 *   node scripts/gerar-capa-ia.mjs --forcar   -> regenera tudo
 *
 * Variável de ambiente obrigatória:
 *   GEMINI_API_KEY  chave grátis criada em https://aistudio.google.com/apikey
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const DIR_NOTICIAS = path.join(RAIZ, 'src/content/noticias');
const DIR_SAIDA = path.join(RAIZ, 'public/capas-ia');

const FORCAR = process.argv.includes('--forcar');

// Modelo "Nano Banana" — gemini-2.5-flash-image é o estável (GA) com tier
// grátis. Se quiser testar o mais novo/rápido, troque por
// "gemini-3.1-flash-lite-image" (confira disponibilidade no tier grátis
// em https://ai.google.dev/pricing antes de trocar em produção).
const MODELO = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error('[erro] Defina a variável de ambiente GEMINI_API_KEY (chave grátis em https://aistudio.google.com/apikey).');
  process.exit(1);
}

function lerArtigos() {
  return fs
    .readdirSync(DIR_NOTICIAS)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(DIR_NOTICIAS, f), 'utf-8');
      const { data } = matter(raw);
      return { slug, ...data };
    });
}

function montarPrompt(artigo) {
  const tema = [artigo.titulo, ...(artigo.tags ?? [])].join(', ');
  return (
    `Editorial tech illustration for a Brazilian AI news article about: ${tema}. ` +
    `Dark obsidian background (#0A0E17), electric cyan (#00F0FF) and neural violet ` +
    `(#7000FF) accent lighting, glowing gradient light beams, subtle geometric tech ` +
    `grid, minimalist and abstract composition, high contrast, moody cinematic lighting, ` +
    `wide 16:9 landscape crop. ` +
    `IMPORTANT: no text, no words, no letters, no logos, no watermarks anywhere in the image.`
  );
}

async function gerarImagem(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  if (!resp.ok) {
    const corpo = await resp.text();
    throw new Error(`Gemini respondeu ${resp.status}: ${corpo}`);
  }

  const json = await resp.json();
  const partes = json?.candidates?.[0]?.content?.parts ?? [];
  const imagem = partes.find((p) => p.inlineData || p.inline_data);
  const dados = imagem?.inlineData?.data ?? imagem?.inline_data?.data;

  if (!dados) {
    throw new Error('Nenhuma imagem retornada pelo Gemini. Resposta completa: ' + JSON.stringify(json).slice(0, 500));
  }

  return Buffer.from(dados, 'base64');
}

async function main() {
  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  const artigos = lerArtigos();

  if (artigos.length === 0) {
    console.log('Nenhum artigo encontrado em src/content/noticias/.');
    return;
  }

  for (const artigo of artigos) {
    const destino = path.join(DIR_SAIDA, `${artigo.slug}.png`);

    if (fs.existsSync(destino) && !FORCAR) {
      console.log(`[pular] ${artigo.slug} já tem capa de IA (use --forcar pra refazer)`);
      continue;
    }

    try {
      console.log(`[gerando] ${artigo.slug}...`);
      const prompt = montarPrompt(artigo);
      const png = await gerarImagem(prompt);
      fs.writeFileSync(destino, png);
      console.log(`[ok] public/capas-ia/${artigo.slug}.png`);
    } catch (err) {
      console.error(`[falhou] ${artigo.slug}: ${err.message}`);
    }

    // Respeita o rate limit do tier grátis (evita rajada de chamadas)
    await new Promise((r) => setTimeout(r, 4000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

