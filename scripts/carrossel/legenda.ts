import { CONFIG } from './config.ts';
import type { Artigo, Roteiro } from './tipos.ts';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const paraHashtag = (s: string) =>
  '#' + semAcento(s).replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1)).join('');

/** Junta as hashtags do roteiro com as tags da notícia e as fixas da marca: 5 a 8, sem repetir. */
export function montarHashtags(roteiro: Roteiro, artigo: Artigo): string[] {
  const fixas = ['#InteligenciaArtificial', '#IA', '#Tecnologia', '#PromptMidia'];
  const candidatas = [
    ...(roteiro.legenda.hashtags ?? []).map((h) => (h.startsWith('#') ? h : '#' + h)).map(semAcento),
    ...artigo.tags.map(paraHashtag),
    ...fixas,
  ].filter((h) => h.length > 2 && h.length <= 30);

  const vistas = new Set<string>();
  const unicas: string[] = [];
  for (const h of candidatas) {
    const k = h.toLowerCase();
    if (!vistas.has(k)) { vistas.add(k); unicas.push(h); }
  }
  return unicas.slice(0, 8);
}

export function montarLegenda(roteiro: Roteiro, artigo: Artigo, credito?: string): string {
  const { siteDominio, dmPalavra } = CONFIG;
  const cta = [
    `Leia a matéria completa em ${siteDominio} (link na bio).`,
    dmPalavra ? `Comente "${dmPalavra.toUpperCase()}" e receba o link no direct.` : '',
  ].filter(Boolean).join('\n');

  return [
    roteiro.legenda.gancho.trim(),
    roteiro.legenda.resumo.trim(),
    cta,
    credito ?? '',
    montarHashtags(roteiro, artigo).join(' '),
  ].filter(Boolean).join('\n\n');
}
