# Gerador de carrosséis (Instagram 4:5, 1080x1350)

Transforma uma notícia de `src/content/noticias/` em 6 a 8 slides PNG + legenda.

```bash
npm run carrossel                        # notícia mais recente (campo `data`)
npm run carrossel -- <slug>              # uma notícia específica
npm run carrossel -- <slug> --dm PROMPT  # coloca a palavra-chave de DM (ManyChat) no CTA e na legenda
npm run carrossel -- <slug> --foto       # usa a capa da notícia na capa do carrossel
npm run carrossel -- <slug> --refazer-roteiro   # pede um roteiro novo ao Claude
```

Saída em `carrosseis/AAAA-MM-DD-<slug>/` (a data é a da notícia):
`slide-01.png` … `slide-08.png`, `legenda.txt`, `roteiro.json`, `meta.json`.

## Como funciona

1. **Roteiro** (`roteiro.json`): o Claude lê a notícia e escreve capa, slides, "por que importa" e legenda.
   Se o `roteiro.json` já existir na pasta, ele é reaproveitado. Dá para editar o texto à mão e rodar de novo só para redesenhar.
2. **Validação** antes de desenhar: 6 a 8 slides, até 25 palavras por slide, capa com até 12,
   **todo número precisa existir na notícia** e toda citação entre aspas também.
   Se o Claude errar, ele recebe a lista de problemas e tenta uma vez de novo.
3. **Slides**: Satori + Resvg (as mesmas libs do gerador antigo), com a moldura de circuito, as cores
   (`#0A0E17`, `#00F0FF`, `#7000FF`, `#F4F6F9`) e as fontes da marca (Space Grotesk, Inter, JetBrains Mono).
4. **Legenda**: gancho, resumo de 2 a 3 linhas, CTA (link na bio + site) e de 5 a 8 hashtags.

## Configuração

| O quê | Onde |
|---|---|
| Chave do Claude | `ANTHROPIC_API_KEY` (já existe nos secrets do Actions) |
| Domínio no CTA | `SITE_DOMINIO` (padrão `promptmidia.com.br`) |
| Palavra de DM | `CARROSSEL_DM_PALAVRA` ou `--dm`. Vazio = o bloco de DM some |
| Modelo | `CLAUDE_MODEL` (mesmo padrão dos outros scripts) |

No Windows/PowerShell, uma execução com variável: `$env:CARROSSEL_DM_PALAVRA="PROMPT"; npm run carrossel`.
No CMD: `set CARROSSEL_DM_PALAVRA=PROMPT && npm run carrossel`.

## Imagens

Por padrão a capa é só tipografia. Com `--foto`, usa `public/capas-ia/<slug>.png` (padrão do projeto)
ou, na falta dele, a URL do campo `capa`. O crédito do fotógrafo (`.json` ao lado) vai para a legenda.
Nenhuma fonte de imagem nova foi introduzida.

## Automação (GitHub Actions)

Veja `carrossel-on-publish.yml.exemplo` nesta pasta: roda em todo push que adiciona uma notícia,
serve para os dois fluxos (o diário e o de aprovação por Telegram) e guarda os slides como artefato do run.
Para ativar: copie para `.github/workflows/carrossel-on-publish.yml`.

Atenção ao tamanho do repositório: cada carrossel tem ~8 MB de PNG. Por isso o exemplo não commita os
slides; ele os anexa ao run (7 dias). Se quiser versionar, commite só `legenda.txt` e `roteiro.json`.
