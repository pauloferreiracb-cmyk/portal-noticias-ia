---
titulo: >-
  Projeto open-source promete colocar freios de segurança em agentes de IA que
  usam ferramentas via MCP
resumo: >-
  Chamado de Conduct, o projeto busca impedir que modelos de linguagem executem
  ações perigosas ao acessar ferramentas externas através do protocolo MCP.
data: '2026-08-28'
fonte_url: 'https://github.com/sseshachala/conductai'
fonte_nome: Hacker News
tags:
  - inteligência artificial
  - open source
  - MCP
  - segurança em IA
  - LLM
---
Um novo projeto de código aberto chamado Conduct chamou atenção da comunidade de desenvolvedores ao propor um conjunto de "guardrails" — barreiras de segurança — para chamadas de ferramentas feitas por modelos de linguagem (LLMs). A ferramenta foi apresentada na seção Show HN do Hacker News, espaço tradicionalmente usado por desenvolvedores para divulgar projetos pessoais e receber feedback direto da comunidade técnica.

De acordo com a página do projeto no GitHub, o Conduct atua especificamente sobre integrações que utilizam o MCP (Model Context Protocol), padrão criado para permitir que modelos de IA se conectem a fontes de dados e ferramentas externas de forma padronizada. Com a popularização do MCP entre desenvolvedores que constroem agentes autônomos, cresceu também a preocupação com os riscos de permitir que um modelo execute comandos, acesse arquivos ou interaja com sistemas sem qualquer tipo de supervisão.

É justamente esse ponto que o projeto busca resolver: oferecer uma camada intermediária capaz de inspecionar, validar ou bloquear chamadas de ferramentas antes que elas sejam efetivamente executadas. Esse tipo de abordagem tem ganhado espaço no ecossistema de IA generativa, à medida que empresas e desenvolvedores individuais passam a dar mais autonomia para agentes de IA em tarefas do mundo real, como manipulação de arquivos, execução de código e chamadas de API.

O fato de o Conduct ser open-source também segue uma tendência recente entre ferramentas de segurança para IA: em vez de depender de soluções fechadas oferecidas por grandes provedores de modelos, parte da comunidade prefere construir e auditar publicamente seus próprios mecanismos de controle. Isso permite maior transparência sobre como as regras de bloqueio ou permissão são definidas, algo especialmente relevante em aplicações que envolvem dados sensíveis ou ações irreversíveis.

Ainda não está claro qual será o nível de adoção do projeto fora do círculo inicial de curiosos do Hacker News, mas iniciativas como essa refletem um movimento mais amplo da indústria: a busca por formas confiáveis de dar autonomia a agentes de IA sem abrir mão de controle e previsibilidade sobre o que essas ferramentas podem — ou não — fazer.
