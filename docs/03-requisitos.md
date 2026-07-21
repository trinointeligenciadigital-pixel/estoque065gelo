# Estoque 065 — Requisitos

**Versão:** 2.1 · Alinhado ao PRD 2.1 e ao Schema 2.1
**Cliente:** 065 Gelo, via Trino Inteligência Digital

---

## Como ler este documento

Cada requisito é verificável — se não dá para dizer "passou" ou "não passou" olhando o sistema, não é requisito, é intenção, e não entra aqui.

- **RF** = requisito funcional. O que o sistema faz.
- **RNF** = requisito não-funcional. Como o sistema se comporta.
- **Fase** remete às fases de entrega do PRD (seção 12).
- **Regra crítica** marca requisitos cuja violação quebra a integridade do ledger ou a segurança de acesso. Estes não são negociáveis por conveniência de implementação.

Em conflito com o schema (`02-schema-convex.md`), o schema vence.

---

## 1. Autenticação e acesso

| ID | Requisito | Fase | Crítico |
|---|---|---|---|
| RF01 | O Admin autentica via Clerk (e-mail/senha ou provedor social configurado). Só usuários com registro em `usuarios` e `ativo: true` acessam o painel. | 1 | ✔ |
| RF02 | No primeiro login de um Admin, a mutation interna `garantirUsuario` cria o registro em `usuarios` a partir do `clerkId`. Nenhuma outra escrita em `usuarios` é exposta ao cliente. | 1 | ✔ |
| RF03 | O colaborador acessa o sistema escaneando o QR físico da porta da câmara. O QR carrega o `qrToken`, que resolve para exatamente uma câmara. | 3 | ✔ |
| RF04 | Após o QR, o colaborador informa seu PIN individual. O sistema valida o PIN contra `pinHash` e verifica se a câmara do QR está em `camarasPermitidas` daquele operador. | 3 | ✔ |
| RF05 | Login bem-sucedido cria uma sessão em `sessoesOperador` vinculada a `operadorId + camaraId`, com validade de 12h a partir da emissão. | 3 | ✔ |
| RF06 | A câmara da sessão vem exclusivamente do QR escaneado. Em nenhuma tela o colaborador escolhe câmara de uma lista. | 3 | ✔ |
| RF07 | Toda mutation e query operacional do colaborador valida o token de sessão, a expiração, a permissão do tipo de ação e a correspondência `produto.camaraId === sessao.camaraId` antes de ler ou escrever. | 3 | ✔ |
| RF08 | Após N tentativas de PIN incorreto, o operador é bloqueado temporariamente (`tentativasFalhas`, `bloqueadoAte`). Tentativa durante o bloqueio é rejeitada sem revelar se o PIN estava certo. | 3 | ✔ |
| RF09 | Um cron diário remove sessões expiradas de `sessoesOperador`. Sessão expirada nunca autoriza ação, independente do cron ter rodado ou não — a validação é por `expiraEm`, não por existência do registro. | 3 | ✔ |
| RF10 | O colaborador pode encerrar a própria sessão manualmente ("Sair") a qualquer momento. | 3 | |

> **Decisão pendente de valor, não de comportamento:** o número de tentativas (RF08) e a duração do bloqueio não foram definidos com o cliente. Sugestão de partida: 5 tentativas, bloqueio de 15 minutos. Ajustável sem mudança estrutural.

---

## 2. Gestão de colaboradores e PIN

| ID | Requisito | Fase | Crítico |
|---|---|---|---|
| RF11 | O Admin cadastra colaboradores com nome, câmaras permitidas e permissões (`podeLancarProducao`, `podeLancarSaida`, `podeContar`). | 2 | |
| RF12 | O Admin gera o PIN de um colaborador com um clique. O sistema gera um PIN aleatório, salva apenas o hash em `pinHash`, e exibe o PIN em texto puro uma única vez, na resposta da mutation, para o Admin que a chamou. | 2 | ✔ |
| RF13 | O PIN em texto puro nunca é persistido, nunca é retornado por nenhuma query, e nunca aparece em log. Reexibir um PIN já gerado é impossível por construção — a única ação disponível é gerar um novo. | 2 | ✔ |
| RF14 | Gerar um novo PIN para um colaborador invalida imediatamente todas as sessões ativas daquele colaborador (delete em `sessoesOperador` via `by_operador_id`), na mesma transação da atualização do hash. | 2 | ✔ |
| RF15 | Após gerar um PIN, o Admin pode abrir um link `wa.me` pré-preenchido com os dados de acesso, para enviar manualmente ao colaborador pelo próprio WhatsApp. O sistema não envia mensagem automaticamente e não integra com a API do WhatsApp. | 2 | |
| RF16 | Desativar um colaborador (`ativo: false`) impede novos logins e invalida as sessões ativas dele imediatamente. | 2 | ✔ |
| RF17 | Colaborador nunca é deletado — quem tem movimentação no ledger permanece no banco com `ativo: false`, para que a autoria histórica continue resolvível. | 2 | ✔ |

> **Nota operacional:** RF14 e RF16 juntos formam a rotina de desligamento. Se um colaborador sai da empresa, o Admin desativa; a sessão de 12h dele não sobrevive a isso. Isso precisa constar no treinamento de go-live, senão vira regra que existe no código e não na prática.

---

## 3. Cadastros

| ID | Requisito | Fase | Crítico |
|---|---|---|---|
| RF18 | O Admin cadastra câmaras com nome e status. O sistema gera o `qrToken` de cada câmara automaticamente. | 2 | |
| RF19 | O Admin visualiza e reimprime o QR de qualquer câmara a qualquer momento, sem que o `qrToken` mude. | 2 | |
| RF20 | O Admin cadastra produtos com nome, categoria (`saborizado`, `cubo`, `escamado`), câmara, unidade base e estoque mínimo. | 2 | |
| RF21 | Ao escolher a categoria no cadastro de produto, o sistema pré-seleciona a câmara correspondente (saborizado → câmara de saborizado; cubo ou escamado → câmara compartilhada de cubo/escamado). A pré-seleção é uma sugestão de UI; o campo permanece editável no momento da criação. | 2 | |
| RF22 | Após a criação de um produto, o campo câmara é somente leitura em toda a interface. Nenhuma tela de edição de cadastro permite alterá-lo. | 2 | ✔ |
| RF23 | O Admin cadastra formatos por produto, com nome, peso em kg e a flag de peso variável. Um produto pode ter vários formatos. | 2 | |
| RF24 | O Admin cadastra veículos próprios com placa, modelo e motorista padrão. | 2 | |
| RF25 | Nenhum cadastro é deletado. Desativação é feita pela flag `ativo`. Item desativado não aparece em telas de lançamento, mas continua resolvível no histórico. | 2 | ✔ |

> RF22 existe porque editar `produtos.camaraId` faz o saldo do produto sumir do cálculo — ver PRD 8.1 e a seção de transferência de câmara no schema. A trava é de interface **e** de código: a mutation de update de produto rejeita a alteração desse campo, não apenas o formulário o esconde.

---

## 4. Lançamento de movimentações

| ID | Requisito | Fase | Crítico |
|---|---|---|---|
| RF26 | O colaborador com sessão válida e `podeLancarProducao` lança produção: escolhe o produto no grid da câmara da sessão, o formato, a quantidade, e confirma. | 3 | |
| RF27 | O grid de produtos exibe apenas produtos ativos cuja `camaraId` é a da sessão. A câmara de saborizado exibe apenas os sabores; a câmara compartilhada exibe cubo e escamado. | 3 | ✔ |
| RF28 | O colaborador com `podeLancarSaida` lança saída nos tipos venda, patrocínio e perda, pelo mesmo caminho até o grid. | 3 | |
| RF29 | Venda e patrocínio exigem o nome do cliente. O veículo pode ser um veículo próprio cadastrado ou um terceiro informado em texto livre; o motorista é informado ou herdado do motorista padrão do veículo. | 3 | |
| RF30 | Perda exige um motivo entre `derreteu`, `danificado`, `descarte` e `outro`. Quando o motivo for `outro`, a observação passa a ser obrigatória. | 3 | ✔ |
| RF31 | O peso em kg é calculado e exibido em tempo real na tela conforme a quantidade é informada, antes da confirmação. | 3 | |
| RF32 | Para formatos com peso variável, o colaborador informa o peso diretamente e a quantidade é fixada em 1. | 3 | ✔ |
| RF33 | O `sinal` e o `pesoKg` de toda movimentação são calculados no servidor a partir do `tipo` e do formato. Valores enviados pelo cliente para esses campos são ignorados. | 3 | ✔ |
| RF34 | Toda movimentação carrega uma chave de idempotência gerada no cliente. Se a chave já existir, o servidor devolve o registro existente sem inserir e sem erro. | 3 | ✔ |
| RF35 | Saída que excede o saldo do formato específico é rejeitada com mensagem clara ("saldo insuficiente nesta câmara — avise o Admin"). O sistema nunca grava saldo negativo. | 3 | ✔ |
| RF36 | Nenhuma movimentação é editável ou deletável, por nenhum perfil, em nenhuma tela. Não existe endpoint de update ou delete em `movimentacoes`. | 3 | ✔ |
| RF37 | Toda movimentação registra sua autoria: tipo (operador ou admin), o identificador correspondente, e o timestamp de registro. | 3 | ✔ |

---

## 5. Patrocínio e retorno

| ID | Requisito | Fase | Crítico |
|---|---|---|---|
| RF38 | Uma saída do tipo patrocínio fica disponível como origem para retornos posteriores. | 3 | |
| RF39 | Ao lançar um retorno, o colaborador seleciona explicitamente a movimentação de patrocínio de origem — não apenas o cliente. Se houver mais de um patrocínio em aberto para o mesmo cliente, a seleção distingue entre eles. | 3 | ✔ |
| RF40 | O retorno herda produto, câmara e formato do patrocínio de origem. Esses campos não são editáveis no lançamento do retorno. | 3 | ✔ |
| RF41 | A soma dos retornos vinculados a um patrocínio nunca ultrapassa a quantidade que saiu nele. Tentativa de exceder é rejeitada com mensagem clara. | 3 | ✔ |
| RF42 | Para qualquer patrocínio, o sistema exibe quanto saiu, quanto retornou e quanto foi consumido (saiu − retornado). | 4 | |

---

## 6. Consulta de saldo pelo colaborador

| ID | Requisito | Fase | Crítico |
|---|---|---|---|
| RF43 | O colaborador com sessão válida acessa uma tela somente leitura com o saldo atual de cada produto e formato da câmara da sessão. | 3 | |
| RF44 | A consulta de saldo exige QR + PIN, como qualquer outra ação. Não existe consulta anônima de saldo. | 3 | ✔ |
| RF45 | A consulta de saldo não gera movimentação nem altera dado nenhum. | 3 | ✔ |

---

## 7. Contagem física

| ID | Requisito | Fase | Crítico |
|---|---|---|---|
| RF46 | O colaborador com `podeContar`, ou o Admin, abre uma contagem para a câmara da sessão. | 4 | |
| RF47 | Só existe uma contagem `aberta` ou `pendente` por câmara ao mesmo tempo. Tentativa de abrir uma segunda é rejeitada. | 4 | ✔ |
| RF48 | Durante a contagem, o saldo do sistema não é exibido a quem conta — a contagem é às cegas. | 4 | ✔ |
| RF49 | A contagem é registrada por produto **e formato**, não por produto agregado. | 4 | ✔ |
| RF50 | Ao fechar a contagem, o sistema congela o saldo do sistema de cada item em `saldoSistema` e calcula a divergência (`contado − sistema`). O status passa a `pendente`. | 4 | ✔ |
| RF51 | O Admin visualiza a comparação item a item (contado, sistema, divergência) antes de decidir. | 4 | |
| RF52 | Apenas o Admin aprova ou rejeita uma contagem, e nunca o mesmo usuário que a abriu. | 4 | ✔ |
| RF53 | Aprovar uma contagem gera uma movimentação do tipo `ajuste` para cada item com divergência diferente de zero, vinculada à contagem, com o sinal da divergência. Itens sem divergência não geram movimentação. | 4 | ✔ |
| RF54 | Rejeitar uma contagem não gera movimentação nenhuma. O registro da contagem rejeitada permanece no banco. | 4 | ✔ |
| RF55 | A aprovação de contagem é a única origem possível de movimentação do tipo `ajuste`. Nenhuma outra tela ou endpoint cria ajuste. | 4 | ✔ |
| RF56 | A decisão registra quem decidiu, quando, e uma observação opcional. | 4 | |

> RF52 depende de identidade individual — é por isso que o PIN por colaborador (RF04) não é só conveniência de UX. Com PIN compartilhado por câmara, este requisito seria inverificável.

---

## 8. Painel e histórico do Admin

| ID | Requisito | Fase | Crítico |
|---|---|---|---|
| RF57 | O painel exibe o saldo de cada produto agregando seus formatos **por peso** (kg), nunca somando quantidades de formatos diferentes. | 4 | ✔ |
| RF58 | O painel exibe o saldo agregado por categoria (saborizado, cubo, escamado). | 4 | |
| RF59 | O painel exibe, na tela inicial, um badge/contador de produtos com saldo abaixo do estoque mínimo, com acesso à lista desses produtos. Produtos com `estoqueMinimo: 0` não geram alerta. | 4 | |
| RF60 | O painel destaca contagens com status `pendente`, aguardando decisão do Admin. | 4 | |
| RF61 | O histórico exibe todas as movimentações com filtros por câmara, produto, tipo, período e autor. | 4 | |
| RF62 | O histórico é somente leitura. Nenhuma linha do histórico oferece ação de edição ou exclusão. | 4 | ✔ |
| RF63 | O Admin pode lançar movimentações diretamente pelo painel, sujeito às mesmas regras de validação de saldo, idempotência e imutabilidade aplicadas ao colaborador. | 4 | |
| RF64 | A leitura de movimentações pelo colaborador é restrita à própria câmara, às próprias movimentações, e às últimas 24h. O Admin lê tudo. | 3 | ✔ |

---

## 9. Requisitos não-funcionais

| ID | Requisito | Crítico |
|---|---|---|
| RNF01 | Nenhum campo `saldo` existe no schema. Todo saldo exibido é recalculável somando o ledger. | ✔ |
| RNF02 | A tabela `movimentacoes` é append-only. Não existe `patch` nem `delete` sobre ela em nenhum ponto do código, para nenhum perfil. | ✔ |
| RNF03 | Saldo consultável, validação de saída e comparação de contagem usam `saldoDoFormato` (por `produtoId + camaraId + formatoId`). Agregação entre formatos usa `pesoTotalDoProduto` (por peso). | ✔ |
| RNF04 | Toda autorização vive em código, dentro de cada query e mutation — o Convex não tem RLS. Não existe query ou mutation operacional sem checagem de identidade e escopo. | ✔ |
| RNF05 | `pinHash` nunca sai do backend, em nenhuma query, para nenhum perfil. | ✔ |
| RNF06 | O PIN é armazenado apenas como hash, com algoritmo apropriado para senha (não hash simples). | ✔ |
| RNF07 | Interface mobile-first, PWA instalável, projetada para uso em pé, com uma mão, na porta da câmara. Alvo de toque mínimo de 56px nas telas do colaborador. | |
| RNF08 | Todo número exibido usa IBM Plex Mono; texto usa Inter. Tema claro conforme `05-prototipacao-visual.md` (fundo `#EEF3F4`, acento `#0E7C9C`). | |
| RNF09 | Sistema é online-only. Toda ação de escrita exibe estado de envio e só confirma sucesso ao colaborador após ACK do servidor — nunca otimisticamente. | ✔ |
| RNF10 | Falha de rede em um lançamento permite retry sem risco de duplicação, garantido pela chave de idempotência (RF34). | ✔ |
| RNF11 | Mensagens de erro voltadas ao colaborador são em linguagem operacional, sem jargão técnico e sem código de erro exposto. | |
| RNF12 | O painel do Admin é denso — prioriza informação por tela sobre respiro visual, ao contrário das telas do colaborador. | |
| RNF13 | Nenhuma tela expõe identificador interno (`_id`) ao usuário final. | |
| RNF14 | O cálculo de saldo somando o ledger completo é aceito no v1. Ao ultrapassar ~100k movimentações por produto, a solução é snapshot periódico, nunca um campo `saldo`. | ✔ |
| RNF15 | Timestamps são armazenados em UTC e exibidos no fuso de Cuiabá (UTC−4). | |

---

## 10. Dívidas técnicas conscientes

Registradas para não parecerem esquecimento numa auditoria futura:

| Item | Decisão |
|---|---|
| `clienteNome` é texto livre, não entidade cadastrada | Aceito no v1. Rastreabilidade de patrocínio não depende disso (é via `patrocinioOrigemId`). Se a 065 Gelo quiser relatório "todos os patrocínios do cliente X", texto livre vai gerar inconsistência de grafia — aí vira cadastro de clientes no v2. |
| `veiculoTerceiro` e `motorista` são texto livre | Mesma lógica. Não bloqueia nenhum critério de aceite do v1. |
| Não existe estorno de lançamento errado | Correção só via contagem física aprovada. Se na prática o colaborador errar com frequência a ponto de a contagem virar rotina de correção em vez de conferência, isso é sinal de que o v2 precisa de um tipo `estorno` vinculado à movimentação de origem — não de afrouxar a imutabilidade. |
| Transferência de produto entre câmaras não existe | Ver PRD 8.1. Editar `produtos.camaraId` na mão quebra o saldo. Se a necessidade aparecer, é projeto próprio. |
| Sem controle de validade e lote | Fora de escopo por decisão do cliente. |

---

## 11. Rastreio: critérios de aceite do PRD → requisitos

| Critério de aceite (PRD §10) | Requisitos que o cobrem |
|---|---|
| 1. Saldo sempre recalculável, sem campo `saldo` | RNF01, RNF03, RNF14 |
| 2. Movimentação nunca editável ou deletável | RF36, RF62, RNF02 |
| 3. Colaborador lança sem sair da câmara do QR | RF03, RF06, RF07, RF27 |
| 4. Saída acima do saldo bloqueada | RF35 |
| 5. Contagem não altera estoque sem aprovação | RF50, RF53, RF55 |
| 6. Quem abre a contagem não aprova | RF52 |
| 7. Retorno nunca excede o patrocínio de origem | RF39, RF41 |
| 8. Painel com saldo por sabor e por categoria | RF57, RF58 |
| 9. Duplo-toque não duplica | RF34, RNF10 |
| 10. Badge de estoque abaixo do mínimo | RF59 |
| 11. PIN individual; novo PIN invalida sessões | RF04, RF12, RF14, RF16 |
| 12. Colaborador consulta saldo via QR + PIN | RF43, RF44, RF45 |
| 13. Divergência por formato | RF49, RF50, RNF03 |
