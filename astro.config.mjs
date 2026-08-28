import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

// Modo "server": a maioria das páginas é pré-renderizada (prerender = true),
// só o endpoint de captura de e-mail (/api/subscribe) roda como function.
export default defineConfig({
  output: 'server',
  adapter: vercel({
    webAnalytics: { enabled: true },
  }),
  site: 'https://SEU-DOMINIO.com.br',
});
