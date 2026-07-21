# Estoque 065 — PRD

**Versão:** 2.1 · Substitui a 2.0
**Cliente:** 065 Gelo, via Trino Inteligência Digital

---

## Changelog 2.0 → 2.1

- Removida a função de e-mail diário de estoque baixo. Substituída por badge/contador no painel do Admin.
- PIN deixa de ser por câmara e passa a ser individual, por colaborador. Admin gera o PIN (botão de geração automática), pode reenviar via link de WhatsApp, e a geração de um novo PIN invalida imediatamente as sessões ativas daquele colaborador.
- Adicionado fluxo de consulta de saldo pelo colaborador via QR + PIN (leitura, sem lançamento).
- Confirmado e documentado: Câmara de Saborizado é própria; Câmara de Cubo e Escamado é compartilhada entre os dois produtos (decisão do cliente, não pendência).
- Contagem física passa a ser por formato, não por produto agregado — necessário para o cálculo de divergência ser correto quando um produto tem mais de um formato.
- Documentada (mas não implementada no v1) a regra de transferência de produto entre câmaras.

---

## 1. Problema

A 065 Gelo produz gelo saborizado, cubo e escamado. Produção, vendas, patrocínios, perdas e retornos são hoje registrados por WhatsApp. Isso gera decentralização e estoque em que ninguém confia, sem visibilidade por câmara nem por sabor.

## 2. Objetivos

| Objetivo | Como se verifica |
|---|---|
| Substituir o WhatsApp como registro de estoque | O colaborador lança produção e saída sem precisar perguntar nada a ninguém, e sem enviar mensagem em paralelo |
| Confiabilidade de saldo | O Admin resolve uma divergência de contagem pela tela de Divergências, sem abrir o banco de dados na mão |
| Rastreabilidade de patrocínio | Para qualquer patrocínio, dá para responder na hora quanto saiu, quanto voltou e quanto foi consumido |
| Usabilidade no chão de fábrica | Um colaborador novo lança sua primeira produção sozinho, sem treinamento formal, só olhando a tela |

> Estas são metas qualitativas, verificáveis por observação direta do sistema em uso —
> não números-alvo (ex.: "X% de divergência", "Y segundos por lançamento"). Nenhum limiar
> numérico foi validado com o cliente; inventar um aqui pareceria acordado sem ter sido.
> Se a 065 Gelo quiser metas numéricas, defina-as com eles depois do go-live, com dados
> reais de uso como base — não antes.

## 3. Personas

- **Colaborador de produção/expedição** — em pé na porta da câmara, celular, mãos frias, pressa. Precisa lançar sem pensar. Tem PIN próprio, não compartilhado.
- **Admin (gestão 065 Gelo)** — escritório, várias consultas por dia, decide sobre divergências, acompanha ruptura e gerencia acesso dos colaboradores.

## 4. Escopo v1

**Incluído:**
- Cinco tipos de movimentação (produção, venda, patrocínio, retorno, perda), em ledger append-only
- Sabor como produto próprio, com saldo e alerta independentes
- Formatos de embalagem por produto, com peso derivado
- Estoque por câmara fria. **Câmara de Saborizado é própria; Câmara de Cubo e Escamado é compartilhada** entre os dois produtos — cada produto é cadastrado já vinculado à câmara correspondente
- Acesso do colaborador via QR (identifica a câmara) + PIN individual (identifica a pessoa), sessão de 12h por colaborador+câmara
- Colaborador pode consultar o saldo da câmara escaneando o QR e autenticando com PIN, sem precisar lançar nada
- Geração de PIN pelo Admin com um clique, com opção de compartilhar os dados de acesso via link de WhatsApp; gerar novo PIN invalida sessões ativas do colaborador na hora
- Contagem física com aprovação obrigatória do Admin, por formato — nunca ajuste automático
- Painel com saldo por produto (agregando formatos por peso), agregado por categoria, e badge de estoque abaixo do mínimo
- Histórico completo com filtros, imutável

**Fora do escopo v1** (decisão do cliente):
- Controle de validade e de lote
- Operação offline
- Qualquer controle financeiro
- Envio automático de e-mail ou WhatsApp de alerta (o painel supre essa necessidade no v1)
- Transferência de produto entre câmaras (ver seção 8 — documentado, não implementado)

## 5. Fluxos principais

**Lançar produção (colaborador):** escaneia QR da câmara → PIN individual → menu da câmara → "Lançar produção" → escolhe produto no grid (câmara de saborizado mostra só os sabores; câmara de cubo/escamado mostra os dois) → formato → quantidade (kg calculado em tempo real) → confirma.

**Lançar saída (colaborador):** mesmo caminho até o grid → escolhe venda, patrocínio ou perda → preenche contexto (cliente, veículo, motorista, ou motivo de perda) → confirma. Saldo insuficiente naquele formato bloqueia com mensagem clara.

**Consultar saldo (colaborador):** escaneia QR da câmara → PIN individual → "Ver saldo" → tela somente leitura com o saldo de cada produto/formato daquela câmara. Não gera movimentação.

**Contagem física (colaborador abre, Admin decide):** colaborador conta às cegas, por formato (sem ver o saldo do sistema) → fecha → sistema congela o saldo de cada formato e calcula divergência → Admin vê a comparação → aprova (gera ajustes por formato) ou rejeita. Quem abre a contagem não pode ser quem aprova.

**Patrocínio e retorno:** saída de patrocínio gera vínculo; retornos sucessivos abatem do que saiu, sem exceder o total, e herdam o produto do patrocínio de origem.

**Gerar/renovar PIN (Admin):** tela de colaborador → botão "Gerar PIN" → sistema gera PIN aleatório, salva o hash, invalida sessões ativas do colaborador, exibe o PIN em texto uma única vez para o Admin → opção de abrir link `wa.me` pré-preenchido para o Admin enviar manualmente ao colaborador.

## 6. Arquitetura

React + Vite + Tailwind v4, PWA mobile-first. Convex como backend, banco e cron — sem servidor próprio. Clerk autentica o Admin; colaboradores autenticam por QR (câmara) + PIN individual (pessoa), com sessão gerida inteiramente no Convex e vinculada a operador + câmara. Toda mutation operacional valida sessão, permissão e câmara antes de escrever. Detalhe completo em `02-schema-convex.md`.

## 7. Design

Tema claro, derivado do produto — o gelo, não o interior da câmara fria. Fundo `#EEF3F4`, superfície branca, acento ciano-petróleo `#0E7C9C`. Inter para texto, IBM Plex Mono para todo número. Painel do Admin denso; telas do colaborador arejadas, toque mínimo 56px. Derivação completa e justificada em `05-prototipacao-visual.md`.

## 8. Riscos

**Técnicos**

| Risco | Mitigação |
|---|---|
| Cobertura de rede falha na câmara (sistema é online-only) | Validar cobertura na implantação; tratar como infraestrutura; feedback visual de "enviando" e confirmação só após ACK do servidor |
| Divergência de contagem vira rotina em vez de exceção | Aprovação do Admin obrigatória; quem conta não pode aprovar |
| Colaborador lança na câmara errada | Câmara vem do QR, não de escolha manual; mutation valida no servidor |
| Duplo-toque gera lançamento duplicado | Chave de idempotência gerada no cliente em toda movimentação |
| Reorganização física move produto de câmara sem que o sistema saiba | Não suportado no v1 — ver seção 8.1. Editar `produtos.camaraId` diretamente é proibido por regra de negócio; qualquer necessidade real disso precisa de projeto próprio antes de mexer no campo |

**De adoção**

| Risco | Mitigação |
|---|---|
| Colaborador volta ao WhatsApp por hábito, e os dois canais coexistem sem que ninguém perceba | Acompanhar nas primeiras semanas se o volume de mensagem de estoque no WhatsApp cai; se não cair, o problema não é técnico |
| QR da câmara é danificado, perdido ou removido da porta | QR reimprimível a qualquer momento pelo Admin; manter uma cópia física de reserva na câmara |
| Colaborador esquece o PIN e trava a operação no meio de um turno | Admin gera um novo PIN em um clique a qualquer momento e pode reenviar via WhatsApp; geração invalida a sessão antiga automaticamente |
| Colaborador desligado mantém acesso pela sessão de 12h ainda ativa | Gerar novo PIN invalida todas as sessões ativas daquele colaborador imediatamente — deve ser rotina de desligamento |

### 8.1 Nota — transferência de produto entre câmaras (não implementado)

O saldo é calculado somando o ledger por `produtoId + camaraId + formatoId`. Se o campo `produtos.camaraId` for editado diretamente para mover um produto de câmara, o histórico de movimentações antigas permanece com o `camaraId` anterior, e a consulta de saldo pelo `camaraId` novo não vai encontrar esse histórico — o sistema aparenta ter perdido o estoque, mesmo que nada tenha sumido fisicamente.

Essa operação não está prevista no v1, porque o vínculo produto↔câmara já está definido por categoria (saborizado / cubo+escamado) e não é esperado que mude. Se a 065 Gelo precisar mover um produto de câmara no futuro, isso deve virar um tipo de movimentação próprio (ex.: `transferenciaCamara`, com saída da câmara antiga e entrada na nova), nunca uma edição direta do campo. Fica registrado aqui como decisão consciente de escopo, não como esquecimento.

## 9. Fora de escopo — v2

Exportação Excel/PDF · webhook do Clerk · snapshot de saldo (só se o volume justificar — nunca um campo `saldo`) · portal B2B do cliente · sensor IoT de temperatura · transferência de produto entre câmaras (seção 8.1) · envio automático de alerta por e-mail/WhatsApp.

## 10. Critérios de aceite

1. Todo saldo exibido é recalculável somando o ledger — nenhum campo `saldo` existe no schema
2. Nenhuma movimentação é editável ou deletável, por nenhum perfil, em nenhuma tela
3. Colaborador lança produção ou saída sem sair da câmara do QR escaneado
4. Saída que excede o saldo do formato é bloqueada com mensagem clara, nunca gera saldo negativo
5. Contagem física fechada nunca altera o estoque sem aprovação explícita do Admin
6. Quem abre uma contagem não pode ser quem a aprova
7. Retornos de patrocínio nunca somam mais do que saiu na movimentação de origem
8. Painel mostra saldo por produto (por sabor, agregando formatos por peso) e agregado por categoria
9. Reenvio do mesmo lançamento (duplo-toque, retry) não duplica a movimentação
10. Painel do Admin mostra badge/contador de produtos com saldo abaixo do mínimo, visível na tela inicial
11. PIN é individual por colaborador; gerar um novo PIN invalida imediatamente as sessões ativas desse colaborador
12. Colaborador consulta o saldo da própria câmara via QR + PIN, sem gerar movimentação
13. Contagem física registra e compara divergência por formato, não só por produto agregado

## 11. Perfis e permissões

Ver `02-schema-convex.md`, seção de autorização — regras vivem em código, o Convex não tem RLS.

## 12. Fases de entrega

1. **Fundação** — setup, autenticação admin, schema, helpers de autorização
2. **Cadastros** — câmaras, produtos (já vinculados à câmara por categoria), formatos, veículos, operadores
3. **Operação** — acesso do colaborador via QR + PIN individual, produção, saídas, retornos, consulta de saldo
4. **Controle** — contagem física por formato com fluxo de aprovação, painel com badge de estoque mínimo, histórico
5. **Implantação** — geração de PIN em massa dos colaboradores, contagem inicial nas câmaras, treinamento e go-live

Os critérios de aceite da seção 10 servem de checklist ao final de cada fase.

## 13. Documentos relacionados

| Documento | Conteúdo |
|---|---|
| `01-prd-estoque-065.md` | Este documento — visão consolidada |
| `02-schema-convex.md` | Modelagem de dados e autorização |
| `03-requisitos.md` | RF01–RF53, RNF01–RNF15 |
| `04-kickoff-claude-code.md` | Prompt de implementação |
| `05-prototipacao-visual.md` | Derivação visual, telas e design system |

> **Em caso de conflito entre documentos:** para modelagem de dados e regra de negócio,
> `02-schema-convex.md` é a fonte de verdade — é o mais próximo do código, o mais difícil
> de deixar desatualizado sem que algo quebre. Para escopo (o que entra e o que fica de
> fora), a seção 4 deste PRD. Este PRD é a visão consolidada; se ele divergir do schema,
> o erro provavelmente está aqui, não lá.
