import { defineCollection, z } from 'astro:content';

const noticias = defineCollection({
  type: 'content',
  schema: z.object({
    titulo: z.string(),
    resumo: z.string(),
    data: z.coerce.date(),
    fonte_url: z.string().url(),
    fonte_nome: z.string(),
    tags: z.array(z.string()).default([]),
    // opcional: imagem de capa gerada pela automação de carrossel
    capa: z.string().optional(),
  }),
});

export const collections = { noticias };
