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
    // Nome BASE do recipiente ("Pacote", "Saco", "Granel") — nunca embute peso
    // nem contagem de unidades. O rótulo completo mostrado ao usuário é montado
    // em código (rotuloFormato, src/lib/formato.ts): "{nome} {peso} kg · {un} un".
    // Isso evita a mesma embalagem aparecer com grafias diferentes em telas
    // diferentes (adendo PWA, tarefa 2) — antes, um formato podia ter "30 unid"
    // embutido no nome só na tela do PWA e o peso embutido só no Admin.
    nome: v.string(),
    pesoKg: v.number(), // 5.7 | 2 | 4 | 10 ; ignorado se pesoVariavel
    pesoVariavel: v.boolean(), // true = usuário digita o kg no lançamento
    // Quantas unidades físicas (pedras, potes) cabem num pacote deste formato —
    // só faz sentido pra formato de peso fixo. Ausente = o formato não tem uma
    // contagem de unidades que valha a pena mostrar (ex.: saco de escama por kg).
    unidadesPorPacote: v.optional(v.number()),
    // Estoque mínimo DESTE formato, na unidade natural dele: nº de pacotes no
    // formato normal, kg no de peso variável. 0 (ou ausente) = sem alerta.
    estoqueMinimo: v.optional(v.number()),
    ativo: v.boolean(),
  }).index("by_produto", ["produtoId"]),

  // Dados da empresa emissora do comprovante (correção "pacote prevalece,
  // quilo agrega", tarefa 7) — singleton: no máximo um registro nesta tabela,
  // criado/editado pelo Admin em Cadastros → Empresa. Guardado em tabela, não
  // em constante no código, para o mesmo sistema servir outro cliente sem
  // alteração de código. Todo campo é opcional porque o registro nasce vazio
  // (nenhum dado inventado); o comprovante omite qualquer linha vazia em vez
  // de mostrar espaço em branco ou placeholder.
  empresa: defineTable({
    razaoSocial: v.optional(v.string()),
    nomeFantasia: v.optional(v.string()),
    cnpj: v.optional(v.string()),
    inscricaoEstadual: v.optional(v.string()),
    endereco: v.optional(v.string()),
    telefone: v.optional(v.string()),
    whatsapp: v.optional(v.string()),
    email: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
  }),

  // Rastreio de convites de Admin (correção "quatro ajustes pontuais", tarefa
  // 1) — o Clerk é quem de fato manda o e-mail e guarda o convite, mas cada
  // reenvio cria um invitation NOVO lá (id diferente), então a data do
  // primeiro convite se perderia sem isto. `criadoEm` nunca muda; `ultimoEnvioEm`
  // avança a cada reenvio e é a base do rate limit (5 min) e da validade (7
  // dias) — ambos DERIVADOS na leitura, nunca um campo "expirado" cacheado.
  // Linha desaparece quando o convite é aceito (email passa a existir em
  // `usuarios`) ou revogado — não é histórico permanente, é só "o que está
  // pendente agora".
  convitesAdmin: defineTable({
    email: v.string(),
    clerkInvitationId: v.string(),
    criadoEm: v.number(),
    ultimoEnvioEm: v.number(),
  }).index("by_email", ["email"]),

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
    // Protocolo curto e legível em voz alta (adendo PWA, tarefa 4) — mostrado
    // no comprovante, na tela de sucesso e no histórico, com busca. Gerado no
    // servidor a partir de uma semente própria (nunca reaproveita
    // chaveIdempotencia direto: em estorno ela é "estorno:<id>" e em ajuste é
    // "ajuste:<contagem>:<item>" — nenhum dos dois é legível). Linhas do mesmo
    // carregamento (venda/patrocínio) ou do mesmo lote de ajuste compartilham
    // o protocolo do grupo — é um recibo só. Ausente = lançamento anterior a
    // esta tarefa; migrarProtocoloLegado (convex/migracoes.ts) preenche.
    protocolo: v.optional(v.string()),

    tipo: v.union(
      v.literal("producao"), // entrada
      v.literal("venda"), // saída
      v.literal("patrocinio"), // saída
      v.literal("retornoPatrocinio"), // entrada
      v.literal("perda"), // saída
      v.literal("ajuste"), // entrada ou saída — só via contagem aprovada
      v.literal("estorno"), // contra-lançamento que desfaz um erro — sinal invertido do original
      // Movimentação interna entre câmaras (correção Painel/Transferência,
      // tarefa 5) — sempre em PAR na mesma transação: uma perna de saída na
      // câmara de origem (sinal -1) e uma de entrada na câmara de destino
      // (sinal 1), compartilhando loteId e protocolo (mesmo mecanismo dos
      // ajustes em lote — ver loteId abaixo). NÃO é produção nem saída: os
      // indicadores de produção/saída e o Estoque total têm que ignorá-la
      // explicitamente (as duas pernas se cancelam por peso, mas cada uma
      // conta como movimento se algum indicador filtrar por sinal em vez de
      // por tipo).
      v.literal("transferencia"),
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
    // Estorno (tarefa 6): só existe no CONTRA-lançamento, apontando pro
    // original. DECISÃO: não existe campo "estornadoPor" no original — regra
    // arquitetural 2 proíbe patch em `movimentacoes`, sem exceção ("nenhum
    // ponto, nenhum perfil, nem admin"). "Este lançamento já foi estornado?"
    // é derivado em tempo de leitura pelo índice by_estorno_de (mesma lógica
    // de nunca cachear o que dá pra calcular — regra arquitetural 1).
    estornoDe: v.optional(v.id("movimentacoes")),

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
    .index("by_estorno_de", ["estornoDe"])
    .index("by_registrado_em", ["registradoEm"])
    .index("by_protocolo", ["protocolo"]),

  // Registro de que o comprovante de um carregamento (venda/patrocínio) foi
  // enviado por WhatsApp ou copiado (adendo PWA, tarefa 4). Tabela À PARTE de
  // `movimentacoes` — nunca um patch no lançamento (regra arquitetural 2:
  // append-only, sem exceção). "Este carregamento já foi compartilhado?" é
  // sempre esta leitura: existe algum registro para este carregamentoId?
  // Enquanto não existir, o Desfazer (5 min) continua disponível; a partir do
  // primeiro registro, some — mesma filosofia do estorno (by_estorno_de).
  carregamentosCompartilhados: defineTable({
    carregamentoId: v.string(),
    compartilhadoEm: v.number(),
  }).index("by_carregamento", ["carregamentoId"]),

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
