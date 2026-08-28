#!/usr/bin/env node
/**
 * Gera imagens de carrossel (Instagram/TikTok, 1080x1350) pra cada
 * artigo em src/content/noticias/*.md que ainda não tenha imagens
 * geradas em output/carrossel/<slug>/.
 *
 * 3 slides por artigo:
 *   1. Capa (título + tag)
 *   2. Resumo (o "gatilho de curiosidade")
 *   3. CTA (print estilizado do site + "link nos comentários / bio")
 *
 * Uso:
 *   node scripts/generate-carousel.mjs            -> gera só o que falta
 *   node scripts/generate-carousel.mjs --forcar    -> regenera tudo
 *
 * Dependências (já no package.json): gray-matter, satori, @resvg/resvg-js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const DIR_NOTICIAS = path.join(RAIZ, 'src/content/noticias');
const DIR_SAIDA = path.join(RAIZ, 'output/carrossel');
const FORCAR = process.argv.includes('--forcar');

const LARGURA = 1080;
const ALTURA = 1350;
const SITE_URL = 'seudominio.com.br'; // ajuste pro seu domínio real

// Fonte: baixe uma Inter .ttf (Regular e Bold) e coloque em scripts/fonts/
// (satori precisa dos bytes da fonte, não referencia fontes do sistema)
const FONTE_REGULAR = path.join(__dirname, 'fonts/Inter-Regular.ttf');
const FONTE_BOLD = path.join(__dirname, 'fonts/Inter-Bold.ttf');

function carregarFontes() {
  if (!fs.existsSync(FONTE_REGULAR) || !fs.existsSync(FONTE_BOLD)) {
    console.error(
      '[erro] Faltam as fontes em scripts/fonts/Inter-Regular.ttf e Inter-Bold.ttf.\n' +
        'Baixe em https://fonts.google.com/specimen/Inter e coloque os 2 arquivos ali.'
    );
    process.exit(1);
  }
  return [
    { name: 'Inter', data: fs.readFileSync(FONTE_REGULAR), weight: 400, style: 'normal' },
    { name: 'Inter', data: fs.readFileSync(FONTE_BOLD), weight: 700, style: 'normal' },
  ];
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

// --- Templates de cada slide, em sintaxe JSX-like exigida pelo satori ---
// (objeto { type, props }, equivalente ao que o JSX compila)

function slideCapa({ titulo, tags }) {
  return {
    type: 'div',
    props: {
      style: {
        width: LARGURA,
        height: ALTURA,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0b0d10',
        padding: 72,
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { color: '#5ee6b0', fontSize: 28, fontWeight: 700 },
            children: (tags?.[0] ?? 'IA').toUpperCase(),
          },
        },
        {
          type: 'div',
          props: {
            style: { color: '#e8eaed', fontSize: 64, fontWeight: 700, lineHeight: 1.2 },
            children: titulo,
          },
        },
        {
          type: 'div',
          props: {
            style: { color: '#9aa2ad', fontSize: 30 },
            children: '📡 Portal IA',
          },
        },
      ],
    },
  };
}

function slideResumo({ resumo }) {
  return {
    type: 'div',
    props: {
      style: {
        width: LARGURA,
        height: ALTURA,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        background: '#14171c',
        padding: 80,
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { color: '#e8eaed', fontSize: 46, fontWeight: 700, lineHeight: 1.35 },
            children: resumo,
          },
        },
      ],
    },
  };
}

function slideCTA() {
  return {
    type: 'div',
    props: {
      style: {
        width: LARGURA,
        height: ALTURA,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        background: '#0b0d10',
        padding: 80,
        fontFamily: 'Inter',
        textAlign: 'center',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { color: '#5ee6b0', fontSize: 40, fontWeight: 700 },
            children: 'Matéria completa no link 👇',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              color: '#0b0d10',
              background: '#5ee6b0',
              padding: '16px 32px',
              borderRadius: 999,
              fontSize: 32,
              fontWeight: 700,
            },
            children: SITE_URL,
          },
        },
      ],
    },
  };
}

async function renderizarPNG(elemento, fontes) {
  const svg = await satori(elemento, { width: LARGURA, height: ALTURA, fonts: fontes });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: LARGURA } });
  return resvg.render().asPng();
}

async function main() {
  const fontes = carregarFontes();
  const artigos = lerArtigos();

  if (artigos.length === 0) {
    console.log('Nenhum artigo encontrado em src/content/noticias/.');
    return;
  }

  for (const artigo of artigos) {
    const dirArtigo = path.join(DIR_SAIDA, artigo.slug);

    if (fs.existsSync(dirArtigo) && !FORCAR) {
      console.log(`[pular] ${artigo.slug} já tem carrossel gerado (use --forcar pra refazer)`);
      continue;
    }
    fs.mkdirSync(dirArtigo, { recursive: true });

    const slides = [
      { nome: 'slide-1-capa.png', el: slideCapa(artigo) },
      { nome: 'slide-2-resumo.png', el: slideResumo(artigo) },
      { nome: 'slide-3-cta.png', el: slideCTA() },
    ];

    for (const slide of slides) {
      const png = await renderizarPNG(slide.el, fontes);
      fs.writeFileSync(path.join(dirArtigo, slide.nome), png);
    }

    console.log(`[ok] carrossel gerado em output/carrossel/${artigo.slug}/`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
