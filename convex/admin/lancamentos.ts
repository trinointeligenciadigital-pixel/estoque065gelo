import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { exigirAdmin } from "../lib/auth";
import { movimentacaoExistente } from "../lib/idempotencia";
import { derivarQtdPeso } from "../lib/movimentacao";
import { saldoDoFormato, pesoLiquidoDoFormato, validarSaldoLote, type LinhaLote } from "../lib/saldo";
import { protocoloDe, proximoNumeroComprovante } from "../lib/protocolo";
import { veiculoTerceiroValidado } from "../lib/placa";

/*
  Lançamento manual pelo Admin (RF63). MESMAS regras do colaborador: saldo,
  idempotência, imutabilidade, sinal/pesoKg no servidor. O Admin não tem atalho
  para furar regra. A câmara vem do próprio produto (o Admin enxerga todas as
  câmaras; não há barreira de sessão como no operador).
*/

async function produtoEFormato(
  ctx: MutationCtx,
  produtoId: Id<"produtos">,
  formatoId: Id<"formatos">,
): Promise<{ produto: Doc<"produtos">; formato: Doc<"formatos"> }> {
  const produto = await ctx.db.get(produtoId);
  if (produto === null) throw new ConvexError("Produto não encontrado.");
  const formato = await ctx.db.get(formatoId);
  if (formato === null || formato.produtoId !== produtoId) {
    throw new ConvexError("Formato inválido para este produto.");
  }
  return { produto, formato };
}

// Produtos ativos com câmara e formatos ativos, para o formulário de lançamento.
export const produtosParaLancamento = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    const camaras = await ctx.db.query("camaras").collect();
    const nomeCamara = new Map(camaras.map((c) => [c._id, c.nome]));

    const produtos = await ctx.db.query("produtos").collect();
    const ativos = produtos.filter((p) => p.ativo);
    return await Promise.all(
      ativos.map(async (p) => {
        const formatos = await ctx.db
          .query("formatos")
          .withIndex("by_produto", (q) => q.eq("produtoId", p._id))
          .collect();
        return {
          _id: p._id,
          nome: p.nome,
          categoria: p.categoria,
          camaraNome: nomeCamara.get(p.camaraId) ?? "—",
          formatos: formatos
            .filter((f) => f.ativo)
            .map((f) => ({
              _id: f._id,
              nome: f.nome,
              pesoKg: f.pesoKg,
              pesoVariavel: f.pesoVariavel,
              unidadesPorPacote: f.unidadesPorPacote ?? null,
            })),
        };
      }),
    );
  },
});

export const lancarProducao = mutation({
  args: {
    chaveIdempotencia: v.string(),
    produtoId: v.id("produtos"),
    formatoId: v.id("formatos"),
    quantidade: v.optional(v.number()),
    pesoKgVariavel: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const usuario = await exigirAdmin(ctx);
    const { produto, formato } = await produtoEFormato(ctx, args.produtoId, args.formatoId);

    const existente = await movimentacaoExistente(ctx, args.chaveIdempotencia);
    if (existente !== null) {
      return { movimentacaoId: existente._id, duplicado: true, protocolo: existente.protocolo ?? protocoloDe(args.chaveIdempotencia) };
    }

    const { quantidade, pesoKg } = derivarQtdPeso(formato, args.quantidade, args.pesoKgVariavel);
    const protocolo = protocoloDe(args.chaveIdempotencia);

    const movimentacaoId = await ctx.db.insert("movimentacoes", {
      chaveIdempotencia: args.chaveIdempotencia,
      protocolo,
      tipo: "producao",
      sinal: 1,
      produtoId: args.produtoId,
      camaraId: produto.camaraId,
      formatoId: args.formatoId,
      quantidade,
      pesoKg,
      registradoPorTipo: "admin",
      clerkId: usuario.clerkId,
      autorNome: usuario.nome,
      registradoEm: Date.now(),
    });
    return { movimentacaoId, duplicado: false, protocolo };
  },
});

export const lancarSaida = mutation({
  args: {
    chaveIdempotencia: v.string(),
    tipo: v.union(v.literal("venda"), v.literal("patrocinio"), v.literal("perda")),
    produtoId: v.id("produtos"),
    formatoId: v.id("formatos"),
    quantidade: v.optional(v.number()),
    pesoKgVariavel: v.optional(v.number()),
    clienteNome: v.optional(v.string()),
    veiculoId: v.optional(v.id("veiculos")),
    veiculoTerceiro: v.optional(v.string()),
    veiculoTerceiroModelo: v.optional(v.string()),
    motorista: v.optional(v.string()),
    motivoPerda: v.optional(
      v.union(v.literal("derreteu"), v.literal("danificado"), v.literal("descarte"), v.literal("outro")),
    ),
    observacao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const usuario = await exigirAdmin(ctx);
    const { produto, formato } = await produtoEFormato(ctx, args.produtoId, args.formatoId);

    if (args.tipo === "venda" || args.tipo === "patrocinio") {
      if (!args.clienteNome || args.clienteNome.trim() === "") {
        throw new ConvexError("Informe o nome do cliente.");
      }
    } else {
      if (!args.motivoPerda) throw new ConvexError("Informe o motivo da perda.");
      if (args.motivoPerda === "outro" && (!args.observacao || args.observacao.trim() === "")) {
        throw new ConvexError("Descreva o motivo da perda.");
      }
    }

    const veiculoTerceiro = veiculoTerceiroValidado(args.tipo !== "perda", args.veiculoTerceiro, args.veiculoTerceiroModelo);

    const existente = await movimentacaoExistente(ctx, args.chaveIdempotencia);
    if (existente !== null) {
      return { movimentacaoId: existente._id, duplicado: true, protocolo: existente.protocolo ?? protocoloDe(args.chaveIdempotencia) };
    }

    const { quantidade, pesoKg } = derivarQtdPeso(formato, args.quantidade, args.pesoKgVariavel);

    const disponivel = formato.pesoVariavel
      ? await pesoLiquidoDoFormato(ctx, args.produtoId, produto.camaraId, args.formatoId)
      : await saldoDoFormato(ctx, args.produtoId, produto.camaraId, args.formatoId);
    const pedido = formato.pesoVariavel ? pesoKg : quantidade;
    if (pedido > disponivel) {
      throw new ConvexError("Saldo insuficiente nesta câmara.");
    }

    const protocolo = protocoloDe(args.chaveIdempotencia);
    const movimentacaoId = await ctx.db.insert("movimentacoes", {
      chaveIdempotencia: args.chaveIdempotencia,
      protocolo,
      tipo: args.tipo,
      sinal: -1,
      produtoId: args.produtoId,
      camaraId: produto.camaraId,
      formatoId: args.formatoId,
      quantidade,
      pesoKg,
      clienteNome: args.tipo === "perda" ? undefined : args.clienteNome?.trim() || undefined,
      veiculoId: args.tipo === "perda" ? undefined : args.veiculoId,
      veiculoTerceiro: veiculoTerceiro.veiculoTerceiro,
      veiculoTerceiroModelo: veiculoTerceiro.veiculoTerceiroModelo,
      motorista: args.tipo === "perda" ? undefined : args.motorista?.trim() || undefined,
      motivoPerda: args.tipo === "perda" ? args.motivoPerda : undefined,
      observacao: args.observacao?.trim() || undefined,
      registradoPorTipo: "admin",
      clerkId: usuario.clerkId,
      autorNome: usuario.nome,
      registradoEm: Date.now(),
    });
    return { movimentacaoId, duplicado: false, protocolo };
  },
});

// Saída de venda/patrocínio com VÁRIOS produtos no mesmo carregamento (versão
// Admin do lote). Mesmas garantias do operador — atômica, saldo por formato
// somando o lote, sinal/pesoKg no servidor —, mas a câmara vem de cada produto
// (o Admin enxerga todas). Perda/produção seguem no caminho single.
export const lancarSaidaMultipla = mutation({
  args: {
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
    veiculoTerceiroModelo: v.optional(v.string()),
    motorista: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const usuario = await exigirAdmin(ctx);

    if (args.itens.length === 0) throw new ConvexError("Adicione ao menos um produto.");
    if (args.clienteNome.trim() === "") throw new ConvexError("Informe o nome do cliente.");

    const veiculoTerceiro = veiculoTerceiroValidado(true, args.veiculoTerceiro, args.veiculoTerceiroModelo);

    const jaGravadas = await ctx.db
      .query("movimentacoes")
      .withIndex("by_carregamento", (q) => q.eq("carregamentoId", args.carregamentoId))
      .collect();
    if (jaGravadas.length > 0) {
      return {
        movimentacaoIds: jaGravadas.map((m) => m._id),
        duplicado: true,
        protocolo: jaGravadas[0].protocolo ?? protocoloDe(args.carregamentoId),
        numeroComprovante: jaGravadas[0].numeroComprovante ?? null,
      };
    }

    const linhas: LinhaLote[] = [];
    for (const item of args.itens) {
      const { produto, formato } = await produtoEFormato(ctx, item.produtoId, item.formatoId);
      const { quantidade, pesoKg } = derivarQtdPeso(formato, item.quantidade, item.pesoKgVariavel);
      linhas.push({
        produtoId: item.produtoId,
        camaraId: produto.camaraId,
        formatoId: item.formatoId,
        formato,
        produtoNome: produto.nome,
        quantidade,
        pesoKg,
      });
    }

    await validarSaldoLote(ctx, linhas);

    const cliente = args.clienteNome.trim() || undefined;
    const motorista = args.motorista?.trim() || undefined;
    const protocolo = protocoloDe(args.carregamentoId);
    const numeroComprovante = await proximoNumeroComprovante(ctx);

    const movimentacaoIds = [];
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const id = await ctx.db.insert("movimentacoes", {
        chaveIdempotencia: args.itens[i].chaveIdempotencia,
        protocolo,
        numeroComprovante,
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
        veiculoTerceiro: veiculoTerceiro.veiculoTerceiro,
        veiculoTerceiroModelo: veiculoTerceiro.veiculoTerceiroModelo,
        motorista,
        registradoPorTipo: "admin",
        clerkId: usuario.clerkId,
        autorNome: usuario.nome,
        registradoEm: Date.now(),
      });
      movimentacaoIds.push(id);
    }
    return { movimentacaoIds, duplicado: false, protocolo, numeroComprovante };
  },
});
