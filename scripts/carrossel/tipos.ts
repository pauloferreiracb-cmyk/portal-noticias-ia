export interface Artigo {
  slug: string;
  titulo: string;
  resumo: string;
  data: Date;
  /** AAAA-MM-DD já resolvido (usado no nome da pasta) */
  dataISO: string;
  fonte_url: string;
  fonte_nome: string;
  tags: string[];
  capa?: string;
  corpo: string;
}

export interface SlideConteudo {
  /** rótulo curto do slide (opcional) */
  titulo?: string;
  /** a ideia do slide, em frases curtas */
  texto: string;
  /** explicação simples de um termo técnico, com analogia quando couber */
  explica?: { termo?: string; texto: string };
}

export interface Roteiro {
  capa: { gancho: string; tag?: string };
  /** slides 2..N-2 (só fatos da notícia) */
  conteudo: SlideConteudo[];
  /** penúltimo slide */
  porqueImporta: { titulo?: string; texto: string };
  legenda: {
    gancho: string;
    /** 2 a 3 linhas */
    resumo: string;
    hashtags: string[];
  };
}

export type Slide =
  | { tipo: 'capa'; gancho: string; tag: string }
  | { tipo: 'conteudo'; n: number; total: number; titulo?: string; texto: string; explica?: SlideConteudo['explica'] }
  | { tipo: 'importa'; n: number; total: number; titulo?: string; texto: string }
  | { tipo: 'cta'; n: number; total: number };
