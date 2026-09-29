import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ALTURA, ARQ_MOLDURA, LARGURA, MARCA } from './config.ts';
import type { Artigo, Roteiro } from './tipos.ts';

/**
 * Imagens de fundo: Pexels e Pixabay (APIs gratuitas, com chave).
 *   PEXELS_API_KEY   https://www.pexels.com/api/
 *   PIXABAY_API_KEY  https://pixabay.com/api/docs/
 * Sem nenhuma chave (ou sem resultado) o carrossel sai com a moldura padrão.
 */

export interface Fundo {
  /** imagem original escolhida (JPEG/PNG) */
  bruto: Buffer;
  /** linha de crédito para a legenda */
  credito: string;
}

interface Candidata { url: string; credito: string }

const TEMPO_LIMITE = 12_000;

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(TEMPO_LIMITE) });
  if (!r.ok) throw new Error(`${new URL(url).host} respondeu ${r.status}`);
  return (await r.json()) as T;
}

async function buscarPexels(consulta: string): Promise<Candidata[]> {
  const chave = process.env.PEXELS_API_KEY?.trim();
  if (!chave) return [];
  const u = new URL('https://api.pexels.com/v1/search');
  u.search = new URLSearchParams({ query: consulta, orientation: 'portrait', size: 'large', per_page: '15' }).toString();
  const d = await json<{ photos?: { src: { large2x?: string; original: string }; photographer: string }[] }>(
    u.toString(), { Authorization: chave }
  );
  return (d.photos ?? []).map((p) => ({
    url: p.src.large2x ?? p.src.original,
    credito: `Imagem: ${p.photographer} / Pexels`,
  }));
}

async function buscarPixabay(consulta: string): Promise<Candidata[]> {
  const chave = process.env.PIXABAY_API_KEY?.trim();
  if (!chave) return [];
  const u = new URL('https://pixabay.com/api/');
  u.search = new URLSearchParams({
    key: chave, q: consulta, image_type: 'photo', orientation: 'vertical',
    min_width: '1000', safesearch: 'true', per_page: '15',
  }).toString();
  const d = await json<{ hits?: { largeImageURL: string; user: string }[] }>(u.toString());
  return (d.hits ?? []).map((h) => ({
    url: h.largeImageURL,
    credito: `Imagem: ${h.user} / Pixabay`,
  }));
}

async function baixar(url: string): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TEMPO_LIMITE * 2) });
  if (!r.ok) throw new Error(`download falhou (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Consultas em ordem de preferência: as do roteiro, depois as tags da notícia. */
function consultas(roteiro: Roteiro, artigo: Artigo): string[] {
  const lista = [roteiro.imagem?.consulta, roteiro.imagem?.alternativa, artigo.tags.slice(0, 2).join(' ')]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
  return [...new Set(lista)];
}

export async function buscarFundo(
  roteiro: Roteiro,
  artigo: Artigo,
  preferida: 'pexels' | 'pixabay' = 'pexels'
): Promise<Fundo | undefined> {
  if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) {
    console.warn('[aviso] sem PEXELS_API_KEY nem PIXABAY_API_KEY: usando a moldura padrão como fundo.');
    return undefined;
  }
  const ordem = preferida === 'pexels' ? [buscarPexels, buscarPixabay] : [buscarPixabay, buscarPexels];
  for (const consulta of consultas(roteiro, artigo)) {
    for (const buscar of ordem) {
      try {
        const achadas = await buscar(consulta);
        for (const c of achadas.slice(0, 3)) {
          try {
            const bruto = await baixar(c.url);
            const meta = await sharp(bruto).metadata();
            if ((meta.width ?? 0) >= 800) {
              console.log(`Fundo: "${consulta}" -> ${c.credito}`);
              return { bruto, credito: c.credito };
            }
          } catch { /* tenta a próxima candidata */ }
        }
      } catch (e) {
        console.warn(`[aviso] busca de imagem falhou (${consulta}): ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  console.warn('[aviso] nenhuma imagem de fundo encontrada: usando a moldura padrão.');
  return undefined;
}

/** Imagem indicada por você (--imagem arquivo.jpg ou URL). */
export async function fundoManual(origem: string): Promise<Fundo> {
  const bruto = /^https?:\/\//.test(origem) ? await baixar(origem) : fs.readFileSync(path.resolve(origem));
  return { bruto, credito: '' };
}

/* ---------- composição: foto escurecida + moldura de circuito por cima ---------- */

const scrim = (topo: number, base: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGURA}" height="${ALTURA}">
       <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="${MARCA.bg}" stop-opacity="${topo}"/>
         <stop offset="1" stop-color="${MARCA.bg}" stop-opacity="${base}"/>
       </linearGradient>
       <linearGradient id="v" x1="1" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="${MARCA.violeta}" stop-opacity="0.28"/>
         <stop offset="0.6" stop-color="${MARCA.violeta}" stop-opacity="0"/>
       </linearGradient></defs>
       <rect width="100%" height="100%" fill="url(#g)"/>
       <rect width="100%" height="100%" fill="url(#v)"/>
     </svg>`
  );

/**
 * Devolve os dois fundos JPEG do carrossel.
 * - capa: foto mais visível, com sombra forte embaixo (onde fica o título)
 * - interno: foto desfocada e bem escura, para o texto ler sem esforço
 */
export async function comporFundos(fundo?: Fundo): Promise<{ capa?: Buffer; interno?: Buffer }> {
  if (!fundo) return {};
  const moldura = fs.readFileSync(ARQ_MOLDURA);
  const montar = async (opcoes: { brilho: number; desfoque: number; topo: number; base: number }) => {
    let img = sharp(fundo.bruto).rotate().resize(LARGURA, ALTURA, { fit: 'cover', position: 'attention' });
    if (opcoes.desfoque > 0) img = img.blur(opcoes.desfoque);
    const escura = await img.modulate({ brightness: opcoes.brilho, saturation: 1.05 }).jpeg().toBuffer();
    return sharp(escura)
      .composite([
        { input: scrim(opcoes.topo, opcoes.base) },
        { input: moldura, blend: 'screen' }, // linhas ciano da moldura ficam, o fundo preto some
      ])
      .jpeg({ quality: 88 })
      .toBuffer();
  };
  return {
    capa: await montar({ brilho: 0.75, desfoque: 0, topo: 0.35, base: 0.92 }),
    interno: await montar({ brilho: 0.5, desfoque: 10, topo: 0.72, base: 0.9 }),
  };
}
