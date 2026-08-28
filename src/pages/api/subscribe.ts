import type { APIRoute } from 'astro';
import { Resend } from 'resend';

// Este endpoint roda como serverless function (não é prerenderizado).
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { email, utm_source, utm_medium, utm_campaign } = body ?? {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ erro: 'e-mail inválido' }), { status: 400 });
    }

    const apiKey = import.meta.env.RESEND_API_KEY;
    const audienceId = import.meta.env.RESEND_AUDIENCE_ID;

    if (!apiKey || !audienceId) {
      console.error('RESEND_API_KEY / RESEND_AUDIENCE_ID não configuradas');
      return new Response(JSON.stringify({ erro: 'inscrição indisponível no momento' }), { status: 500 });
    }

    const resend = new Resend(apiKey);
    const { error } = await resend.contacts.create({
      email,
      audienceId,
      unsubscribed: false,
    });

    if (error) {
      console.error('erro Resend:', error);
      return new Response(JSON.stringify({ erro: 'não foi possível concluir a inscrição' }), { status: 502 });
    }

    console.log('nova inscrição:', { email, utm_source, utm_medium, utm_campaign });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ erro: 'requisição inválida' }), { status: 400 });
  }
};
