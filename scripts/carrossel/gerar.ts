#!/usr/bin/env tsx
/**
 * Gerador de carrosséis do Portal PromptMídia (Instagram, 1080x1350).
 *
 * Uso:
 *   npm run carrossel                     -> notícia mais recente do site
 *   npm run carrossel -- <slug>           -> uma notícia específica
 *   npm run carrossel -- <slug> --foto    -> usa a capa da notícia na capa do carrossel
 *   npm run carrossel -- <slug> --dm PROMPT   -> palavra-chave de DM (ManyChat)
 *   npm run carrossel -- <slug> --refazer-roteiro -> chama o Claude de novo
 *
 * Saída: carrosseis/AAAA-MM-DD-<slug>/
 *   slide-01.png ... slide-0N.png, legenda.txt, roteiro.json, meta.json
 *
 * O texto vem de roteiro.json. Se o arquivo já existir na pasta, ele é reaproveitado
 * (dá pra editar o texto à mão e rodar de novo só pra redesenhar os slides).
 * Se não existir, o roteiro é escrito pelo Claude (ANTHROPIC_API_KEY).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { lerArtigo, slugMaisRecente } from './artigos.ts';
import { CONFIG, DIR_CAPAS, DIR_SAIDA, RAIZ } from './config.ts';
import { montarLegenda } from './legenda.ts';
import { gerarRoteiro, validarRoteiro } from './roteiro.ts';
import { renderizarSlides } from './slides.ts';
import type { Artigo, Roteiro, Slide } from './tipos.ts';

/* ---------- argumentos ---------- */
const args = process.argv.slice(2);
const flag = (nome: string) => args.includes(nome);
const valorDe = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const posicionais = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--dm'));

/* ---------- foto da capa (opcional) ---------- */
/** Segue o padrão do projeto: public/capas-ia/<slug>.png, senão a URL do campo `capa`. */
async function carregarFoto(artigo: Artigo): Promise<{ buf?: Buffer; credito?: string }> {
  let bruto: Buffer | undefined;
  const local = path.join(DIR_CAPAS, `${artigo.slug}.png`);
  if (fs.existsSync(local)) bruto = fs.readFileSync(local);
  else if (artigo.capa?.startsWith('http')) {
    try {
      const r = await fetch(artigo.capa, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) bruto = Buffer.from(await r.arrayBuffer());
    } catch { /* sem foto: segue só com tipografia */ }
  }
  if (!bruto) {
    console.warn('[aviso] --foto pedido, mas a notícia não tem capa disponível. Seguindo só com tipografia.');
    return {};
  }
  const buf = await sharp(bruto).resize(780, 400, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();

  // Crédito do fotógrafo (sidecar .json que o pipeline de capas já grava)
  let credito: string | undefined;
  const sidecar = path.join(DIR_CAPAS, `${artigo.slug}.json`);
  if (fs.existsSync(sidecar)) {
    try {
      const j = JSON.parse(fs.readFileSync(sidecar, 'utf-8'));
      if (j.fotografo) credito = `Foto: ${j.fotografo} / Unsplash`;
    } catch { /* ignora */ }
  }
  return { buf, credito };
}

/* ---------- roteiro -> lista de slides ---------- */
function montarSlides(r: Roteiro): Slide[] {
  const total = 1 + r.conteudo.length + 1 + 1;
  const slides: Slide[] = [{ tipo: 'capa', gancho: r.capa.gancho, tag: r.capa.tag ?? 'IA' }];
  r.conteudo.forEach((c, i) =>
    slides.push({ tipo: 'conteudo', n: i + 2, total, titulo: c.titulo, texto: c.texto, explica: c.explica })
  );
  slides.push({ tipo: 'importa', n: total - 1, total, titulo: r.porqueImporta.titulo, texto: r.porqueImporta.texto });
  slides.push({ tipo: 'cta', n: total, total });
  return slides;
}

async function main() {
  if (flag('--dm')) CONFIG.dmPalavra = (valorDe('--dm') ?? '').trim();

  const slug = posicionais[0] ?? slugMaisRecente();
  const artigo = lerArtigo(slug);
  const pasta = path.join(DIR_SAIDA, `${artigo.dataISO}-${slug}`);
  fs.mkdirSync(pasta, { recursive: true });
  console.log(`Notícia: ${artigo.titulo}`);

  // 1) roteiro
  const arqRoteiro = path.join(pasta, 'roteiro.json');
  let roteiro: Roteiro;
  if (fs.existsSync(arqRoteiro) && !flag('--refazer-roteiro')) {
    roteiro = JSON.parse(fs.readFileSync(arqRoteiro, 'utf-8'));
    const erros = validarRoteiro(roteiro, artigo);
    if (erros.length) throw new Error('roteiro.json fora das regras:\n  - ' + erros.join('\n  - '));
    console.log('Roteiro: reaproveitado de roteiro.json');
  } else {
    roteiro = await gerarRoteiro(artigo);
    fs.writeFileSync(arqRoteiro, JSON.stringify(roteiro, null, 2), 'utf-8');
    console.log('Roteiro: gerado pelo Claude');
  }

  // 2) foto (opcional)
  const foto = flag('--foto') ? await carregarFoto(artigo) : {};

  // 3) slides
  const slides = montarSlides(roteiro);
  const pngs = await renderizarSlides(slides, foto.buf);
  for (const f of fs.readdirSync(pasta)) if (/^slide-\d+\.png$/.test(f)) fs.rmSync(path.join(pasta, f));
  pngs.forEach((png, i) => fs.writeFileSync(path.join(pasta, `slide-${String(i + 1).padStart(2, "0")}.png`), new Uint8Array(png)));

  // 4) legenda + metadados
  fs.writeFileSync(path.join(pasta, 'legenda.txt'), montarLegenda(roteiro, artigo, foto.credito) + '\n', 'utf-8');
  fs.writeFileSync(
    path.join(pasta, 'meta.json'),
    JSON.stringify({
      slug, titulo: artigo.titulo, url: `https://${CONFIG.siteDominio}/noticias/${slug}`,
      slides: pngs.length, dmPalavra: CONFIG.dmPalavra || null, gerado_em: new Date().toISOString(),
    }, null, 2),
    'utf-8'
  );

  console.log(`[ok] ${pngs.length} slides + legenda em ${path.relative(RAIZ, pasta)}`);
}

main().catch((e) => {
  console.error('[erro]', e instanceof Error ? e.message : e);
  process.exit(1);
});
