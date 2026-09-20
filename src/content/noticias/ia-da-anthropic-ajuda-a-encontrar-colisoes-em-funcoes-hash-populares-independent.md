---
titulo: >-
  IA da Anthropic ajuda a encontrar colisões em funções hash populares,
  independente da seed
resumo: >-
  Um experimento usando o modelo Claude revelou que hashes amplamente usados
  podem ter colisões que não dependem da seed escolhida — um achado que reacende
  debates sobre segurança em estruturas de dados.
data: '2026-09-20'
fonte_url: 'https://thomasahle.com/blog/adversarial-examples-for-hashes/'
fonte_nome: Hacker News
tags:
  - segurança
  - inteligência artificial
  - criptografia
  - hash functions
  - Claude
---
Um post recente no blog de Thomas Ahle, destacado no Hacker News, descreve como o modelo de linguagem Claude, da Anthropic, foi usado para investigar vulnerabilidades em funções de hash muito populares no desenvolvimento de software. Segundo o autor, o experimento identificou colisões — situações em que entradas diferentes geram o mesmo valor de hash — que se mantêm válidas independentemente da seed utilizada na função.

Esse tipo de colisão é particularmente preocupante porque muitas implementações de hash tables e estruturas de dados dependem de seeds aleatórias justamente para dificultar ataques de negação de serviço baseados em colisões previsíveis. Se uma colisão funciona sem depender da seed, a defesa perde parte da sua eficácia, já que o atacante não precisa saber ou manipular o valor da seed para explorar a fragilidade.

O uso de um modelo de IA como o Claude para essa tarefa chama atenção por si só. Em vez de depender apenas de técnicas tradicionais de criptoanálise ou busca exaustiva, o autor relata ter utilizado a capacidade do modelo de raciocinar sobre padrões matemáticos e estruturais das funções de hash para chegar a exemplos adversariais — entradas cuidadosamente construídas para expor o comportamento indesejado.

De acordo com a publicação, os resultados levantam questões sobre a robustez de funções de hash amplamente adotadas em linguagens de programação e bibliotecas populares, embora o texto não detalhe se as vulnerabilidades já foram reportadas aos mantenedores dos projetos afetados. O caso também se soma a um número crescente de exemplos em que modelos de linguagem são aplicados a problemas de segurança e criptografia, uma área até pouco tempo dominada quase exclusivamente por métodos formais e ferramentas especializadas.

A discussão no Hacker News reforça o interesse da comunidade técnica em entender até onde ferramentas de IA generativa podem ir na descoberta de falhas em sistemas considerados maduros e bem testados, um tópico que deve ganhar ainda mais relevância à medida que esses modelos se tornam mais sofisticados em tarefas de raciocínio técnico.
