// api/telegram-webhook.ts
//
// Função serverless na Vercel (fica em /api na raiz do projeto — funciona
// independente do Astro, não precisa de SSR habilitado no site).
// Recebe o clique nos botões do Telegram e:
//  - "Publicar": pega o frontmatter + corpo salvos na Issue e cria o arquivo
//    real no repo, em src/content/noticias/ (dispara o rebuild automático na
//    Vercel)
//  - "Descartar": só fecha a Issue

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GH_PAT! }); // PAT com escopo "repo"
const owner = process.env.GH_OWNER!;
const repo = process.env.GH_REPO!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // segredo simples na query string pra evitar que qualquer um acione o webhook
  if (req.query.secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).end();
  }

  const callback = req.body?.callback_query;
  if (!callback) return res.status(200).end(); // ignora updates que não são clique de botão

  const [action, issueNumberStr] = (callback.data as string).split(":");
  const issueNumber = Number(issueNumberStr);

  const { data: issue } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
  const issueBody = issue.body ?? "";

  if (action === "publish") {
    const slugMatch = issueBody.match(/<!--\s*slug:\s*(.+?)\s*-->/);
    const slug = slugMatch?.[1] ?? `noticia-${issueNumber}`;

    // Remove os comentários de controle (slug, crédito da capa) — eles não
    // fazem parte do schema de src/content/config.ts, só serviam pro webhook.
    const fileContent = issueBody
      .replace(/<!--\s*slug:.*?-->\n?/, "")
      .replace(/<!--\s*capa-credit:.*?-->\n?/, "")
      .replace(/^\n+/, "");

    // Collection real: src/content/noticias (ver src/content/config.ts)
    const path = `src/content/noticias/${slug}.md`;

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `feat(noticias): publica "${slug}" via aprovação no Telegram`,
      content: Buffer.from(fileContent).toString("base64"),
    });

    const urlMatch = issueBody.match(/fonte_url:\s*"(.+?)"/);
    if (urlMatch) await appendPublishedUrl(urlMatch[1]);

    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: "closed" });
    await answerTelegram(callback.id, "Publicado! A Vercel já está gerando o deploy.");
  }

  if (action === "discard") {
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: "closed" });
    await answerTelegram(callback.id, "Descartado.");
  }

  return res.status(200).end();
}

async function appendPublishedUrl(url: string) {
  const path = "data/published-sources.json";
  const { data } = await octokit.repos.getContent({ owner, repo, path });
  if (!("content" in data)) return;

  const current: string[] = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  current.push(url);

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: "chore: atualiza lista de fontes publicadas",
    content: Buffer.from(JSON.stringify(current, null, 2)).toString("base64"),
    sha: data.sha,
  });
}

async function answerTelegram(callbackQueryId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}
