import type { APIRoute } from 'astro';

// Este endpoint roda como serverless function (não é prerenderizado).
// Por enquanto só valida e loga — troque o bloco "TODO" pela chamada
// real ao seu provedor de e-mail (Resend, Mailchimp, ConvertKit, Beehiiv...).
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { email, utm_source, utm_medium, utm_campaign } = body ?? {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ erro: 'e-mail inválido' }), { status: 400 });
    }

    // TODO: chamar API do provedor de e-mail escolhido, ex:
    // await fetch('https://api.resend.com/...', { ... })
    console.log('nova inscrição:', { email, utm_source, utm_medium, utm_campaign });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ erro: 'requisição inválida' }), { status: 400 });
  }
};
