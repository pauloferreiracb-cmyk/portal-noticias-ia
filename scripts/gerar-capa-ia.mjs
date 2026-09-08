#!/usr/bin/env node
/**
 * Gera uma imagem de capa por artigo, no estilo visual PROMPT MÍDIA
 * (dark obsidiana, ciano elétrico + violeta neural, editorial tech
 * minimalista).
 *
 * Estratégia em 2 camadas:
 *   1. Pollinations (Flux) — imagem gerada por IA, grátis, sem chave,
 *      já no estilo da marca.
 *   2. Se falhar, cai pro Unsplash (foto real, grátis, precisa de
 *      UNSPLASH_ACCESS_KEY) — e grava o crédito do fotógrafo em
 *      public/capas-ia/<slug>.json pra exibir no site.
 *
 * Fica em public/capas-ia/<slug>.png — separado do carrossel do Satori
 * (public/carrossel/), que continua existindo pra postagem no Instagram/TikTok.
 *
 * Uso:
 *   node scripts/gerar-capa-ia.mjs            -> gera só o que falta
 *   node scripts/gerar-capa-ia.mjs --forcar   -> regenera tudo
 *
 * Variáveis de ambiente:
 *   UNSPLASH_ACCESS_KEY  opcional, mas necessária pro fallback funcionar.
 *                        Grátis em https://unsplash.com/developers
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
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

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

// --- Camada 1: Pollinations (Flux), gerado no estilo da marca ---

function montarPromptIA(artigo) {
  const tema = [artigo.titulo, ...(artigo.tags ?? [])].join(', ');
  return (
    `Editorial tech illustration for a Brazilian AI news article about: ${tema}. ` +
    `Dark obsidian background (#0A0E17), electric cyan (#00F0FF) and neural violet ` +
    `(#7000FF) accent lighting, glowing gradient light beams, subtle geometric tech ` +
    `grid, minimalist and abstract composition, high contrast, moody cinematic lighting, ` +
    `wide 16:9 landscape crop. ` +
    `No text, no words, no letters, no logos, no watermarks anywhere in the image.`
  );
}

// hash simples e determinístico só pra dar uma seed estável por artigo
function seedDoSlug(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 100000;
}

async function gerarViaPollinations(artigo) {
  const prompt = montarPromptIA(artigo);
  const seed = seedDoSlug(artigo.slug);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=1280&height=720&nologo=true&seed=${seed}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Pollinations respondeu ${resp.status}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length < 2000) throw new Error('Pollinations retornou um arquivo suspeito de pequeno');

  return { buffer, credito: null }; // Pollinations não exige crédito
}

// --- Camada 2 (fallback): Unsplash, foto real ---

async function buscarViaUnsplash(artigo) {
  if (!UNSPLASH_ACCESS_KEY) {
    throw new Error('UNSPLASH_ACCESS_KEY não configurada — sem fallback disponível');
  }

  const query = (artigo.tags?.[0] ?? artigo.titulo).slice(0, 60);
  const urlBusca =
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}` +
    `&orientation=landscape&per_page=1&content_filter=high`;

  const respBusca = await fetch(urlBusca, {
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
  });
  if (!respBusca.ok) throw new Error(`Unsplash (busca) respondeu ${respBusca.status}`);

  const jsonBusca = await respBusca.json();
  const foto = jsonBusca.results?.[0];
  if (!foto) throw new Error(`Unsplash não retornou nenhuma foto pra "${query}"`);

  // Baixa a imagem em si
  const respImagem = await fetch(foto.urls.regular);
  if (!respImagem.ok) throw new Error(`Unsplash (download da imagem) respondeu ${respImagem.status}`);
  const buffer = Buffer.from(await respImagem.arrayBuffer());

  // Exigência do Unsplash: registrar o "download" via download_location
  // (não bloqueia o resto se falhar, é só telemetria deles)
  fetch(`${foto.links.download_location}&client_id=${UNSPLASH_ACCESS_KEY}`).catch(() => {});

  return {
    buffer,
    credito: {
      fonte: 'unsplash',
      fotografo: foto.user.name,
      fotografoUrl: `${foto.user.links.html}?utm_source=prompt_midia&utm_medium=referral`,
      fotoUrl: `${foto.links.html}?utm_source=prompt_midia&utm_medium=referral`,
    },
  };
}

async function gerarCapa(artigo) {
  try {
    console.log(`[tentando pollinations] ${artigo.slug}...`);
    return await gerarViaPollinations(artigo);
  } catch (err) {
    console.warn(`[pollinations falhou] ${artigo.slug}: ${err.message} — tentando Unsplash...`);
    return await buscarViaUnsplash(artigo);
  }
}

async function main() {
  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  const artigos = lerArtigos();

  if (artigos.length === 0) {
    console.log('Nenhum artigo encontrado em src/content/noticias/.');
    return;
  }

  for (const artigo of artigos) {
    const destinoImagem = path.join(DIR_SAIDA, `${artigo.slug}.png`);
    const destinoCredito = path.join(DIR_SAIDA, `${artigo.slug}.json`);

    if (fs.existsSync(destinoImagem) && !FORCAR) {
      console.log(`[pular] ${artigo.slug} já tem capa (use --forcar pra refazer)`);
      continue;
    }

    try {
      const { buffer, credito } = await gerarCapa(artigo);
      fs.writeFileSync(destinoImagem, buffer);

      if (credito) {
        fs.writeFileSync(destinoCredito, JSON.stringify(credito, null, 2), 'utf-8');
      } else if (fs.existsSync(destinoCredito)) {
        fs.unlinkSync(destinoCredito); // era Unsplash antes, agora é IA — remove crédito velho
      }

      console.log(`[ok] public/capas-ia/${artigo.slug}.png ${credito ? '(Unsplash, com crédito)' : '(Pollinations/IA)'}`);
    } catch (err) {
      console.error(`[falhou nas duas fontes] ${artigo.slug}: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 1500));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

