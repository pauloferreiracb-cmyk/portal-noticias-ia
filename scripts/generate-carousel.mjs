#!/usr/bin/env node
/**
 * Gera imagens de carrossel (Instagram/TikTok, 1080x1350) pra cada
 * artigo em src/content/noticias/*.md que ainda não tenha imagens
 * geradas em public/carrossel/<slug>/.
 *
 * 3 slides por artigo:
 *   1. Capa (título + tag)
 *   2. Resumo (o "gatilho de curiosidade")
 *   3. CTA (print estilizado do site + "link nos comentários / bio")
 *
 * NOVO: depois de gerar as imagens, registra o artigo em
 * content/fila-social.json (status "pendente") com as URLs públicas
 * das imagens — é esse arquivo que o Cowork lê pra postar no
 * Instagram/TikTok via Buffer.
 *
 * Uso:
 *   node scripts/generate-carousel.mjs            -> gera só o que falta
 *   node scripts/generate-carousel.mjs --forcar    -> regenera tudo
 *
 * Variáveis de ambiente:
 *   SITE_DOMINIO   domínio real do site, ex: portal-ia.com.br
 *                  (sem https://, sem barra no final)
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

// MUDANÇA: antes era 'output/carrossel' (não público). Agora fica em
// 'public/carrossel', que a Vercel serve como arquivo estático em
// https://SEU-DOMINIO/carrossel/<slug>/<arquivo>.png
const DIR_SAIDA = path.join(RAIZ, 'public/carrossel');

const CAMINHO_FILA_SOCIAL = path.join(RAIZ, 'content/fila-social.json');

const FORCAR = process.argv.includes('--forcar');

const LARGURA = 1080;
const ALTURA = 1350;

// ATENÇÃO: troque isso pelo domínio real antes de ativar a automação
// de postagem — enquanto for placeholder, as URLs no fila-social.json
// vão apontar pra um domínio que não existe e o Buffer não vai
// conseguir baixar as imagens.
const SITE_DOMINIO = process.env.SITE_DOMINIO ?? 'SEU-DOMINIO.com.br';
const SITE_URL_PUBLICO = `https://${SITE_DOMINIO}`;

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

// --- fila-social.json: o que o Cowork vai ler pra postar depois ---

function carregarFilaSocial() {
  if (!fs.existsSync(CAMINHO_FILA_SOCIAL)) return [];
  try {
    return JSON.parse(fs.readFileSync(CAMINHO_FILA_SOCIAL, 'utf-8'));
  } catch {
    console.warn('[aviso] fila-social.json existente não é um JSON válido — começando do zero.');
    return [];
  }
}

function salvarFilaSocial(fila) {
  fs.mkdirSync(path.dirname(CAMINHO_FILA_SOCIAL), { recursive: true });
  fs.writeFileSync(CAMINHO_FILA_SOCIAL, JSON.stringify(fila, null, 2), 'utf-8');
}

function adicionarNaFila(fila, artigo, nomesDosArquivos) {
  if (fila.some((item) => item.slug === artigo.slug)) return fila; // já está na fila, não duplica

  const imagens = nomesDosArquivos.map(
    (nome) => `${SITE_URL_PUBLICO}/carrossel/${artigo.slug}/${nome}`
  );

  fila.push({
    slug: artigo.slug,
    titulo: artigo.titulo,
    resumo: artigo.resumo,
    imagens,
    status: 'pendente',
    criado_em: new Date().toISOString(),
  });

  return fila;
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
            children: SITE_DOMINIO,
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
  if (SITE_DOMINIO === 'SEU-DOMINIO.com.br') {
    console.warn(
      '[aviso] SITE_DOMINIO ainda não foi configurado — as URLs no fila-social.json ' +
        'vão apontar pra um domínio que não existe. Defina a variável de ambiente ' +
        'SITE_DOMINIO (ou edite a constante no topo do arquivo) antes de ativar a ' +
        'postagem automática.'
    );
  }

  const fontes = carregarFontes();
  const artigos = lerArtigos();

  if (artigos.length === 0) {
    console.log('Nenhum artigo encontrado em src/content/noticias/.');
    return;
  }

  let fila = carregarFilaSocial();

  for (const artigo of artigos) {
    const dirArtigo = path.join(DIR_SAIDA, artigo.slug);
    const jaExiste = fs.existsSync(dirArtigo);

    if (jaExiste && !FORCAR) {
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

    fila = adicionarNaFila(fila, artigo, slides.map((s) => s.nome));

    console.log(`[ok] carrossel gerado em public/carrossel/${artigo.slug}/`);
  }

  salvarFilaSocial(fila);
  console.log(`Fila social atualizada em content/fila-social.json (${fila.length} item(ns) no total).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
