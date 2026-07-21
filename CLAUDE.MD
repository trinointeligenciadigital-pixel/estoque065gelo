Você está implementando o Estoque 065, um PWA de controle de estoque para a 065 Gelo,
uma fábrica de gelo (saborizado, cubo e escamado) em Cuiabá-MT.

DOCUMENTOS DE REFERÊNCIA — leia antes de escrever qualquer código:
- docs/01-prd-estoque-065.md — visão, escopo, riscos, critérios de aceite
- docs/02-schema-convex.md — modelagem de dados e autorização (FONTE DE VERDADE)
- docs/03-requisitos.md — RF01–RF64, RNF01–RNF15

Em caso de conflito entre documentos, o schema vence. Se você achar uma contradição
entre os documentos, PARE e me pergunte — não escolha um lado sozinho.

STACK (não negociável, não sugerir alternativas):
- React 18 + Vite + TypeScript
- Tailwind v4
- Convex — backend, banco e cron. Sem servidor próprio, sem API REST.
- Clerk — autenticação do Admin apenas
- PWA mobile-first, instalável

CONTEXTO DE USO:
Colaborador usa o app em pé, na porta de uma câmara fria, com o celular, mãos frias,
com pressa. Admin usa no escritório, no desktop, várias vezes por dia. São dois
produtos dentro do mesmo app, com necessidades opostas: colaborador precisa de telas
arejadas com toque grande; Admin precisa de densidade de informação.

REGRAS ARQUITETURAIS INVIOLÁVEIS — se qualquer uma for violada, a implementação está
errada, mesmo que funcione:

1. Não existe campo `saldo` em lugar nenhum. Todo saldo é somado do ledger em tempo
   de leitura. Se você sentir vontade de "cachear o saldo pra otimizar", não faça —
   está previsto no schema como snapshot de v2, e não é agora.

2. `movimentacoes` é append-only. Nenhum ctx.db.patch, nenhum ctx.db.delete sobre
   essa tabela, em nenhum ponto, para nenhum perfil, nem admin. Correção é uma nova
   movimentação de ajuste, gerada só por contagem aprovada.

3. `sinal` e `pesoKg` são calculados no servidor. Se vierem do cliente, ignore.

4. `produtos.camaraId` é definido na criação e nunca mais editado. A mutation de
   update de produto deve REJEITAR alteração desse campo, não só escondê-lo na UI.
   Motivo em docs/01-prd-estoque-065.md seção 8.1.

5. Convex não tem RLS. Toda autorização é código dentro de cada query e mutation.
   Não existe function operacional sem checagem de identidade e escopo.

6. Saldo consultável, validação de saída e contagem usam saldoDoFormato
   (produtoId + camaraId + formatoId). Agregação entre formatos é por PESO
   (pesoTotalDoProduto), nunca somando quantidade de formatos diferentes.

COMO TRABALHAR COMIGO:
- Eu não tenho formação em programação. Explique decisões em português claro,
  sem jargão desnecessário. Quando o jargão for inevitável, explique na primeira vez.
- Prefiro que você DECIDA e me mostre, em vez de me perguntar entre opções.
  Pergunte só quando a decisão for irreversível ou mudar o escopo.
- Trabalhe em passos pequenos e verificáveis. Ao terminar cada passo, me diga
  exatamente o que eu devo testar na tela para confirmar que funcionou.
- Se eu pedir algo que contradiz os documentos ou as regras acima, me avise
  antes de fazer. Não implemente calado.