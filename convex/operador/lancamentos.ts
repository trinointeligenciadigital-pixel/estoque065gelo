import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { exigirSessaoOperador, exigirPermissao, exigirCamaraDoProduto } from "../lib/auth";
import { movimentacaoExistente } from "../lib/idempotencia";
import { derivarQtdPeso } from "../lib/movimentacao";
import { saldoDoFormato, validarSaldoLote, type LinhaLote } from "../lib/saldo";

/*
  Lançamentos do colaborador. Regras invioláveis aplicadas aqui:
  - sessão + permissão + câmara do produto conferidas antes de escrever (RF07)
  - `sinal` e `pesoKg` calculados no servidor (RF33)
  - idempotência: mesma chave não duplica (RF34)
  - saída nunca excede o saldo do formato (RF35); sem saldo negativo
  - append-only: só insert, nunca patch/delete em movimentacoes
*/

// Carrega o formato e confere que ele pertence ao produto informado.
async function formatoDoProduto(
  ctx: MutationCtx,
  formatoId: Id<"formatos">,
  produtoId: Id<"produtos">,
): Promise<Doc<"formatos">> {
  const formato = await ctx.db.get(formatoId);
  if (formato === null || formato.produtoId !== produtoId) {
    throw new ConvexError("Formato inválido para este produto.");
  }
  return formato;
}

// Peso líquido de um formato (usado só para validar saída de formato de peso
// variável, onde "quantidade" não representa o estoque físico).
async function pesoLiquidoDoFormato(
  ctx: MutationCtx,
  produtoId: Id<"produtos">,
  camaraId: Id<"camaras">,
  formatoId: Id<"formatos">,
): Promise<number> {
  const movs = await ctx.db
    .query("movimentacoes")
    .withIndex("by_produto_camara_formato", (q) =>
      q.eq("produtoId", produtoId).eq("camaraId", camaraId).eq("formatoId", formatoId),
    )
    .collect();
  return movs.reduce((acc, m) => acc + m.sinal * m.pesoKg, 0);
}

export const lancarProducao = mutation({
  args: {
    token: v.string(),
    chaveIdempotencia: v.string(),
    produtoId: v.id("produtos"),
    formatoId: v.id("formatos"),
    quantidade: v.optional(v.number()),
    pesoKgVariavel: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, args.token);
    exigirPermissao(operador, "producao");
    await exigirCamaraDoProduto(ctx, args.produtoId, camara._id);
    const formato = await formatoDoProduto(ctx, args.formatoId, args.produtoId);

    // Idempotência: se já existe, devolve sem inserir (RF34).
    const existente = await movimentacaoExistente(ctx, args.chaveIdempotencia);
    if (existente !== null) return { movimentacaoId: existente._id, duplicado: true };

    const { quantidade, pesoKg } = derivarQtdPeso(formato, args.quantidade, args.pesoKgVariavel);

    const movimentacaoId = await ctx.db.insert("movimentacoes", {
      chaveIdempotencia: args.chaveIdempotencia,
      tipo: "producao",
      sinal: 1,
      produtoId: args.produtoId,
      camaraId: camara._id,
      formatoId: args.formatoId,
      quantidade,
      pesoKg,
      registradoPorTipo: "operador",
      operadorId: operador._id,
      registradoEm: Date.now(),
    });
    return { movimentacaoId, duplicado: false };
  },
});

export const lancarSaida = mutation({
  args: {
    token: v.string(),
    chaveIdempotencia: v.string(),
    tipo: v.union(v.literal("venda"), v.literal("patrocinio"), v.literal("perda")),
    produtoId: v.id("produtos"),
    formatoId: v.id("formatos"),
    quantidade: v.optional(v.number()),
    pesoKgVariavel: v.optional(v.number()),
    // Contexto
    clienteNome: v.optional(v.string()),
    veiculoId: v.optional(v.id("veiculos")),
    veiculoTerceiro: v.optional(v.string()),
    motorista: v.optional(v.string()),
    motivoPerda: v.optional(
      v.union(v.literal("derreteu"), v.literal("danificado"), v.literal("descarte"), v.literal("outro")),
    ),
    observacao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, args.token);
    exigirPermissao(operador, "saida");
    await exigirCamaraDoProduto(ctx, args.produtoId, camara._id);
    const formato = await formatoDoProduto(ctx, args.formatoId, args.produtoId);

    // Validação de contexto por tipo.
    if (args.tipo === "venda" || args.tipo === "patrocinio") {
      if (!args.clienteNome || args.clienteNome.trim() === "") {
        throw new ConvexError("Informe o nome do cliente.");
      }
    } else {
      // perda
      if (!args.motivoPerda) {
        throw new ConvexError("Informe o motivo da perda.");
      }
      if (args.motivoPerda === "outro" && (!args.observacao || args.observacao.trim() === "")) {
        throw new ConvexError("Descreva o motivo da perda.");
      }
    }

    // Idempotência antes de qualquer efeito (RF34).
    const existente = await movimentacaoExistente(ctx, args.chaveIdempotencia);
    if (existente !== null) return { movimentacaoId: existente._id, duplicado: true };

    const { quantidade, pesoKg } = derivarQtdPeso(formato, args.quantidade, args.pesoKgVariavel);

    // Saldo insuficiente bloqueia (RF35). Nunca saldo negativo.
    const disponivel = formato.pesoVariavel
      ? await pesoLiquidoDoFormato(ctx, args.produtoId, camara._id, args.formatoId)
      : await saldoDoFormato(ctx, args.produtoId, camara._id, args.formatoId);
    const pedido = formato.pesoVariavel ? pesoKg : quantidade;
    if (pedido > disponivel) {
      throw new ConvexError("Saldo insuficiente nesta câmara — avise o Admin.");
    }

    const movimentacaoId = await ctx.db.insert("movimentacoes", {
      chaveIdempotencia: args.chaveIdempotencia,
      tipo: args.tipo,
      sinal: -1,
      produtoId: args.produtoId,
      camaraId: camara._id,
      formatoId: args.formatoId,
      quantidade,
      pesoKg,
      clienteNome:
        args.tipo === "perda" ? undefined : args.clienteNome?.trim() || undefined,
      veiculoId: args.tipo === "perda" ? undefined : args.veiculoId,
      veiculoTerceiro:
        args.tipo === "perda" ? undefined : args.veiculoTerceiro?.trim() || undefined,
      motorista: args.tipo === "perda" ? undefined : args.motorista?.trim() || undefined,
      motivoPerda: args.tipo === "perda" ? args.motivoPerda : undefined,
      observacao: args.observacao?.trim() || undefined,
      registradoPorTipo: "operador",
      operadorId: operador._id,
      registradoEm: Date.now(),
    });
    return { movimentacaoId, duplicado: false };
  },
});

// Saída de venda/patrocínio com VÁRIOS produtos no mesmo carregamento. Grava N
// linhas de uma vez, todas com o mesmo `carregamentoId` e o mesmo contexto
// (cliente/veículo/motorista). É atômica: ou o carregamento inteiro entra, ou
// nada — nenhuma linha grava se qualquer item estourar o saldo. Mesmas garantias
// do `lancarSaida` single, aplicadas a cada item. Perda não usa esta mutation.
export const lancarSaidaMultipla = mutation({
  args: {
    token: v.string(),
    carregamentoId: v.string(),
    tipo: v.union(v.literal("venda"), v.literal("patrocinio")),
    itens: v.array(
      v.object({
        chaveIdempotencia: v.string(),
        produtoId: v.id("produtos"),
        formatoId: v.id("formatos"),
        quantidade: v.optional(v.number()),
        pesoKgVariavel: v.optional(v.number()),
      }),
    ),
    clienteNome: v.string(),
    veiculoId: v.optional(v.id("veiculos")),
    veiculoTerceiro: v.optional(v.string()),
    motorista: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, args.token);
    exigirPermissao(operador, "saida");

    if (args.itens.length === 0) throw new ConvexError("Adicione ao menos um produto.");
    if (args.clienteNome.trim() === "") throw new ConvexError("Informe o nome do cliente.");

    // Idempotência do lote: se já existe qualquer linha com este carregamentoId, o
    // lote já rodou (a escrita é atômica) — devolve sem inserir de novo (RF34).
    const jaGravadas = await ctx.db
      .query("movimentacoes")
      .withIndex("by_carregamento", (q) => q.eq("carregamentoId", args.carregamentoId))
      .collect();
    if (jaGravadas.length > 0) {
      return { movimentacaoIds: jaGravadas.map((m) => m._id), duplicado: true };
    }

    // Valida cada item e deriva qtd/peso no servidor, sem gravar ainda.
    const linhas: LinhaLote[] = [];
    for (const item of args.itens) {
      await exigirCamaraDoProduto(ctx, item.produtoId, camara._id);
      const produto = await ctx.db.get(item.produtoId);
      if (produto === null) throw new ConvexError("Produto não encontrado.");
      const formato = await formatoDoProduto(ctx, item.formatoId, item.produtoId);
      const { quantidade, pesoKg } = derivarQtdPeso(formato, item.quantidade, item.pesoKgVariavel);
      linhas.push({
        produtoId: item.produtoId,
        camaraId: camara._id,
        formatoId: item.formatoId,
        formato,
        produtoNome: produto.nome,
        quantidade,
        pesoKg,
      });
    }

    // Saldo do lote inteiro, somando itens do mesmo formato (RF35).
    await validarSaldoLote(ctx, linhas);

    const cliente = args.clienteNome.trim() || undefined;
    const veiculoTerceiro = args.veiculoTerceiro?.trim() || undefined;
    const motorista = args.motorista?.trim() || undefined;

    const movimentacaoIds = [];
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const id = await ctx.db.insert("movimentacoes", {
        chaveIdempotencia: args.itens[i].chaveIdempotencia,
        carregamentoId: args.carregamentoId,
        tipo: args.tipo,
        sinal: -1,
        produtoId: linha.produtoId,
        camaraId: linha.camaraId,
        formatoId: linha.formatoId,
        quantidade: linha.quantidade,
        pesoKg: linha.pesoKg,
        clienteNome: cliente,
        veiculoId: args.veiculoId,
        veiculoTerceiro,
        motorista,
        registradoPorTipo: "operador",
        operadorId: operador._id,
        registradoEm: Date.now(),
      });
      movimentacaoIds.push(id);
    }
    return { movimentacaoIds, duplicado: false };
  },
});

export const lancarRetorno = mutation({
  args: {
    token: v.string(),
    chaveIdempotencia: v.string(),
    patrocinioOrigemId: v.id("movimentacoes"),
    quantidade: v.optional(v.number()),
    pesoKgVariavel: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, args.token);
    exigirPermissao(operador, "saida");

    const origem = await ctx.db.get(args.patrocinioOrigemId);
    if (
      origem === null ||
      origem.tipo !== "patrocinio" ||
      origem.camaraId !== camara._id
    ) {
      throw new ConvexError("Patrocínio de origem inválido.");
    }

    const existente = await movimentacaoExistente(ctx, args.chaveIdempotencia);
    if (existente !== null) return { movimentacaoId: existente._id, duplicado: true };

    // Produto, câmara e formato herdados da origem (RF40) — não vêm do cliente.
    const formato = await ctx.db.get(origem.formatoId);
    if (formato === null) throw new ConvexError("Formato do patrocínio não encontrado.");

    const { quantidade, pesoKg } = derivarQtdPeso(formato, args.quantidade, args.pesoKgVariavel);

    // Soma dos retornos não pode ultrapassar o que saiu no patrocínio (RF41).
    const retornos = await ctx.db
      .query("movimentacoes")
      .withIndex("by_patrocinio_origem", (q) => q.eq("patrocinioOrigemId", origem._id))
      .collect();
    const porPeso = formato.pesoVariavel;
    const retornado = retornos.reduce((acc, r) => acc + (porPeso ? r.pesoKg : r.quantidade), 0);
    const saido = porPeso ? origem.pesoKg : origem.quantidade;
    const novo = porPeso ? pesoKg : quantidade;
    if (retornado + novo > saido) {
      throw new ConvexError("Retorno maior do que o que saiu neste patrocínio.");
    }

    const movimentacaoId = await ctx.db.insert("movimentacoes", {
      chaveIdempotencia: args.chaveIdempotencia,
      tipo: "retornoPatrocinio",
      sinal: 1,
      produtoId: origem.produtoId,
      camaraId: origem.camaraId,
      formatoId: origem.formatoId,
      quantidade,
      pesoKg,
      clienteNome: origem.clienteNome,
      patrocinioOrigemId: origem._id,
      registradoPorTipo: "operador",
      operadorId: operador._id,
      registradoEm: Date.now(),
    });
    return { movimentacaoId, duplicado: false };
  },
});
