# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dois públicos com necessidades opostas, dentro do mesmo app:

- **Colaborador (operação)** — usa no celular, **em pé, na porta de uma câmara fria, com as mãos frias e com pressa**, uma mão só. Acessa por QR na porta + PIN. Faz poucas coisas, mas precisa fazê-las rápido e sem errar: lançar produção, lançar saída (venda/patrocínio/perda), registrar retorno de patrocínio, consultar saldo e fazer contagem física. Não é usuário de tecnologia; a tela tem que ser óbvia.
- **Admin (escritório)** — usa no desktop, sentado, **várias vezes ao dia**. Cadastra câmaras, produtos, formatos, veículos e colaboradores; acompanha o painel de estoque; confere e aprova contagens; lança movimentações; consulta histórico e patrocínios. Precisa de densidade: muita informação por tela, leitura rápida, comparação.

Contexto do negócio: **065 Gelo**, fábrica de gelo (saborizado, cubo, escamado) em Cuiabá-MT.

## Product Purpose

PWA de **controle de estoque** para uma fábrica de gelo. O estoque é sempre recalculado somando um livro-razão de movimentações (não existe campo de saldo guardado) — a fonte de verdade é o histórico, imutável e auditável. O produto existe para responder, a qualquer momento e com confiança: *quanto tem, de quê, em qual câmara, e como chegou nesse número*.

Sucesso é: o colaborador registrar um lançamento na porta da câmara em segundos sem dúvida; o Admin abrir o painel e entender o estoque num relance; e nenhuma correção de estoque acontecer sem uma contagem física aprovada. O app tem que ser confiável a ponto de a operação parar de usar papel.

## Positioning

O estoque nunca é um número digitado: é sempre a soma de um livro-razão imutável. Correção só entra por contagem física aprovada pelo Admin; o colaborador lança pelo QR da câmara + PIN pessoal. Um controle por planilha ou por mensagem não consegue prometer isso, porque ali o número pode ser sobrescrito.

## Operating Context

- Hoje, produção, vendas, patrocínios, perdas e retornos são registrados por WhatsApp — sem visibilidade por câmara nem por sabor, e com um estoque em que ninguém confia.
- Duas câmaras: Saborizado (própria) e Cubo + Escamado (compartilhada entre os dois produtos).
- Colaborador: celular, em pé, mãos frias, sessão de 12h por colaborador + câmara. Admin: desktop, no escritório.
- Sistema online-only; a cobertura de rede na câmara é tratada como infraestrutura a validar na implantação.

## Capabilities and Constraints

- Cinco tipos de movimentação (produção, venda, patrocínio, retorno, perda) num ledger append-only; sabor é produto próprio; produto tem formatos de embalagem com peso derivado; saldo por produto + câmara + formato, agregado entre formatos só por peso.
- Contagem física às cegas pelo colaborador, com aprovação obrigatória do Admin (quem conta não aprova); nunca há ajuste automático.
- Patrocínio e retorno vinculados: retornos nunca somam mais do que saiu.
- Autenticação: Admin por Clerk; colaborador por QR (câmara) + PIN individual. Stack fixa: React + Vite + TypeScript, Tailwind v4, Convex.
- Fora do v1 (decisão do cliente): validade e lote, operação offline, controle financeiro, alerta automático por e-mail/WhatsApp, transferência de produto entre câmaras.

## Brand Personality

**Moderno, leve, amigável — mas sério.** É uma ferramenta de trabalho onde há dinheiro e operação em jogo, então a leveza nunca vira brincadeira. A confiança vem da **precisão**: números tratados como leitura de instrumento (mono, alinhados, exatos), telas limpas e sem ruído, feedback honesto. Voz operacional e direta, em português claro, sem jargão técnico e sem código de erro na cara do usuário. Calmo sob pressão: quando algo dá errado, o app explica em linguagem de chão de fábrica o que fazer.

## Anti-references

- **Planilha / ERP antigo** — cinza, denso ao ponto de sufocar, botões minúsculos, tudo apertado. Densidade no Admin é bem-vinda; aperto e feiúra não.
- **SaaS genérico** — gradiente roxo, cartões idênticos em grade infinita, "bonitinho" sem identidade. Nada de decoração vazia.
- **App colorido / lúdico** — cores fortes, ícones grandes coloridos, cara de joguinho. Tira a seriedade da ferramenta.
- **Dashboard escuro "gamer"** — fundo preto com neon, estilo cripto/gamer. Conflita com o tema claro do produto (derivado do gelo, não do interior da câmara).

## Evidence on Hand

Ainda sem usuários reais, métricas de uso ou depoimentos (go-live pendente). Não fabricar números, casos ou citações. A documentação de referência está em `docs/` (PRD, schema Convex, requisitos).

## Product Principles

- **O número é o protagonista.** Peso e saldo são a informação que importa; a interface existe para deixá-los serem lidos rápido e sem erro. Tudo o mais recua.
- **Dois produtos, um app.** Colaborador precisa de telas arejadas e toque grande; Admin precisa de densidade. São necessidades opostas e cada perfil é atendido no seu próprio termo — não force um padrão único nos dois.
- **Confiança pela precisão, não pela decoração.** A seriedade vem da exatidão e da consistência (cara de instrumento), não de enfeite visual. Moderno e leve, jamais lúdico ou SaaS-genérico.
- **Só confirma o que o servidor confirmou.** Sistema é online-only; nada de estado otimista. Toda escrita mostra "enviando" e só vira sucesso após o ACK. Erro vira instrução, não código.
- **Leve, mas nunca frágil.** Arejado e sem ruído, sim; porém é uma ferramenta usada com mãos frias, com pressa, com valor em jogo — tem que passar solidez.

## Accessibility & Inclusion

- **Contraste alto (mínimo WCAG AA).** Texto corrido ≥ 4,5:1; números e rótulos grandes ≥ 3:1. O celular é usado sob luz forte e reflexo perto da câmara — legibilidade não é opcional.
- **Nunca depender só da cor.** Entrada/saída, divergência e alerta de mínimo carregam também sinal (+/−), texto ou ícone além da cor (verde/vermelho/âmbar), para quem tem daltonismo.
- **Respeitar `prefers-reduced-motion`.** Se o usuário pede menos movimento, animações viram troca suave ou instantânea.
- **Alvo de toque de 56px** nas telas do colaborador (RNF07) — uso com uma mão, mãos frias, com pressa.
- Sem expor identificador interno (`_id`) ou jargão técnico ao usuário final.
