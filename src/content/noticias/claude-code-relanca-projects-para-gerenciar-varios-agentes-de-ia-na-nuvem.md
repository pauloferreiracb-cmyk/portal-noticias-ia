---
titulo: "Claude Code relança 'Projects' para gerenciar vários agentes de IA na nuvem"
resumo: "Nova versão permite rodar múltiplos agentes sob o mesmo projeto, com memória compartilhada, metas e biblioteca de arquivos. Um 'coordenador' organiza tudo enquanto threads trabalham em paralelo."
data: "2026-09-18T10:45:56.716Z"
fonte_url: "https://www.theverge.com/ai-artificial-intelligence/997134/anthropic-claude-code-projects"
fonte_nome: "The Verge AI"
tags: ["Claude Code", "Anthropic", "Agentes de IA", "Programação"]
capa: "https://images.unsplash.com/photo-1529101091764-c3526daf38fe?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDU5NDgxfDB8MXxyYW5kb218fHx8fHx8fHwxNzg5NzI4MzU2fA&ixlib=rb-4.1.0&q=80&w=1080"
---

A Anthropic relançou a função Projects dentro do Claude Code, sua ferramenta de programação assistida por IA, agora voltada para orquestrar múltiplos agentes trabalhando simultaneamente sob uma mesma estrutura. O recurso reformulado permite que times de desenvolvimento organizem sessões de IA com memória compartilhada, objetivos definidos e uma biblioteca comum de arquivos e artefatos gerados ao longo do trabalho.

A lógica se aproxima de ferramentas como o Grok Bot e outros gerenciadores de grupos de agentes: cada projeto passa a contar com "threads" — linhas de execução independentes — que tocam tarefas diferentes em paralelo, todas supervisionadas por um "coordenador" central. Esse coordenador é responsável por distribuir o trabalho e manter a organização geral do projeto, evitando que os agentes pisem uns nos outros sem controle.

Nos bastidores, cada thread roda como uma sessão do Claude Code na nuvem, trabalhando em sua própria branch e cópia do repositório de código. Se dois agentes acabam alterando o mesmo trecho, o sistema resolve o choque como um conflito de merge comum, igual ao que aconteceria em qualquer pull request feito por humanos. Além disso, cada thread pode subdividir ainda mais sua tarefa, delegando pedaços do trabalho para sub-agentes.

A mudança reflete uma tendência maior no mercado de ferramentas de IA para programação: em vez de um único assistente conversando com o desenvolvedor, o modelo agora é o de "equipes" de agentes autônomos operando em paralelo, com mecanismos de coordenação e resolução de conflitos emprestados diretamente das práticas de engenharia de software.
