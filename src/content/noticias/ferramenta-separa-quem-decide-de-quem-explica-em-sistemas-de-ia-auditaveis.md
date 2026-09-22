---
titulo: "Ferramenta separa quem decide de quem explica em sistemas de IA auditáveis"
resumo: "Startup lança motor de regras que toma a decisão e deixa a IA generativa apenas justificar o resultado, citando documentos oficiais — pensado para crédito, fraude e triagem clínica."
data: "2026-09-22T16:29:57.619Z"
fonte_url: "https://ai-rete-rag.com/"
fonte_nome: "Hacker News (IA)"
tags: ["IA explicável", "auditoria de IA", "regras de negócio", "RAG"]
capa: "https://images.unsplash.com/photo-1631047085941-a29e9730a7e6?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDU5NDgxfDB8MXxyYW5kb218fHx8fHx8fHwxNzkwMDk0NTk3fA&ixlib=rb-4.1.0&q=80&w=1080"
---

Um problema recorrente em setores como concessão de crédito, detecção de fraude e triagem médica é colocar um modelo de linguagem para tomar decisões que depois precisam ser explicadas a um regulador ou auditor. O ai·rete·rag propõe inverter a lógica: um motor de regras baseado no algoritmo Rete, escrito em Python puro, avalia condições em YAML contra os fatos do caso e produz o veredito. Só depois entra a IA generativa, que busca trechos em documentos de política da própria empresa (via RAG) e escreve uma explicação em linguagem simples — sem poder alterar a decisão já tomada.

Segundo o criador da ferramenta, as regras funcionam como um grafo, não uma lista simples: é possível aninhar condições do tipo "todos", "qualquer" e "nenhum", e uma regra pode gerar fatos que alimentam outras regras em cadeia. Um modo de auditoria registra cada regra avaliada — inclusive as que não dispararam — condição por condição, com um retrato do conjunto de regras para permitir replay exato do que aconteceu.

Outro detalhe é a integração entre as duas etapas: uma regra que dispara pode restringir quais documentos serão buscados pela IA, e o texto recuperado pode virar fato novo para o motor reavaliar. Autores sem conhecimento técnico podem montar regras num editor visual ou colar uma política inteira para que um modelo de linguagem rascunhe as regras com citações — mas nenhum rascunho é salvo sem revisão humana.

A plataforma oferece demonstração pública sem cadastro em oito áreas (empréstimo, fraude, clínica, seguro, jurídico, operações, e-commerce e blockchain) e um servidor MCP que permite a agentes como o Claude chamar a decisão como uma ferramenta. O produto é hospedado e pago, com camada gratuita; apenas o cliente MCP é aberto, sob licença MIT.
