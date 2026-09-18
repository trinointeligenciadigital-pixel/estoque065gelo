# Estoque 065 — Modelagem de Dados (Convex)

**Versão:** 2.1 · Substitui a 2.0

**Mudanças desta revisão:**
- `contagemItens` passa a registrar por `produtoId + formatoId`, não só por produto agregado
- Novo índice `by_produto_camara_formato` em `movimentacoes` — saldo agora é calculado por formato
- Nova função `saldoDoFormato`, substituindo `saldoDoProduto` como fonte de verdade para saldo consultável e validável
- `sessoesOperador` ganha índice `by_operador_id`, necessário para invalidar sessões ao gerar novo PIN
- Documentada a regra de transferência de câmara (não implementada no v1)
- Confirmado: PIN individual por operador já estava correto na v2.0 e permanece

---

## Princípio estrutural

**O estoque nunca é um campo salvo.** Não existe `saldo` em lugar nenhum deste schema. Todo saldo é calculado somando `movimentacoes` filtradas por `produtoId + camaraId + formatoId`. A tabela `movimentacoes` é **append-only**: nada é editado, nada é deletado. Correção se faz com uma nova movimentação de `ajuste`, nunca alterando o passado.

Se em algum momento da implementação aparecer um campo `saldo`, um `ctx.db.patch` numa movimentação, ou um `ctx.db.patch` em `produtos.camaraId`, a arquitetura foi violada.

---

## `convex/schema.ts`

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ---------------------------------------------------------------
  // Identidade
  // ---------------------------------------------------------------

  usuarios: defineTable({
    clerkId: v.string(),
    nome: v.string(),
    email: v.string(),
    papel: v.literal("admin"),
    ativo: v.boolean(),
  }).index("by_clerk_id", ["clerkId"]),

  operadores: defineTable({
    nome: v.string(),
    pinHash: v.string(),              // nunca o PIN em texto puro
    camarasPermitidas: v.array(v.id("camaras")),
    podeLancarProducao: v.boolean(),
    podeLancarSaida: v.boolean(),
    podeContar: v.boolean(),
    tentativasFalhas: v.number(),     // rate limit
    bloqueadoAte: v.optional(v.number()),
    ativo: v.boolean(),
  }).index("by_ativo", ["ativo"]),

  sessoesOperador: defineTable({
    operadorId: v.id("operadores"),
    camaraId: v.id("camaras"),        // sessão presa a UMA câmara
    token: v.string(),
    expiraEm: v.number(),             // timestamp; 12h a partir da emissão
  })
    .index("by_token", ["token"])
    .index("by_expira_em", ["expiraEm"])
    .index("by_operador_id", ["operadorId"]), // NOVO — necessário para invalidar
                                               // todas as sessões de um operador
                                               // quando o Admin gera um novo PIN

  // ---------------------------------------------------------------
  // Cadastros
  // ---------------------------------------------------------------

  camaras: defineTable({
    nome: v.string(),                 // "Câmara Saborizado", "Câmara Cubo/Escamado"
    qrToken: v.string(),              // valor codificado no QR da porta
    ativo: v.boolean(),
  })
    .index("by_qr_token", ["qrToken"])
    .index("by_ativo", ["ativo"]),

  // Cada SABOR é um produto. Cada produto vive em UMA câmara.
  // Vínculo produto→câmara é definido no cadastro, sugerido pela categoria:
  // saborizado → câmara própria de saborizado
  // cubo, escamado → mesma câmara compartilhada (decisão do cliente)
  // O campo em si é sempre um único camaraId — nunca compartilhado a nível de
  // schema; o "compartilhamento" é só o fato de dois produtos apontarem para
  // a mesma câmara, o que o schema já suporta sem alteração nenhuma.
  produtos: defineTable({
    nome: v.string(),                 // "Morango", "Uva", "Cubo", "Escamado"
    categoria: v.union(
      v.literal("saborizado"),
      v.literal("cubo"),
      v.literal("escamado"),
    ),
    camaraId: v.id("camaras"),
    unidadeBase: v.union(v.literal("pacote"), v.literal("kg")),
    estoqueMinimo: v.number(),        // na unidade base; 0 = sem alerta
    ativo: v.boolean(),
  })
    .index("by_camara", ["camaraId"])
    .index("by_categoria", ["categoria"])
    .index("by_ativo", ["ativo"]),

  // Formato unifica saborizado e cubo/escamado num só caminho:
  // pacote de 30 pedras = formato de 5,7kg, igual saco de 2kg = formato de 2kg.
  formatos: defineTable({
    produtoId: v.id("produtos"),
    nome: v.string(),                 // "Pacote 30 pedras", "Saco 2kg", "Granel"
    pesoKg: v.number(),               // 5.7 | 2 | 4 | 10 ; ignorado se pesoVariavel
    pesoVariavel: v.boolean(),        // true = usuário digita o kg no lançamento
    // "pacote" (padrão) ou "unidade" (contagem direta, sem embalagem — ex.:
    // gelo saborizado vendido por peça). Ausente = "pacote". Fixado na
    // criação, nunca editável depois — mudar isto num formato com
    // movimentações misturaria duas unidades diferentes na mesma soma de
    // saldoDoFormato (migração pacote→unidade do saborizado).
    unidadeContagem: v.optional(v.union(v.literal("pacote"), v.literal("unidade"))),
    ativo: v.boolean(),
  }).index("by_produto", ["produtoId"]),

  veiculos: defineTable({
    placa: v.string(),
    modelo: v.optional(v.string()),
    motoristaPadrao: v.optional(v.string()),
    ativo: v.boolean(),
  })
    .index("by_placa", ["placa"])
    .index("by_ativo", ["ativo"]),

  // ---------------------------------------------------------------
  // Ledger — append-only, nunca editado
  // ---------------------------------------------------------------

  movimentacoes: defineTable({
    // Idempotência: UUID gerado no cliente. Protege contra duplo-toque e retry.
    chaveIdempotencia: v.string(),

    tipo: v.union(
      v.literal("producao"),           // entrada
      v.literal("venda"),              // saída
      v.literal("patrocinio"),         // saída
      v.literal("retornoPatrocinio"),  // entrada
      v.literal("perda"),              // saída
      v.literal("ajuste"),             // entrada ou saída — só via contagem aprovada
      v.literal("estorno"),            // contra-lançamento que desfaz um erro — sinal invertido
    ),
    sinal: v.union(v.literal(1), v.literal(-1)),

    produtoId: v.id("produtos"),
    camaraId: v.id("camaras"),         // desnormalizado do produto: o saldo é por câmara
    formatoId: v.id("formatos"),
    quantidade: v.number(),            // nº de pacotes/sacos (sempre positivo)
    pesoKg: v.number(),                // derivado; guardado para relatório

    // Contexto por tipo
    clienteNome: v.optional(v.string()),        // venda, patrocínio — texto livre
    veiculoId: v.optional(v.id("veiculos")),    // veículo próprio
    veiculoTerceiro: v.optional(v.string()),    // terceiro — texto livre
    motorista: v.optional(v.string()),
    motivoPerda: v.optional(
      v.union(
        v.literal("derreteu"),
        v.literal("danificado"),
        v.literal("descarte"),
        v.literal("outro"),
      ),
    ),
    observacao: v.optional(v.string()), // obrigatório em código quando motivoPerda === "outro"

    // Motivo do ajuste (RF55: ajuste só nasce da aprovação de contagem — não há
    // mutation pública que crie "ajuste", então a categoria é sempre "contagem",
    // preenchida automaticamente lá. "nao_informado" é só da migração de legados
    // (convex/migracoes.ts) — nenhum código de escrita normal grava esse valor.
    motivoCategoria: v.optional(
      v.union(
        v.literal("contagem"),
        v.literal("quebra"),
        v.literal("derretimento"),
        v.literal("erro_lancamento"),
        v.literal("outro"),
        v.literal("nao_informado"),
      ),
    ),
    motivoTexto: v.optional(v.string()), // obrigatório em código quando motivoCategoria === "outro"

    // Vínculos
    patrocinioOrigemId: v.optional(v.id("movimentacoes")), // retorno → patrocínio
    contagemId: v.optional(v.id("contagens")),             // ajuste → contagem aprovada
    carregamentoId: v.optional(v.string()),                // agrupa as linhas de uma
                                                           // mesma saída (venda/patrocínio)
                                                           // num carregamento. Vínculo, não
                                                           // agregação — cada produto+formato
                                                           // segue sendo uma linha do ledger.
    loteId: v.optional(v.string()),                        // agrupa os ajustes de uma
    loteInferido: v.optional(v.boolean()),                 // mesma aprovação de contagem
                                                           // (loteInferido=true nos lotes
                                                           // reconstruídos por migração)
    estornoDe: v.optional(v.id("movimentacoes")),          // no CONTRA-lançamento → original.
                                                           // Não existe "estornadoPor" no
                                                           // original — regra 2 proíbe patch
                                                           // em movimentacoes; "já foi
                                                           // estornado?" é derivado via
                                                           // by_estorno_de em tempo de leitura.

    // Autoria
    registradoPorTipo: v.union(v.literal("operador"), v.literal("admin")),
    operadorId: v.optional(v.id("operadores")),
    clerkId: v.optional(v.string()),
    // Nome de quem registrou, no momento do lançamento (SNAPSHOT — se a pessoa
    // for renomeada depois, o histórico não muda). Ausente = legado anterior à
    // sprint de auditoria; migrarAutorLegado (convex/migracoes.ts) preenche.
    autorNome: v.optional(v.string()),
    registradoEm: v.number(),
  })
    .index("by_chave_idempotencia", ["chaveIdempotencia"])
    .index("by_produto_camara", ["produtoId", "camaraId"])
    .index("by_produto_camara_formato", ["produtoId", "camaraId", "formatoId"]) // NOVO
    .index("by_camara", ["camaraId"])
    .index("by_tipo", ["tipo"])
    .index("by_patrocinio_origem", ["patrocinioOrigemId"])
    .index("by_carregamento", ["carregamentoId"])
    .index("by_contagem", ["contagemId"])
    .index("by_lote", ["loteId"])
    .index("by_estorno_de", ["estornoDe"])
    .index("by_registrado_em", ["registradoEm"]),

  // ---------------------------------------------------------------
  // Contagem física — gera divergência, nunca ajuste automático
  // ---------------------------------------------------------------

  contagens: defineTable({
    camaraId: v.id("camaras"),
    status: v.union(
      v.literal("aberta"),      // em andamento
      v.literal("pendente"),    // fechada, aguardando Admin
      v.literal("aprovada"),    // ajustes gerados no ledger
      v.literal("rejeitada"),   // descartada após decisão; nada entra no ledger
      v.literal("cancelada"),   // aberta e nunca finalizada; descartada, libera a câmara
    ),
    abertaPorTipo: v.union(v.literal("operador"), v.literal("admin")),
    operadorId: v.optional(v.id("operadores")),
    abertaPorClerkId: v.optional(v.string()),
    fechadaEm: v.optional(v.number()),
    decididaPorClerkId: v.optional(v.string()),  // sempre um Admin
    decididaEm: v.optional(v.number()),
    observacaoDecisao: v.optional(v.string()),
  })
    .index("by_camara", ["camaraId"])
    .index("by_status", ["status"]),

  // Por FORMATO, não por produto agregado — necessário porque um produto pode
  // ter mais de um formato (ex: saco 2kg e saco 5kg), e agregar a contagem por
  // produto misturaria unidades diferentes no cálculo de divergência.
  contagemItens: defineTable({
    contagemId: v.id("contagens"),
    produtoId: v.id("produtos"),
    formatoId: v.id("formatos"),  // NOVO
    saldoSistema: v.number(),     // snapshot no fechamento — congela a foto
    saldoContado: v.number(),
    divergencia: v.number(),      // contado − sistema
  })
    .index("by_contagem", ["contagemId"])
    .index("by_produto_formato", ["produtoId", "formatoId"]), // NOVO
});
```

---

## Regras de negócio que o schema não expressa

Precisam virar código nas functions:

1. **`sinal` é derivado de `tipo`, nunca vem do cliente.**
   `producao`, `retornoPatrocinio` → `+1` · `venda`, `patrocinio`, `perda` → `-1` · `ajuste` → sinal da divergência.
   Guardar o sinal torna o cálculo de saldo uma soma simples, mas ele é calculado no servidor.

2. **`pesoKg` é derivado, nunca vem do cliente.**
   `quantidade × formato.pesoKg`. Se `formato.pesoVariavel`, o cliente informa o peso e `quantidade = 1`.

3. **`camaraId` vem do produto, não do cliente.** Desnormalizado só para indexar; a fonte é `produtos.camaraId`.

4. **Saída não pode exceder o saldo do formato.** Mutation calcula `saldoDoFormato` do formato específico sendo baixado e rejeita: *"saldo insuficiente nesta câmara — avise o Admin."* Sem saldo negativo em hipótese alguma.

5. **`retornoPatrocinio` valida o acumulado.** A soma dos retornos de um patrocínio não pode ultrapassar a quantidade que saiu nele. E o retorno herda o produto e o formato do patrocínio de origem.

6. **A movimentação valida a câmara da sessão.** Toda mutation operacional confere que `produto.camaraId === sessao.camaraId` antes de escrever. Um operador com sessão na Câmara Saborizado não lança nada na Câmara Cubo/Escamado, mesmo que forje o `produtoId`.

7. **Idempotência.** Antes de inserir, busca por `by_chave_idempotencia`. Se já existe, devolve o registro existente e **não insere** — sem erro, sem duplicata.

8. **Uma contagem aberta por câmara.** Rejeitar abertura se já houver `aberta` ou `pendente` naquela câmara.

9. **Aprovação de contagem é exclusiva do Admin**, e não pode ser quem abriu a contagem — validar `decididaPorClerkId !== abertaPorClerkId` (ou, se `abertaPorTipo === "admin"`, que o Admin decisor seja diferente do Admin que abriu).

10. **Nunca `patch` nem `delete` em `movimentacoes`.** Cadastros usam a flag `ativo`; produto com movimentação jamais é deletado.

11. **Nunca `patch` em `produtos.camaraId` depois de criado.** Ver seção "Transferência de câmara — não implementada" abaixo. Se essa necessidade aparecer, é projeto próprio, não um edit de campo.

12. **Carregamento é vínculo, nunca agregação.** Venda e patrocínio podem sair com
    vários produtos num mesmo carregamento. Cada produto+formato continua sendo **uma
    linha** do ledger; o `carregamentoId` (UUID gerado no cliente) só as vincula. A
    mutation de lote (`lancarSaidaMultipla`) grava todas as linhas numa transação
    (tudo ou nada), valida o saldo **por formato somando os pedidos repetidos** do mesmo
    formato dentro do carregamento, e usa a existência de qualquer linha com aquele
    `carregamentoId` como chave de idempotência do lote. Perda e retorno seguem
    um item por vez. Saldo continua somado por formato — nada é agregado no carregamento.

13. **Geração de PIN invalida sessões existentes.** A mutation `gerarPinOperador` deve, na mesma transação: gerar o PIN, salvar o hash, e deletar todas as linhas de `sessoesOperador` daquele `operadorId` (via `by_operador_id`). O PIN em texto puro é retornado uma única vez, só para quem chamou a mutation (Admin autenticado); nunca é persistido em texto puro.

14. **Estorno corrige sem patch no original (regra 10 continua valendo, sem exceção).**
    `estornarLancamento` (só Admin) grava um NOVO lançamento `tipo: "estorno"`, mesmo
    produto/formato/quantidade do original, sinal invertido, `estornoDe` apontando pro
    original — nunca `ctx.db.patch` no original. "Este lançamento já foi estornado?" é
    sempre uma leitura pelo índice `by_estorno_de` (existe uma movimentação com
    `estornoDe === este._id`?), nunca um campo cacheado. Bloqueios: não estornar
    lançamento anterior à contagem aprovada mais recente daquela câmara (o saldo já foi
    reconciliado — RF55 continua sendo a única origem de ajuste), não estornar um
    estorno, não estornar um ajuste (a correção de ajuste é rejeitar a contagem).

---

## Autorização

O Convex **não tem RLS**. Tudo abaixo é código dentro de cada query e mutation.

```
usuarios
  - leitura: o próprio, via by_clerk_id
  - escrita: só pela mutation interna garantirUsuario (primeiro login)

camaras, produtos, formatos, veiculos, operadores
  - leitura: admin (Clerk) — completa
  - leitura: operador (token de sessão) — apenas os da própria câmara da sessão
  - escrita: só admin
  - operadores.pinHash: nunca sai do backend, em nenhuma query
  - produtos.camaraId: definido na criação; edição posterior bloqueada em código
    (ver regra 11) — se necessário no futuro, exige nova function dedicada,
    não um update genérico de cadastro

sessoesOperador
  - criada só pela mutation de login por PIN (valida hash + rate limit)
  - nunca lida pelo cliente; validada internamente por token
  - cron diário remove as expiradas
  - deletada em massa (by_operador_id) sempre que o Admin gera um novo PIN
    para aquele operador

movimentacoes
  - leitura: admin — tudo. Operador — só a própria câmara, só as suas, só as últimas 24h
  - escrita: admin, ou operador com sessão válida + permissão do tipo + câmara conferida
  - update/delete: NUNCA, para ninguém, inclusive admin

contagens / contagemItens
  - criar/fechar: admin, ou operador com podeContar na câmara da sessão
  - aprovar/rejeitar: SÓ admin, e não o mesmo usuário que abriu
  - a aprovação é a única origem de movimentação tipo "ajuste"
```

---

## Cálculo de saldo

```ts
// convex/lib/saldo.ts

// Fonte de verdade para saldo consultável, validável em saída, e usado na
// comparação de contagem física. Sempre por formato — nunca agrega
// quantidade de formatos diferentes, porque "quantidade" não é uma unidade
// comparável entre um saco de 2kg e um saco de 5kg.
export async function saldoDoFormato(ctx, produtoId, camaraId, formatoId) {
  const movs = await ctx.db
    .query("movimentacoes")
    .withIndex("by_produto_camara_formato", (q) =>
      q.eq("produtoId", produtoId).eq("camaraId", camaraId).eq("formatoId", formatoId),
    )
    .collect();

  return movs.reduce((acc, m) => acc + m.sinal * m.quantidade, 0);
}

// Para o painel (saldo do produto/sabor agregando todos os formatos) —
// agrega por PESO, que é a unidade comparável entre formatos diferentes.
// Nunca soma "quantidade" de formatos distintos.
export async function pesoTotalDoProduto(ctx, produtoId, camaraId) {
  const movs = await ctx.db
    .query("movimentacoes")
    .withIndex("by_produto_camara", (q) =>
      q.eq("produtoId", produtoId).eq("camaraId", camaraId),
    )
    .collect();

  return movs.reduce((acc, m) => acc + m.sinal * m.pesoKg, 0);
}
```

**Nota de escala:** somar o ledger inteiro a cada leitura é correto e é o certo para o v1 — a 065 Gelo não gera volume que justifique otimização. Quando o histórico passar de ~100k movimentações por produto, a solução **não** é criar um campo `saldo`; é uma tabela de snapshot periódico (`saldosFechados` por produto/formato/câmara/data) somando só o delta desde o último fechamento. O ledger continua sendo a verdade. Registrar como item de v2, não implementar agora.

---

## Transferência de câmara — não implementada no v1

`produtos.camaraId` é definido na criação e não deve ser editado depois. Como o saldo é sempre `soma do ledger por produtoId + camaraId + formatoId`, um `patch` direto nesse campo faria o histórico de movimentações antigas "sumir" do cálculo de saldo (elas ficariam presas ao `camaraId` antigo, enquanto a consulta passaria a usar o novo). Nada se perde fisicamente, mas o sistema passaria a mentir sobre o saldo.

Não implementado porque o vínculo produto↔câmara já é definido por categoria e não há expectativa de mudança (ver PRD, seção 8.1). Se a necessidade aparecer: criar um tipo de movimentação `transferenciaCamara` que gera saída na câmara de origem e entrada na câmara de destino, preservando o ledger. Não resolver com um patch de cadastro.
