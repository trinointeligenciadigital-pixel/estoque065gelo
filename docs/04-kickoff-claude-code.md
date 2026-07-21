# Estoque 065 — Kickoff Claude Code

**Versão:** 2.1 · Alinhado ao PRD 2.1, Schema 2.1 e Requisitos 2.1
**Cliente:** 065 Gelo, via Trino Inteligência Digital

---

## Como usar este documento

Este é o prompt de implementação. A **seção 1** é o contexto que Claude Code precisa ter carregado sempre. As **seções 5 a 9** são os prompts de cada fase — cole **uma fase por vez**, não o documento inteiro. Fase só começa depois que a anterior passou no seu próprio checklist.

Os três documentos de referência (`01-prd-estoque-065.md`, `02-schema-convex.md`, `03-requisitos.md`) devem estar na raiz do projeto, em `/docs`. Claude Code lê deles; este arquivo não os substitui.

---

## 1. Contexto do projeto (cole no início de qualquer sessão)

```
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
```

---

## 2. Setup inicial

```
Antes da Fase 1, prepare o ambiente:

1. Crie o projeto: Vite + React + TypeScript
2. Instale e configure: convex, @clerk/clerk-react, tailwindcss v4
3. Configure o PWA (manifest + service worker; vite-plugin-pwa)
4. Configure Clerk + Convex integrados (ConvexProviderWithClerk)
5. Crie a estrutura de pastas:

   convex/
     schema.ts
     lib/          — saldo.ts, auth.ts, idempotencia.ts
     admin/        — functions do painel
     operador/     — functions do colaborador
     crons.ts
   src/
     admin/        — telas do Admin
     operador/     — telas do colaborador
     shared/       — componentes e tokens compartilhados
     lib/

6. Configure as variáveis de ambiente do Convex e do Clerk.

ATENÇÃO — ambiente Windows: o script `predev` do template padrão do Convex quebra no
Windows. Se aparecer erro nesse script, ajuste-o para funcionar no Windows em vez de
tentar contornar rodando comandos soltos.

Ao final, `npm run dev` deve subir o app com uma tela em branco e o Convex conectado.
Me diga o que testar para confirmar.
```

---

## 3. Design system (aplicar desde a primeira tela, não no final)

```
Tokens — derivados do produto (o gelo, não o interior da câmara). Detalhe completo em
docs/05-prototipacao-visual.md, se disponível.

Cores:
  fundo:      #EEF3F4
  superfície: #FFFFFF
  acento:     #0E7C9C   (ciano-petróleo — ações primárias, dados-chave)
  texto:      cinza-azulado escuro, não preto puro
  entrada:    verde discreto     (produção, retorno)
  saída:      âmbar/vermelho     (venda, patrocínio, perda)
  alerta:     usado só para estoque abaixo do mínimo e divergência — não decorativo

Tipografia:
  Inter          — todo texto
  IBM Plex Mono  — TODO número, sem exceção: saldo, quantidade, peso, PIN, divergência

Regras:
  - Telas do colaborador: arejadas, toque mínimo 56px, um objetivo por tela
  - Painel do Admin: denso, informação por tela acima de respiro
  - Nunca exponha _id do Convex na interface
  - Números sempre com unidade visível (kg, pacotes) — nunca número solto
  - Erro pro colaborador: linguagem operacional, sem código técnico

Não use gradientes, sombras exageradas, emojis em UI, nem card com borda arredondada
gigante. Isso é uma ferramenta de trabalho de chão de fábrica, não uma landing page.
```

---

## 4. Regra de testes

```
Não estamos montando suíte de teste completa. Mas os requisitos marcados como CRÍTICO
em docs/03-requisitos.md precisam de teste automatizado — são os que, se quebrarem,
corrompem o ledger ou furam o controle de acesso, e isso não se descobre olhando a tela.

Mínimo obrigatório, com convex-test:
  - Saída acima do saldo é rejeitada (RF35)
  - Mesma chave de idempotência não duplica (RF34)
  - Operador da Câmara A não escreve na Câmara B, mesmo forjando produtoId (RF07)
  - Retorno não excede o patrocínio de origem (RF41)
  - Quem abriu a contagem não aprova (RF52) — inclusive no caso admin-abre/admin-aprova
  - Gerar novo PIN invalida sessões ativas do operador (RF14)
  - Update de produto rejeita alteração de camaraId (RF22)
  - sinal e pesoKg vindos do cliente são ignorados (RF33)

Escreva o teste junto com a function, não depois.
```

---

## 5. FASE 1 — Fundação

```
FASE 1 — Fundação.

Entregas:
1. convex/schema.ts exatamente como em docs/02-schema-convex.md. Sem improviso,
   sem campo a mais, sem campo a menos. Se algo no schema parecer errado, me avise
   antes de mudar.

2. Autenticação do Admin via Clerk, com a mutation interna garantirUsuario no
   primeiro login (RF01, RF02).

3. convex/lib/auth.ts — helpers de autorização:
   - exigirAdmin(ctx) → valida Clerk, busca em usuarios, exige ativo:true
   - exigirSessaoOperador(ctx, token) → valida token, expiração, retorna operador+camara
   - exigirPermissao(operador, tipo) → checa podeLancarProducao/Saida/Contar
   - exigirCamaraDoProduto(ctx, produtoId, camaraId) → o check da regra 6

4. convex/lib/saldo.ts — saldoDoFormato e pesoTotalDoProduto, exatamente como no schema.

5. convex/lib/idempotencia.ts — helper que busca por chaveIdempotencia e devolve o
   registro existente sem inserir, se já houver.

6. Layout base: shell do Admin (autenticado) e shell do operador (público até o PIN),
   já com os tokens de design aplicados.

Checklist da fase:
[ ] Login de Admin funciona e cria o registro em usuarios
[ ] Usuário Clerk sem registro ativo em usuarios NÃO acessa o painel
[ ] Schema deployado no Convex sem erro
[ ] Nenhum campo `saldo` existe em lugar nenhum
[ ] Os helpers estão prontos e testados, mesmo sem tela que os use ainda
```

---

## 6. FASE 2 — Cadastros

```
FASE 2 — Cadastros. Tudo aqui é painel do Admin, desktop, denso.

Entregas:
1. CRUD de câmaras (RF18, RF19)
   - qrToken gerado automaticamente na criação
   - tela de visualização e impressão do QR, com o nome da câmara legível no papel
   - reimprimir NÃO muda o qrToken

2. CRUD de produtos (RF20, RF21, RF22)
   - ao escolher categoria, pré-selecione a câmara:
       saborizado → câmara de saborizado
       cubo ou escamado → câmara compartilhada de cubo/escamado
     A pré-seleção é sugestão de UI; o campo é editável NA CRIAÇÃO.
   - depois de criado, o campo câmara é somente leitura na UI E a mutation de update
     REJEITA alteração de camaraId. As duas coisas, não uma. (RF22 — crítico)

3. CRUD de formatos por produto (RF23)
   - peso em kg; flag pesoVariavel
   - quando pesoVariavel = true, o campo pesoKg fica desabilitado

4. CRUD de veículos (RF24)

5. CRUD de operadores (RF11 a RF17)
   - nome, câmaras permitidas, três permissões
   - botão "Gerar PIN": gera PIN aleatório de 6 dígitos, salva só o hash,
     INVALIDA todas as sessões ativas do operador na mesma transação,
     e retorna o PIN em texto UMA VEZ, só nessa resposta (RF12, RF13, RF14)
   - a tela exibe o PIN gerado em destaque, em IBM Plex Mono, com aviso de que
     não será possível vê-lo de novo
   - botão "Enviar por WhatsApp": abre link wa.me pré-preenchido com o PIN e uma
     instrução curta. O sistema NÃO envia nada sozinho, não integra API. (RF15)
   - desativar operador invalida as sessões dele imediatamente (RF16)
   - operador nunca é deletado (RF17)

6. Nenhum cadastro tem botão de deletar. Só ativar/desativar. (RF25)

Use hash apropriado para senha no PIN (bcrypt ou similar compatível com o runtime do
Convex), não hash simples (RNF06). Se houver limitação do runtime, me avise antes de
escolher.

Checklist da fase:
[ ] QR de cada câmara imprime e é escaneável por celular
[ ] Criar produto saborizado pré-seleciona a câmara de saborizado
[ ] Editar produto NÃO permite mudar a câmara (nem pela tela, nem chamando a mutation)
[ ] Gerar PIN mostra o PIN uma vez e derruba a sessão ativa daquele operador
[ ] Link do WhatsApp abre com a mensagem pronta
[ ] Nenhuma tela de cadastro tem botão de excluir
```

---

## 7. FASE 3 — Operação

```
FASE 3 — Operação. Tudo aqui é o colaborador, no celular, na porta da câmara.
Esta é a fase que define se o produto é usado ou se o WhatsApp volta.

Entregas:
1. Fluxo de acesso (RF03 a RF10)
   - rota que recebe o qrToken do QR escaneado → resolve a câmara
   - tela de PIN: teclado numérico grande, nome da câmara visível o tempo todo
     (o colaborador precisa saber onde está antes de digitar)
   - login cria sessão de 12h presa a operadorId + camaraId
   - rate limit: 5 tentativas, bloqueio de 15 minutos. Erro não revela se o PIN
     estava certo ou se o operador está bloqueado — mensagem única. (RF08)
   - botão "Sair" sempre acessível
   - a câmara NUNCA é escolhida numa lista. Vem só do QR. (RF06)

2. Menu da câmara — no máximo quatro ações grandes:
   Lançar produção · Lançar saída · Ver saldo · Contar (se podeContar)
   Ações sem permissão não aparecem — não aparecem desabilitadas.

3. Lançar produção (RF26, RF27, RF31, RF32, RF33, RF34)
   - grid de produtos: só os ativos da câmara da sessão
   - formato → quantidade → kg calculado e exibido em tempo real
   - formato com pesoVariavel: colaborador digita o kg, quantidade = 1
   - chave de idempotência gerada no cliente ANTES do envio, uma por lançamento
   - botão de confirmar mostra estado "enviando" e só confirma sucesso após o ACK
     do servidor. Nunca otimista. (RNF09)

4. Lançar saída (RF28, RF29, RF30, RF35)
   - tipos: venda, patrocínio, perda
   - venda/patrocínio: cliente (texto) + veículo (próprio da lista OU terceiro em
     texto) + motorista (herda o padrão do veículo, editável)
   - perda: motivo entre derreteu/danificado/descarte/outro.
     Motivo "outro" torna a observação OBRIGATÓRIA. (RF30)
   - saldo insuficiente NAQUELE FORMATO bloqueia com:
     "Saldo insuficiente nesta câmara — avise o Admin." (RF35)
     Validação no servidor, sempre. A checagem no cliente é cortesia, não segurança.

5. Retorno de patrocínio (RF38 a RF41)
   - lista os patrocínios com saldo em aberto NAQUELA câmara
   - colaborador seleciona a MOVIMENTAÇÃO de origem, não o cliente (RF39)
     Se o mesmo cliente tem dois patrocínios abertos, ele precisa distinguir —
     mostre data, produto, formato e quanto ainda está em aberto em cada um.
   - produto, câmara e formato herdados da origem, não editáveis (RF40)
   - soma dos retornos nunca excede o que saiu (RF41)

6. Ver saldo (RF43, RF44, RF45)
   - somente leitura, dentro da sessão autenticada
   - saldo por produto e formato da câmara da sessão
   - não gera movimentação nenhuma

7. Leitura de movimentações pelo operador: só a própria câmara, só as dele,
   só as últimas 24h (RF64)

Checklist da fase:
[ ] Escanear o QR da câmara de saborizado e digitar o PIN abre o menu daquela câmara
[ ] O grid da câmara de saborizado mostra só sabores; o da câmara cubo/escamado
    mostra cubo e escamado
[ ] Duplo-toque no confirmar gera UM lançamento, não dois
[ ] Tentar vender mais do que tem bloqueia com mensagem clara
[ ] Retorno de patrocínio distingue dois patrocínios do mesmo cliente
[ ] Ver saldo não altera nada
[ ] PIN errado 5 vezes bloqueia por 15 min sem dizer o motivo exato
```

---

## 8. FASE 4 — Controle

```
FASE 4 — Controle. Contagem física, painel e histórico.

Entregas:
1. Contagem física — abertura e preenchimento (RF46 a RF50)
   - colaborador com podeContar (ou Admin) abre contagem para a câmara da sessão
   - rejeita abrir se já houver contagem aberta ou pendente naquela câmara (RF47)
   - a contagem é POR FORMATO, não por produto agregado (RF49)
   - CONTAGEM ÀS CEGAS: quem conta NÃO vê o saldo do sistema em nenhum momento,
     nem na tela, nem no payload da query. Não mande o dado pro cliente. (RF48)
   - ao fechar: congela saldoSistema de cada item, calcula divergência
     (contado − sistema), status vira pendente (RF50)

2. Contagem física — decisão do Admin (RF51 a RF56)
   - tela de comparação item a item: contado, sistema, divergência
   - divergência zero em destaque neutro; divergência diferente de zero em alerta
   - aprovar: gera UMA movimentação tipo "ajuste" por item com divergência ≠ 0,
     vinculada à contagem, com o sinal da divergência. Item sem divergência não
     gera movimentação. (RF53)
   - rejeitar: não gera movimentação nenhuma; o registro permanece (RF54)
   - quem abriu NÃO pode aprovar — inclusive quando um Admin abriu e outro Admin
     decide, compare os clerkId. (RF52 — crítico, teste explícito)
   - ajuste só nasce daqui. Nenhuma outra tela cria ajuste. (RF55)

3. Painel do Admin (RF57 a RF60)
   - saldo por produto agregando formatos POR PESO, nunca somando quantidades
     de formatos diferentes (RF57 — crítico)
   - saldo agregado por categoria (RF58)
   - badge/contador de produtos abaixo do estoque mínimo na tela inicial,
     clicável, levando à lista. estoqueMinimo = 0 não gera alerta. (RF59)
   - destaque de contagens pendentes aguardando decisão (RF60)

4. Histórico (RF61, RF62)
   - filtros: câmara, produto, tipo, período, autor
   - somente leitura. Nenhuma linha tem ação de editar ou excluir.

5. Lançamento pelo Admin (RF63)
   - mesmas validações do colaborador: saldo, idempotência, imutabilidade.
     Admin não tem atalho para furar regra.

6. Consulta de patrocínio (RF42)
   - para qualquer patrocínio: quanto saiu, quanto voltou, quanto foi consumido

Checklist da fase:
[ ] Quem está contando não vê o saldo do sistema em lugar nenhum
[ ] Fechar contagem congela a foto do saldo
[ ] Aprovar gera ajuste só nos itens com divergência
[ ] Rejeitar não mexe no estoque
[ ] O mesmo usuário não consegue abrir e aprovar
[ ] Painel mostra saldo por sabor em kg, somando os formatos corretamente
[ ] Badge de estoque mínimo aparece e leva à lista
[ ] Nenhuma tela do histórico tem botão de editar ou excluir
```

---

## 9. FASE 5 — Implantação

```
FASE 5 — Implantação. Menos código, mais realidade.

Entregas:
1. Cron diário de limpeza de sessões expiradas (RF09)
   Lembre: sessão expirada não autoriza nada mesmo que o cron não tenha rodado —
   a validação é por expiraEm, não por existência do registro.

2. PWA finalizado: manifest, ícones, instalável no Android, testado em celular real

3. Timestamps em UTC no banco, exibidos em UTC−4 (Cuiabá) (RNF15)

4. Revisão de mensagens de erro do colaborador: linguagem operacional,
   sem código técnico, sem stack trace (RNF11)

5. Deploy: Convex produção + frontend (Netlify ou Vercel)

6. Roteiro de go-live para eu executar com o cliente:
   - cadastrar câmaras, imprimir e fixar os QRs nas portas
   - cadastrar produtos, formatos e estoque mínimo de cada um
   - cadastrar colaboradores, gerar PIN de cada um, enviar por WhatsApp
   - CONTAGEM INICIAL de todas as câmaras — obrigatória. É ela que estabelece
     o saldo zero do ledger. Sem isso, todo saldo nasce errado.
   - treinamento: fluxo de lançamento, e a rotina de desligamento
     (desativar operador derruba a sessão dele)

Checklist final — os 13 critérios de aceite do PRD, seção 10:
[ ] 1. Nenhum campo `saldo` existe; todo saldo é somado do ledger
[ ] 2. Nenhuma movimentação é editável ou deletável, por nenhum perfil
[ ] 3. Colaborador lança sem sair da câmara do QR escaneado
[ ] 4. Saída acima do saldo do formato é bloqueada, sem saldo negativo
[ ] 5. Contagem fechada não altera estoque sem aprovação do Admin
[ ] 6. Quem abre a contagem não aprova
[ ] 7. Retorno nunca soma mais do que saiu no patrocínio de origem
[ ] 8. Painel mostra saldo por sabor e agregado por categoria
[ ] 9. Duplo-toque não duplica lançamento
[ ] 10. Badge de estoque abaixo do mínimo na tela inicial do Admin
[ ] 11. PIN individual; novo PIN invalida sessões ativas na hora
[ ] 12. Colaborador consulta saldo via QR + PIN, sem gerar movimentação
[ ] 13. Contagem compara divergência por formato
```

---

## 10. Armadilhas conhecidas

Coisas que vão dar errado se ninguém prestar atenção. Vale colar junto com a fase correspondente.

| Armadilha | Fase | O que fazer |
|---|---|---|
| Cachear saldo "pra otimizar" | 1 | Não. Snapshot é decisão de v2, só acima de ~100k movimentações por produto. |
| Somar `quantidade` de formatos diferentes no painel | 4 | Agregação entre formatos é por **peso**. Quantidade só faz sentido dentro de um formato. |
| Bloquear edição de `camaraId` só no formulário | 2 | A mutation também precisa rejeitar. UI não é segurança. |
| Mandar o saldo do sistema pro cliente durante a contagem | 4 | Contagem às cegas quebra se o dado sai do servidor, mesmo que a tela não mostre. |
| Confirmar lançamento otimisticamente | 3 | Sistema é online-only. Confirmação só depois do ACK — senão o colaborador não sabe se lançou. |
| Esquecer o caso admin-abre / admin-aprova em RF52 | 4 | Quando o operador abre, a distinção é automática. Quando um Admin abre, precisa comparar clerkId. |
| Deixar o `predev` do template quebrar no Windows | Setup | Corrigir o script, não contornar rodando comandos soltos. |
| Aceitar `sinal` ou `pesoKg` do cliente | 3 | Sempre calculado no servidor, a partir de `tipo` e do formato. |

---

## 11. Quando parar e perguntar

Claude Code deve interromper e me consultar, em vez de decidir sozinho, se:

- Encontrar contradição entre PRD, schema e requisitos
- Precisar de um campo que não existe no schema
- Uma regra crítica parecer impossível de implementar como especificada
- O runtime do Convex não suportar o algoritmo de hash escolhido para o PIN
- Qualquer decisão que mude escopo, mesmo que pareça pequena e óbvia

Nos demais casos: decida, implemente, e me diga o que testar.
