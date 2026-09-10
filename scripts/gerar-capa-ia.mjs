#!/usr/bin/env node
/**
 * Gera uma imagem de capa por artigo, no estilo visual PROMPT MÃDIA
 * (dark obsidiana, ciano elÃ©trico + violeta neural, editorial tech
 * minimalista).
 *
 * EstratÃ©gia em 2 camadas:
 *   1. Cloudflare Workers AI (FLUX.1 [schnell]) â€” imagem gerada por IA,
 *      grÃ¡tis (10 mil "neurons"/dia), jÃ¡ no estilo da marca.
 *   2. Se falhar, cai pro Unsplash (foto real, grÃ¡tis, precisa de
 *      UNSPLASH_ACCESS_KEY) â€” e grava o crÃ©dito do fotÃ³grafo em
 *      public/capas-ia/<slug>.json pra exibir no site.
 *
 * Fica em public/capas-ia/<slug>.png â€” separado do carrossel do Satori
 * (public/carrossel/), que continua existindo pra postagem no Instagram/TikTok.
 *
 * Uso:
 *   node scripts/gerar-capa-ia.mjs            -> gera sÃ³ o que falta
 *   node scripts/gerar-capa-ia.mjs --forcar   -> regenera tudo
 *
 * VariÃ¡veis de ambiente:
 *   CLOUDFLARE_ACCOUNT_ID  obrigatÃ³ria pra IA funcionar.
 *   CLOUDFLARE_API_TOKEN   obrigatÃ³ria pra IA funcionar.
 *                          GrÃ¡tis em https://dash.cloudflare.com -> Workers AI
 *   UNSPLASH_ACCESS_KEY    opcional, mas necessÃ¡ria pro fallback funcionar.
 *                          GrÃ¡tis em https://unsplash.com/developers
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

// --- Camada 1: Cloudflare Workers AI (FLUX.1 schnell), no estilo da marca ---

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_MODELO = process.env.CLOUDFLARE_IMAGE_MODEL ?? '@cf/black-forest-labs/flux-1-schnell';

function montarPromptIA(artigo) {
  return (
    `Realistic editorial photograph/illustration that literally depicts the scene, ` +
    `people, objects or action described in this Brazilian news article â€” the image ` +
    `must be clearly and concretely about this specific subject, not an abstract concept: ` +
    `"${artigo.titulo}". Contexto: ${artigo.resumo ?? ''}. ` +
    `Visual treatment: moody cinematic lighting, dark background, electric cyan ` +
    `(#00F0FF) and neural violet (#7000FF) accent lighting/rim light, high contrast, ` +
    `wide 16:9 landscape crop. ` +
    `No text, no words, no letters, no logos, no watermarks anywhere in the image.`
  );
}

async function gerarViaCloudflare(artigo) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN nÃ£o configuradas');
  }

  const prompt = montarPromptIA(artigo);
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODELO}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, width: 1280, height: 720 }),
  });

  if (!resp.ok) {
    const corpo = await resp.text();
    throw new Error(`Cloudflare respondeu ${resp.status}: ${corpo.slice(0, 300)}`);
  }

  const tipo = resp.headers.get('content-type') ?? '';
  let buffer;

  if (tipo.startsWith('image/')) {
    // alguns modelos (ex: Stable Diffusion) devolvem os bytes da imagem direto
    buffer = Buffer.from(await resp.arrayBuffer());
  } else {
    // FLUX devolve JSON com a imagem em base64
    const json = await resp.json();
    const base64 = json?.result?.image;
    if (!base64) throw new Error('Cloudflare nÃ£o retornou imagem. Resposta: ' + JSON.stringify(json).slice(0, 300));
    buffer = Buffer.from(base64, 'base64');
  }

  if (buffer.length < 2000) throw new Error('Cloudflare retornou um arquivo suspeito de pequeno');

  return { buffer, credito: null }; // IA nÃ£o exige crÃ©dito
}

// --- Camada 2 (fallback): Unsplash, foto real ---

async function buscarViaUnsplash(artigo) {
  if (!UNSPLASH_ACCESS_KEY) {
    throw new Error('UNSPLASH_ACCESS_KEY nÃ£o configurada â€” sem fallback disponÃ­vel');
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
  if (!foto) throw new Error(`Unsplash nÃ£o retornou nenhuma foto pra "${query}"`);

  // Baixa a imagem em si
  const respImagem = await fetch(foto.urls.regular);
  if (!respImagem.ok) throw new Error(`Unsplash (download da imagem) respondeu ${respImagem.status}`);
  const buffer = Buffer.from(await respImagem.arrayBuffer());

  // ExigÃªncia do Unsplash: registrar o "download" via download_location
  // (nÃ£o bloqueia o resto se falhar, Ã© sÃ³ telemetria deles)
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
    console.log(`[tentando cloudflare] ${artigo.slug}...`);
    return await gerarViaCloudflare(artigo);
  } catch (err) {
    console.warn(`[cloudflare falhou] ${artigo.slug}: ${err.message} â€” tentando Unsplash...`);
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
      console.log(`[pular] ${artigo.slug} jÃ¡ tem capa (use --forcar pra refazer)`);
      continue;
    }

    try {
      const { buffer, credito } = await gerarCapa(artigo);
      fs.writeFileSync(destinoImagem, buffer);

      if (credito) {
        fs.writeFileSync(destinoCredito, JSON.stringify(credito, null, 2), 'utf-8');
      } else if (fs.existsSync(destinoCredito)) {
        fs.unlinkSync(destinoCredito); // era Unsplash antes, agora Ã© IA â€” remove crÃ©dito velho
      }

      console.log(`[ok] public/capas-ia/${artigo.slug}.png ${credito ? '(Unsplash, com crÃ©dito)' : '(Cloudflare/IA)'}`);
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


