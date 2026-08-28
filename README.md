# Portal IA

Site de notícias em Astro. Conteúdo em markdown, deploy na Vercel, sem CMS.

## Setup inicial

```bash
npm install
npm run dev        # http://localhost:4321
```

## Publicar uma notícia

1. Crie um arquivo em `src/content/noticias/nome-do-slug.md` com este frontmatter:

```md
---
titulo: "Título da notícia"
resumo: "1-2 linhas, é o que aparece no card e no gatilho de curiosidade do carrossel"
data: 2026-08-28
fonte_url: "https://fonte-original.com/artigo"
fonte_nome: "Nome da Fonte"
tags: ["ia", "lançamento"]
---

Conteúdo do artigo em markdown normal.
```

2. `git add . && git commit -m "novo: nome-do-slug" && git push`

A Vercel builda e publica automaticamente (configurar o projeto uma vez na Vercel, importando este repo).

## Gerar imagens de carrossel pro Instagram/TikTok

```bash
npm run gerar-carrossel
```

Gera 3 slides (1080x1350) por artigo novo em `output/carrossel/<slug>/`:
capa → resumo (gatilho de curiosidade) → CTA com o link do site.

Na primeira vez, baixe as fontes Inter (Regular e Bold) em
https://fonts.google.com/specimen/Inter e coloque em `scripts/fonts/`
(veja `scripts/fonts/README.md`).

Use `--forcar` pra regenerar o carrossel de todos os artigos:

```bash
npm run gerar-carrossel -- --forcar
```

Fluxo sugerido: publicar o .md → rodar o script → subir os 3 PNGs como
carrossel no Instagram/TikTok, com o print da capa do site na última
imagem e o texto "link nos comentários/bio" apontando pra `/links` ou
direto pro artigo.

## O que falta plugar (credenciais que eu não tenho)

- **Captura de e-mail**: `src/pages/api/subscribe.ts` só loga por enquanto.
  Troque o bloco `TODO` pela chamada real ao seu provedor (Resend, Beehiiv,
  ConvertKit, Mailchimp...).
- **Google AdSense**: os slots em `<AdSlot />` estão vazios de propósito.
  Depois da aprovação, troque o conteúdo do componente pelo `<ins
  class="adsbygoogle">` e cole o script do AdSense no `<head>` do
  `Layout.astro`.
- **Domínio real**: troque `SEU-DOMINIO.com.br` em `astro.config.mjs` e
  `SITE_URL` em `scripts/generate-carousel.mjs`.
- **Perfis sociais**: troque os links em `src/pages/links.astro`.

## Estrutura

```
src/
  content/noticias/*.md   -> artigos (fonte da verdade)
  content/config.ts       -> schema/validação do frontmatter
  layouts/Layout.astro    -> dark mode, header/footer, analytics, UTM
  components/             -> EmailCapture, AdSlot, NewsCard
  lib/utm.ts              -> captura e propagação de utm_source/medium/campaign
  pages/
    index.astro           -> home, 12 últimas
    noticias/[slug].astro -> página de artigo
    links.astro           -> substitui o Linktree, 8 últimas automáticas
    api/subscribe.ts      -> endpoint de captura de e-mail
scripts/generate-carousel.mjs -> automação das imagens de carrossel
```

## Performance (LCP < 1,5s)

- Zero fontes externas (stack de sistema), zero CDN, zero JS de terceiros
  além do Vercel Analytics.
- Páginas de notícia e home são 100% pré-renderizadas (`prerender = true`);
  só `/api/subscribe` roda como function.
- Imagens: se for adicionar capas nos artigos, sirva via `astro:assets`
  (`<Image />`) pra otimização automática — não incluído neste scaffold
  porque os artigos de exemplo não têm imagem.
