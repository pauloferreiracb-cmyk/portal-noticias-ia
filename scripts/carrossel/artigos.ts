import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { DIR_NOTICIAS } from './config.ts';
import type { Artigo } from './tipos.ts';

/** AAAA-MM-DD. Datas "só dia" (meia-noite UTC) usam UTC; timestamps usam o fuso de Brasília. */
function dataParaISO(d: Date): string {
  const meiaNoiteUTC =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  if (meiaNoiteUTC) return d.toISOString().slice(0, 10);
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

export function lerArtigo(slug: string): Artigo {
  const arquivo = path.join(DIR_NOTICIAS, `${slug}.md`);
  if (!fs.existsSync(arquivo)) {
    throw new Error(`Notícia não encontrada: src/content/noticias/${slug}.md`);
  }
  const { data, content } = matter(fs.readFileSync(arquivo, 'utf-8'));
  const d = new Date(data.data);
  if (Number.isNaN(d.getTime())) throw new Error(`Campo "data" inválido em ${slug}.md`);
  return {
    slug,
    titulo: String(data.titulo ?? '').trim(),
    resumo: String(data.resumo ?? '').trim(),
    data: d,
    dataISO: dataParaISO(d),
    fonte_url: String(data.fonte_url ?? ''),
    fonte_nome: String(data.fonte_nome ?? ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    capa: data.capa ? String(data.capa) : undefined,
    corpo: content.trim(),
  };
}

/** Slug da notícia mais recente (pelo campo `data`; empate: ordem alfabética). */
export function slugMaisRecente(): string {
  const arquivos = fs.readdirSync(DIR_NOTICIAS).filter((f) => f.endsWith('.md'));
  if (arquivos.length === 0) throw new Error('Nenhuma notícia em src/content/noticias/.');
  const itens = arquivos.map((f) => {
    const slug = f.replace(/\.md$/, '');
    const { data } = matter(fs.readFileSync(path.join(DIR_NOTICIAS, f), 'utf-8'));
    const t = new Date(data.data).getTime();
    return { slug, t: Number.isNaN(t) ? 0 : t };
  });
  itens.sort((a, b) => b.t - a.t || a.slug.localeCompare(b.slug));
  return itens[0].slug;
}
