import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ALTURA, ARQ_MOLDURA, CONFIG, DIR_FONTES, LARGURA, MARCA } from './config.ts';
import type { Slide } from './tipos.ts';

/* ---------- helpers de layout (satori usa objetos { type, props }) ---------- */

type Estilo = Record<string, string | number>;
interface Nodo { type: string; props: { style?: Estilo; children?: unknown; [k: string]: unknown } }

const h = (type: string, style: Estilo, children?: unknown, extra: Record<string, unknown> = {}): Nodo => ({
  type,
  props: { style: { display: 'flex', ...style }, ...(children !== undefined ? { children } : {}), ...extra },
});
const txt = (style: Estilo, children: string) => h('div', style, children);

/* ---------- fontes e imagens ---------- */

function carregarFontes() {
  const ler = (f: string) => fs.readFileSync(path.join(DIR_FONTES, f));
  const necessarias = [
    'Inter-Regular.ttf', 'Inter-Bold.ttf',
    'space-grotesk-latin-500-normal.woff', 'space-grotesk-latin-700-normal.woff',
    'jetbrains-mono-latin-500-normal.woff',
  ];
  const faltando = necessarias.filter((f) => !fs.existsSync(path.join(DIR_FONTES, f)));
  if (faltando.length) throw new Error(`Faltam fontes em scripts/fonts/: ${faltando.join(', ')}`);
  return [
    { name: MARCA.fonteCorpo, data: ler('Inter-Regular.ttf'), weight: 400 as const, style: 'normal' as const },
    { name: MARCA.fonteCorpo, data: ler('Inter-Bold.ttf'), weight: 700 as const, style: 'normal' as const },
    { name: MARCA.fonteTitulo, data: ler('space-grotesk-latin-500-normal.woff'), weight: 500 as const, style: 'normal' as const },
    { name: MARCA.fonteTitulo, data: ler('space-grotesk-latin-700-normal.woff'), weight: 700 as const, style: 'normal' as const },
    { name: MARCA.fonteMono, data: ler('jetbrains-mono-latin-500-normal.woff'), weight: 500 as const, style: 'normal' as const },
  ];
}

const dataUri = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`;

/** Símbolo ">" do logo (o mesmo path do public/favicon.svg), com o degradê ciano → violeta. */
const SIMBOLO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 8 40 40"><defs><linearGradient id="g" x1="8" y1="8" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${MARCA.ciano}"/><stop offset="1" stop-color="${MARCA.violeta}"/></linearGradient></defs><path d="M18 14 L42 28 L18 42 L18 32 L30 28 L18 24 Z" fill="url(#g)"/></svg>`;
const SIMBOLO_URI = dataUri('image/svg+xml', Buffer.from(SIMBOLO_SVG));

/* ---------- peças comuns ---------- */

// Margens seguras: a moldura ocupa ~6% de cada lado; o conteúdo fica bem dentro dela.
const PAD_X = 150;
const PAD_TOPO = 165;
const PAD_BASE = 165;

const logo = (tamanho = 34) =>
  h('div', { alignItems: 'center', gap: 14 }, [
    h('img', {}, undefined, { src: SIMBOLO_URI, width: tamanho + 6, height: tamanho + 6 }),
    h('div', { alignItems: 'baseline', gap: 10, fontFamily: MARCA.fonteTitulo, fontSize: tamanho, color: MARCA.texto, letterSpacing: 1 }, [
      txt({ fontWeight: 700 }, 'PROMPT'),
      txt({ fontWeight: 500 }, 'MÍDIA'),
    ]),
  ]);

const pagina = (n: number, total: number) =>
  txt({ fontFamily: MARCA.fonteMono, fontSize: 28, color: MARCA.textoSuave }, `${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}`);

function base(moldura: string, filhos: unknown[]): Nodo {
  return h('div', {
    position: 'relative', width: LARGURA, height: ALTURA, flexDirection: 'column',
    background: MARCA.bg, fontFamily: MARCA.fonteCorpo,
  }, [
    h('img', { position: 'absolute', top: 0, left: 0 }, undefined, { src: moldura, width: LARGURA, height: ALTURA }),
    h('div', {
      position: 'absolute', top: 0, left: 0, width: LARGURA, height: ALTURA, flexDirection: 'column',
      justifyContent: 'space-between', padding: `${PAD_TOPO}px ${PAD_X}px ${PAD_BASE}px`,
    }, filhos),
  ]);
}

const rodape = (n: number, total: number) =>
  h('div', { justifyContent: 'space-between', alignItems: 'center' }, [
    txt({ fontFamily: MARCA.fonteMono, fontSize: 26, color: MARCA.ciano }, 'promptmidia.com.br'),
    pagina(n, total),
  ]);

const tamanhoPorTexto = (t: string, faixas: [number, number][]) => {
  const p = t.trim().split(/\s+/).length;
  for (const [ate, px] of faixas) if (p <= ate) return px;
  return faixas[faixas.length - 1][1];
};

/* ---------- slides ---------- */

function capa(s: Extract<Slide, { tipo: 'capa' }>, total: number, moldura: string): Nodo {
  const tamanho = tamanhoPorTexto(s.gancho, [[6, 108], [9, 96], [12, 86]]);
  const filhos: unknown[] = [
    h('div', { justifyContent: 'space-between', alignItems: 'center' }, [
      logo(40),
      h('div', {
        padding: '8px 22px', border: `2px solid ${MARCA.ciano}`, borderRadius: 999,
        fontFamily: MARCA.fonteMono, fontSize: 26, color: MARCA.ciano, letterSpacing: 2,
      }, s.tag.toUpperCase()),
    ]),
    h('div', { flexDirection: 'column', gap: 40 }, [
      txt({
        fontFamily: MARCA.fonteTitulo, fontWeight: 700, fontSize: tamanho,
        lineHeight: 1.08, color: MARCA.texto, letterSpacing: -2,
      }, s.gancho),
      h('div', { width: 140, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${MARCA.ciano}, ${MARCA.violeta})` }),
    ]),
    h('div', { justifyContent: 'space-between', alignItems: 'center' }, [
      txt({ fontFamily: MARCA.fonteMono, fontSize: 28, color: MARCA.ciano, letterSpacing: 2 }, 'ARRASTE PARA O LADO  >'),
      pagina(1, total),
    ]),
  ];
  return base(moldura, filhos);
}

function conteudo(s: Extract<Slide, { tipo: 'conteudo' }>, moldura: string): Nodo {
  const px = tamanhoPorTexto(s.texto, [[12, 66], [17, 58], [22, 52], [99, 48]]);
  const corpo: unknown[] = [];
  if (s.titulo)
    corpo.push(txt({ fontFamily: MARCA.fonteTitulo, fontWeight: 700, fontSize: 60, lineHeight: 1.1, color: MARCA.ciano, letterSpacing: -1 }, s.titulo));
  corpo.push(txt({ fontFamily: MARCA.fonteCorpo, fontWeight: 700, fontSize: px, lineHeight: 1.28, color: MARCA.texto }, s.texto));
  if (s.explica) {
    corpo.push(
      h('div', {
        flexDirection: 'column', gap: 12, padding: '26px 32px', borderRadius: 20,
        background: 'rgba(112,0,255,0.22)', border: `2px solid ${MARCA.violeta}`,
      }, [
        txt({ fontFamily: MARCA.fonteMono, fontSize: 24, color: MARCA.ciano, letterSpacing: 3 }, s.explica.termo ? s.explica.termo.toUpperCase() : 'EM PALAVRAS SIMPLES'),
        txt({ fontFamily: MARCA.fonteCorpo, fontWeight: 400, fontSize: 40, lineHeight: 1.3, color: MARCA.texto }, s.explica.texto),
      ])
    );
  }
  return base(moldura, [
    h('div', {}, [logo(38)]),
    h('div', { flexDirection: 'column', gap: 36 }, corpo),
    rodape(s.n, s.total),
  ]);
}

function importa(s: Extract<Slide, { tipo: 'importa' }>, moldura: string): Nodo {
  const px = tamanhoPorTexto(s.texto, [[12, 66], [17, 58], [22, 52], [99, 48]]);
  return base(moldura, [
    h('div', {}, [logo(38)]),
    h('div', { flexDirection: 'column', gap: 36 }, [
      h('div', { alignSelf: 'flex-start', padding: '8px 22px', borderRadius: 999, background: MARCA.violeta,
        fontFamily: MARCA.fonteMono, fontSize: 26, color: MARCA.texto, letterSpacing: 2 }, 'POR QUE IMPORTA'),
      ...(s.titulo ? [txt({ fontFamily: MARCA.fonteTitulo, fontWeight: 700, fontSize: 60, lineHeight: 1.1, color: MARCA.ciano, letterSpacing: -1 }, s.titulo)] : []),
      txt({ fontFamily: MARCA.fonteCorpo, fontWeight: 700, fontSize: px, lineHeight: 1.28, color: MARCA.texto }, s.texto),
    ]),
    rodape(s.n, s.total),
  ]);
}

function cta(s: Extract<Slide, { tipo: 'cta' }>, moldura: string): Nodo {
  const { siteDominio, dmPalavra } = CONFIG;
  return base(moldura, [
    h('div', {}, [logo(38)]),
    h('div', { flexDirection: 'column', gap: 34 }, [
      txt({ fontFamily: MARCA.fonteTitulo, fontWeight: 700, fontSize: 76, lineHeight: 1.08, color: MARCA.texto, letterSpacing: -1.5 }, 'Leia a matéria completa em'),
      h('div', {
        alignSelf: 'flex-start', padding: '20px 36px', borderRadius: 24,
        background: `linear-gradient(90deg, ${MARCA.ciano}, ${MARCA.violeta})`,
        fontFamily: MARCA.fonteTitulo, fontWeight: 700, fontSize: 56, color: MARCA.bg,
      }, siteDominio),
      txt({ fontFamily: MARCA.fonteMono, fontSize: 52, color: MARCA.ciano, letterSpacing: 3 }, 'LINK NA BIO'),
      ...(dmPalavra
        ? [h('div', { flexDirection: 'column', gap: 8, padding: '24px 30px', borderRadius: 20, border: `2px solid ${MARCA.violeta}`, background: 'rgba(112,0,255,0.22)' }, [
            txt({ fontFamily: MARCA.fonteCorpo, fontSize: 36, color: MARCA.texto }, 'Ou comente a palavra abaixo e receba o link no direct:'),
            txt({ fontFamily: MARCA.fonteTitulo, fontWeight: 700, fontSize: 54, color: MARCA.ciano }, dmPalavra.toUpperCase()),
          ])]
        : []),
    ]),
    rodape(s.n, s.total),
  ]);
}

/* ---------- render ---------- */

export async function renderizarSlides(
  slides: Slide[],
  fundos: { capa?: Buffer; interno?: Buffer } = {}
): Promise<Buffer[]> {
  const fontes = carregarFontes();
  const padrao = dataUri('image/jpeg', fs.readFileSync(ARQ_MOLDURA));
  const bgCapa = fundos.capa ? dataUri('image/jpeg', fundos.capa) : padrao;
  const bgInterno = fundos.interno ? dataUri('image/jpeg', fundos.interno) : padrao;
  const total = slides.length;

  const pngs: Buffer[] = [];
  for (const s of slides) {
    const el =
      s.tipo === 'capa' ? capa(s, total, bgCapa)
      : s.tipo === 'conteudo' ? conteudo(s, bgInterno)
      : s.tipo === 'importa' ? importa(s, bgInterno)
      : cta(s, bgInterno);
    // satori aceita o objeto { type, props } (equivalente ao JSX compilado)
    const svg = await satori(el as never, { width: LARGURA, height: ALTURA, fonts: fontes });
    pngs.push(new Resvg(svg, { fitTo: { mode: 'width', value: LARGURA } }).render().asPng());
  }
  return pngs;
}
