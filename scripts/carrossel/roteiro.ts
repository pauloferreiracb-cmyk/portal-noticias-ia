import { CONFIG } from './config.ts';
import type { Artigo, Roteiro } from './tipos.ts';

const contarPalavras = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Todo texto que o leitor precisa ler em um slide de conteúdo. */
export function textoDoSlide(s: { titulo?: string; texto: string; explica?: { termo?: string; texto: string } }) {
  return [s.titulo, s.texto, s.explica?.termo, s.explica?.texto].filter(Boolean).join(' ');
}

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Números e valores no texto: "5.5", "20", "1.156"... */
const numeros = (s: string) => s.match(/\d+(?:[.,]\d+)*/g) ?? [];

/**
 * Valida o roteiro contra o briefing. Devolve a lista de problemas
 * (vazia = ok). Também barra números que não estão na notícia.
 */
export function validarRoteiro(r: Roteiro, artigo: Artigo): string[] {
  const erros: string[] = [];
  const { maxPalavrasPorSlide: max, maxPalavrasCapa, minSlides, maxSlides } = CONFIG;

  if (!r?.capa?.gancho) erros.push('capa.gancho ausente');
  else if (contarPalavras(r.capa.gancho) > maxPalavrasCapa)
    erros.push(`capa.gancho tem ${contarPalavras(r.capa.gancho)} palavras (máx. ${maxPalavrasCapa})`);

  if (!Array.isArray(r?.conteudo)) erros.push('conteudo deve ser uma lista');
  const total = 1 + (r?.conteudo?.length ?? 0) + 1 + 1; // capa + conteúdo + importa + CTA
  if (total < minSlides || total > maxSlides)
    erros.push(`o carrossel teria ${total} slides (precisa ter de ${minSlides} a ${maxSlides})`);

  (r?.conteudo ?? []).forEach((s, i) => {
    if (!s?.texto) erros.push(`conteudo[${i}].texto ausente`);
    else if (contarPalavras(textoDoSlide(s)) > max)
      erros.push(`slide ${i + 2} tem ${contarPalavras(textoDoSlide(s))} palavras (máx. ${max})`);
  });

  if (!r?.porqueImporta?.texto) erros.push('porqueImporta.texto ausente');
  else if (contarPalavras(textoDoSlide(r.porqueImporta)) > max)
    erros.push(`slide "por que importa" tem ${contarPalavras(textoDoSlide(r.porqueImporta))} palavras (máx. ${max})`);

  if (!r?.legenda?.gancho) erros.push('legenda.gancho ausente');
  if (!r?.legenda?.resumo) erros.push('legenda.resumo ausente');
  else {
    const linhas = r.legenda.resumo.split('\n').filter((l) => l.trim()).length;
    if (linhas < 2 || linhas > 3) erros.push(`legenda.resumo tem ${linhas} linhas (precisa de 2 a 3)`);
  }

  // Regra "não invente dados": todo número do roteiro precisa existir na notícia.
  const base = `${artigo.titulo} ${artigo.resumo} ${artigo.corpo}`;
  const baseNums = new Set(numeros(base));
  const textosRoteiro = [
    r?.capa?.gancho,
    ...(r?.conteudo ?? []).map(textoDoSlide),
    r?.porqueImporta && textoDoSlide(r.porqueImporta),
    r?.legenda?.gancho,
    r?.legenda?.resumo,
  ].filter(Boolean) as string[];
  const estranhos = new Set<string>();
  for (const t of textosRoteiro) for (const n of numeros(t)) if (!baseNums.has(n)) estranhos.add(n);
  if (estranhos.size)
    erros.push(`números que não aparecem na notícia: ${[...estranhos].join(', ')}`);

  // Aspas = citação; só vale se o trecho estiver na notícia.
  for (const t of textosRoteiro) {
    for (const m of t.matchAll(/["“”]([^"“”]{6,})["“”]/g)) {
      if (!normalizar(base).includes(normalizar(m[1])))
        erros.push(`citação que não está na notícia: "${m[1]}"`);
    }
  }
  return erros;
}

const SISTEMA = `Você é editor de conteúdo do Portal PromptMídia (notícias de IA e tecnologia, em português do Brasil) e transforma UMA notícia em roteiro de carrossel para Instagram.

REGRAS INEGOCIÁVEIS
- Tom direto e informativo, estilo jornalístico. Português do Brasil.
- Use SOMENTE fatos, números, nomes e citações que estejam na notícia fornecida. Nunca invente dados, números, datas ou aspas. Se a notícia diz que algo é estimativa, segredo ou não confirmado, o carrossel diz isso.
- Gatilho de curiosidade REAL: a capa precisa prometer só o que os slides entregam. Nada de clickbait enganoso.
- Cada slide tem NO MÁXIMO ${CONFIG.maxPalavrasPorSlide} palavras somando titulo + texto + explica. Frases curtas, uma ideia por slide.
- A capa (gancho) tem NO MÁXIMO ${CONFIG.maxPalavrasCapa} palavras.
- Termos técnicos de IA ganham "explica" (definição simples, com analogia do dia a dia quando couber). A analogia serve só para explicar o conceito, sem afirmar fatos novos sobre a notícia.
- Não use travessão longo (—). Sem emojis nos slides.

ESTRUTURA (o carrossel final = capa + conteudo + porqueImporta + slide de CTA, de 6 a 8 slides no total)
- "conteudo": de 3 a 5 slides, cada um com uma ideia da notícia, em ordem lógica.
- "porqueImporta": por que isso importa para quem lê.
- O slide de CTA é montado pelo sistema. Não o escreva.

IMAGEM DE FUNDO
- "imagem.consulta": busca em INGLÊS (2 a 4 palavras) para banco de fotos (Pexels/Pixabay), descrevendo uma cena ou objeto concreto que remeta ao tema da notícia (ex: "server room blue light", "lawyer courtroom gavel"). Evite pessoas identificáveis, logos, marcas, telas com texto e termos abstratos como "AI" ou "technology" sozinhos.
- "imagem.alternativa": uma segunda busca, mais genérica, caso a primeira não retorne nada.

LEGENDA
- "gancho": uma primeira linha que funcione como gancho (pode ter 1 emoji no fim).
- "resumo": 2 a 3 linhas (separe com \\n) resumindo a notícia. Sem CTA (o sistema acrescenta).
- "hashtags": de 5 a 8, relevantes, sem acentos, começando com #.

Responda APENAS com JSON válido, sem markdown, neste formato:
{
  "capa": { "gancho": "...", "tag": "palavra curta da editoria, ex: NSA, OPENAI, SEGURANÇA" },
  "conteudo": [ { "titulo": "rótulo curto (opcional)", "texto": "...", "explica": { "termo": "opcional", "texto": "..." } } ],
  "porqueImporta": { "titulo": "opcional", "texto": "..." },
  "imagem": { "consulta": "...", "alternativa": "..." },
  "legenda": { "gancho": "...", "resumo": "linha 1\\nlinha 2", "hashtags": ["#..."] }
}`;

async function chamarClaude(artigo: Artigo, apiKey: string, problemas?: string[]): Promise<Roteiro> {
  const usuario =
    `NOTÍCIA\nTítulo: ${artigo.titulo}\nResumo: ${artigo.resumo}\nFonte: ${artigo.fonte_nome}\nTags: ${artigo.tags.join(', ')}\n\nTexto:\n${artigo.corpo}` +
    (problemas?.length
      ? `\n\nSUA TENTATIVA ANTERIOR TEVE PROBLEMAS. Corrija todos e devolva o JSON completo de novo:\n- ${problemas.join('\n- ')}`
      : '');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CONFIG.modeloClaude,
      max_tokens: 2500,
      system: SISTEMA,
      messages: [{ role: 'user', content: usuario }],
    }),
  });
  if (!resp.ok) throw new Error(`Erro na API da Anthropic: ${resp.status} ${await resp.text()}`);
  const data = (await resp.json()) as { content: { type: string; text?: string }[] };
  const texto = data.content.find((b) => b.type === 'text')?.text ?? '';
  const json = texto.replace(/```json|```/g, '').trim();
  return JSON.parse(json) as Roteiro;
}

/** Gera o roteiro com o Claude; tenta de novo uma vez se a validação reclamar. */
export async function gerarRoteiro(artigo: Artigo): Promise<Roteiro> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY não definida. Defina a chave, ou coloque um roteiro.json na pasta do carrossel (veja o README do gerador).'
    );
  }
  let roteiro = await chamarClaude(artigo, apiKey);
  let erros = validarRoteiro(roteiro, artigo);
  if (erros.length) {
    console.warn('[aviso] roteiro precisou de ajuste:\n  - ' + erros.join('\n  - '));
    roteiro = await chamarClaude(artigo, apiKey, erros);
    erros = validarRoteiro(roteiro, artigo);
    if (erros.length) throw new Error('Roteiro inválido mesmo após nova tentativa:\n  - ' + erros.join('\n  - '));
  }
  return roteiro;
}
