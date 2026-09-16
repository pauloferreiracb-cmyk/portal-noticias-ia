import fs from 'node:fs';
import path from 'node:path';
import type { CollectionEntry } from 'astro:content';

export interface CapaResolvida {
  src: string;
  credito: { fotografo: string; fotografoUrl: string } | null;
}

/**
 * Resolve a imagem de capa de uma notícia, nessa ordem:
 * 1) campo manual `capa` no frontmatter
 * 2) capa gerada por IA em /capas-ia/<slug>.png (+ crédito opcional em .json)
 * 3) capa do carrossel automático em /carrossel/<slug>/slide-1-capa.png
 * Retorna null quando não existe nenhuma capa.
 *
 * Antes essa lógica estava duplicada (com pequenas divergências) em
 * index.astro e em [slug].astro, e o NewsCard não tinha suporte a capa
 * nenhum — daí cards usando componentes diferentes acabavam mostrando
 * (ou não) a imagem de forma inconsistente. Agora é uma função só,
 * usada por todo mundo.
 */
export function resolveCapa(artigo: CollectionEntry<'noticias'>): CapaResolvida | null {
  if (artigo.data.capa) return { src: artigo.data.capa, credito: null };

  const capaIA = `/capas-ia/${artigo.slug}.png`;
  if (fs.existsSync(path.join(process.cwd(), 'public', capaIA))) {
    const jsonCredito = path.join(process.cwd(), 'public', 'capas-ia', `${artigo.slug}.json`);
    const credito = fs.existsSync(jsonCredito) ? JSON.parse(fs.readFileSync(jsonCredito, 'utf-8')) : null;
    return { src: capaIA, credito };
  }

  const capaCarrossel = `/carrossel/${artigo.slug}/slide-1-capa.png`;
  if (fs.existsSync(path.join(process.cwd(), 'public', capaCarrossel))) {
    return { src: capaCarrossel, credito: null };
  }

  return null;
}
