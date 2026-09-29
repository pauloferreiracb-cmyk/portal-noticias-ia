import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export const RAIZ = path.resolve(AQUI, '../..');
export const DIR_NOTICIAS = path.join(RAIZ, 'src/content/noticias');
export const DIR_CAPAS = path.join(RAIZ, 'public/capas-ia');
export const DIR_SAIDA = path.join(RAIZ, 'carrosseis');
export const DIR_FONTES = path.join(RAIZ, 'scripts/fonts');
export const ARQ_MOLDURA = path.join(AQUI, 'assets/moldura.jpg');

export const LARGURA = 1080;
export const ALTURA = 1350; // 4:5

export const CONFIG = {
  /** Domínio exibido no CTA. Vem da mesma variável que o pipeline já usa. */
  siteDominio: (process.env.SITE_DOMINIO ?? 'promptmidia.com.br').trim(),
  /**
   * Palavra-chave de DM (automação ManyChat). Vazio = o bloco de DM
   * não aparece no slide final nem na legenda.
   * Pode vir do .env / Actions (CARROSSEL_DM_PALAVRA) ou da flag --dm.
   */
  dmPalavra: (process.env.CARROSSEL_DM_PALAVRA ?? '').trim(),
  modeloClaude: process.env.CLAUDE_MODEL ?? 'claude-sonnet-5',
  /** Limites do briefing */
  minSlides: 6,
  maxSlides: 8,
  maxPalavrasPorSlide: 25,
  maxPalavrasCapa: 12,
};

/** Paleta e fontes oficiais (src/styles/global.css + identidade da marca). */
export const MARCA = {
  bg: '#0A0E17',
  bgElevado: '#141A28',
  borda: '#232B3D',
  texto: '#F4F6F9',
  textoSuave: '#8B95A5',
  ciano: '#00F0FF',
  violeta: '#7000FF',
  fonteTitulo: 'Space Grotesk',
  fonteCorpo: 'Inter',
  fonteMono: 'JetBrains Mono',
};
