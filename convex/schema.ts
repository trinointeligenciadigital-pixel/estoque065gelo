import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Estoque 065 — modelagem de dados. Fonte de verdade: docs/02-schema-convex.md.
// Transcrito exatamente do documento: nenhum campo a mais, nenhum a menos.
// Princípio inviolável: NÃO existe campo `saldo`. Todo saldo é somado do ledger
// (movimentacoes) em tempo de leitura. `movimentacoes` é append-only.
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
    whatsapp: v.optional(v.string()), // número para envio do PIN (opcional)
    pinHash: v.string(), // nunca o PIN em texto puro
    camarasPermitidas: v.array(v.id("camaras")),
    podeLancarProducao: v.boolean(),
    podeLancarSaida: v.boolean(),
    podeContar: v.boolean(),
    tentativasFalhas: v.number(), // rate limit
    bloqueadoAte: v.optional(v.number()),
    ativo: v.boolean(),
  }).index("by_ativo", ["ativo"]),

  sessoesOperador: defineTable({
    operadorId: v.id("operadores"),
    camaraId: v.id("camaras"), // sessão presa a UMA câmara
    token: v.string(),
    expiraEm: v.number(), // timestamp; 12h a partir da emissão
  })
    .index("by_token", ["token"])
    .index("by_expira_em", ["expiraEm"])
    .index("by_operador_id", ["operadorId"]), // necessário para invalidar
  //                                             todas as sessões de um operador
  //                                             quando o Admin gera um novo PIN

  // ---------------------------------------------------------------
  // Cadastros
  // ---------------------------------------------------------------

  camaras: defineTable({
    nome: v.string(), // "Câmara Saborizado", "Câmara Cubo/Escamado"
    qrToken: v.string(), // valor codificado no QR da porta
    ativo: v.boolean(),
    // Rate limit de PIN por câmara (RF08). Como o PIN errado não identifica o
    // colaborador, o bloqueio anti-tentativa é do teclado daquela câmara.
    tentativasFalhas: v.optional(v.number()),
    bloqueadoAte: v.optional(v.number()),
  })
    .index("by_qr_token", ["qrToken"])
    .index("by_ativo", ["ativo"]),

  // Cada SABOR é um produto. Cada produto vive em UMA câmara.
  produtos: defineTable({
    nome: v.string(), // "Morango", "Uva", "Cubo", "Escamado"
    categoria: v.union(
      v.literal("saborizado"),
      v.literal("cubo"),
      v.literal("escamado"),
    ),
    camaraId: v.id("camaras"),
    unidadeBase: v.union(v.literal("pacote"), v.literal("kg")),
    // OBS: o estoque mínimo NÃO vive aqui — vive no FORMATO (por tamanho de pacote),
    // porque a 065 controla o mínimo por tamanho (cubo 2kg ≠ cubo 4kg) e somar
    // pacotes de tamanhos diferentes violaria a regra de agregação por peso.
    ativo: v.boolean(),
  })
    .index("by_camara", ["camaraId"])
    .index("by_categoria", ["categoria"])
    .index("by_ativo", ["ativo"]),

  // Formato unifica saborizado e cubo/escamado num só caminho.
  formatos: defineTable({
    produtoId: v.id("produtos"),
    nome: v.string(), // "Pacote 30 pedras", "Saco 2kg", "Granel"
    pesoKg: v.number(), // 5.7 | 2 | 4 | 10 ; ignorado se pesoVariavel
    pesoVariavel: v.boolean(), // true = usuário digita o kg no lançamento
    // Estoque mínimo DESTE formato, na unidade natural dele: nº de pacotes no
    // formato normal, kg no de peso variável. 0 (ou ausente) = sem alerta.
    estoqueMinimo: v.optional(v.number()),
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
      v.literal("producao"), // entrada
      v.literal("venda"), // saída
      v.literal("patrocinio"), // saída
      v.literal("retornoPatrocinio"), // entrada
      v.literal("perda"), // saída
      v.literal("ajuste"), // entrada ou saída — só via contagem aprovada
    ),
    sinal: v.union(v.literal(1), v.literal(-1)),

    produtoId: v.id("produtos"),
    camaraId: v.id("camaras"), // desnormalizado do produto: o saldo é por câmara
    formatoId: v.id("formatos"),
    quantidade: v.number(), // nº de pacotes/sacos (sempre positivo)
    pesoKg: v.number(), // derivado; guardado para relatório

    // Contexto por tipo
    clienteNome: v.optional(v.string()), // venda, patrocínio — texto livre
    veiculoId: v.optional(v.id("veiculos")), // veículo próprio
    veiculoTerceiro: v.optional(v.string()), // terceiro — texto livre
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
    contagemId: v.optional(v.id("contagens")), // ajuste → contagem aprovada
    carregamentoId: v.optional(v.string()), // agrupa as linhas de uma mesma saída
    // (venda/patrocínio) num carregamento. UUID do cliente. NÃO é agregação: cada
    // produto+formato segue sendo uma linha; o carregamento só as vincula.
    // Agrupa os ajustes de uma mesma aprovação de contagem (ou, fora de contagem,
    // qualquer operação que grave vários lançamentos juntos). Todo ajuste gerado
    // por gerarAjustesDaContagem ganha o mesmo loteId. `loteInferido: true` marca
    // lotes reconstruídos por migração (heurística por segundo+autor+câmara, sem
    // contagemId — não dá pra provar o vínculo de um lote legado).
    loteId: v.optional(v.string()),
    loteInferido: v.optional(v.boolean()),

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
    .index("by_produto_camara_formato", ["produtoId", "camaraId", "formatoId"])
    .index("by_camara", ["camaraId"])
    .index("by_tipo", ["tipo"])
    .index("by_patrocinio_origem", ["patrocinioOrigemId"])
    .index("by_carregamento", ["carregamentoId"])
    .index("by_contagem", ["contagemId"])
    .index("by_lote", ["loteId"])
    .index("by_registrado_em", ["registradoEm"]),

  // ---------------------------------------------------------------
  // Contagem física — gera divergência, nunca ajuste automático
  // ---------------------------------------------------------------

  contagens: defineTable({
    camaraId: v.id("camaras"),
    status: v.union(
      v.literal("aberta"), // em andamento
      v.literal("pendente"), // fechada, aguardando Admin
      v.literal("aprovada"), // ajustes gerados no ledger
      v.literal("rejeitada"), // descartada após decisão; nada entra no ledger
      v.literal("cancelada"), // aberta e nunca finalizada; descartada, libera a câmara
    ),
    abertaPorTipo: v.union(v.literal("operador"), v.literal("admin")),
    operadorId: v.optional(v.id("operadores")),
    abertaPorClerkId: v.optional(v.string()),
    fechadaEm: v.optional(v.number()),
    decididaPorClerkId: v.optional(v.string()), // sempre um Admin
    decididaEm: v.optional(v.number()),
    observacaoDecisao: v.optional(v.string()),
  })
    .index("by_camara", ["camaraId"])
    .index("by_status", ["status"]),

  // Por FORMATO, não por produto agregado.
  contagemItens: defineTable({
    contagemId: v.id("contagens"),
    produtoId: v.id("produtos"),
    formatoId: v.id("formatos"),
    saldoSistema: v.number(), // snapshot no fechamento — congela a foto
    saldoContado: v.number(),
    divergencia: v.number(), // contado − sistema
  })
    .index("by_contagem", ["contagemId"])
    .index("by_produto_formato", ["produtoId", "formatoId"]),
});
