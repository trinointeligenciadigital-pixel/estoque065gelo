import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { exigirAdmin } from "../lib/auth";
import { movimentacaoExistente } from "../lib/idempotencia";
import { derivarQtdPeso } from "../lib/movimentacao";
import { saldoDoFormato, pesoLiquidoDoFormato } from "../lib/saldo";
import { protocoloDe } from "../lib/protocolo";

/*
  Transferência entre câmaras (correção Painel/Transferência, tarefa 5) — só
  pelo painel Admin (v1). O modelo de produto fixo por câmara (regra
  arquitetural: camaraId nunca muda) não tem um jeito nativo de mover um lote
  de uma câmara pra outra; sem esta operação, o único caminho era lançar saída
  + produção, que registra como PERDA e PRODUÇÃO — inflando os dois
  indicadores e mentindo sobre o que aconteceu.

  Sempre um PAR na mesma mutation (mesma transação Convex — se qualquer perna
  falhar, nada grava, de graça): uma saída (sinal -1) no produto/formato de
  origem, uma entrada (sinal 1) no produto/formato de destino, mesmo loteId e
  protocolo (mesmo mecanismo de agrupamento que os ajustes em lote já usam —
  convex/lib/contagem.ts). NÃO cria produto no destino: se não existe um
  equivalente cadastrado, bloqueia (ver `equivalente` abaixo).
*/

// Formatos ativos de um produto, com o necessário para montar o formulário e
// comparar equivalência.
async function formatosDoProduto(ctx: QueryCtx, produtoId: Id<"produtos">): Promise<Doc<"formatos">[]> {
  const formatos = await ctx.db
    .query("formatos")
    .withIndex("by_produto", (q) => q.eq("produtoId", produtoId))
    .collect();
  return formatos.filter((f) => f.ativo);
}

// Produtos ativos, agrupados com sua câmara — para os dois seletores (origem e
// destino) do formulário de transferência.
export const opcoes = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    const camaras = await ctx.db.query("camaras").collect();
    const ativas = camaras.filter((c) => c.ativo);
    const nomeCamara = new Map(camaras.map((c) => [c._id, c.nome]));

    const produtos = await ctx.db.query("produtos").collect();
    const produtosAtivos = produtos.filter((p) => p.ativo);

    const produtosComFormato = await Promise.all(
      produtosAtivos.map(async (p) => ({
        _id: p._id,
        nome: p.nome,
        categoria: p.categoria,
        camaraId: p.camaraId,
        camaraNome: nomeCamara.get(p.camaraId) ?? "—",
        formatos: (await formatosDoProduto(ctx, p._id)).map((f) => ({
          _id: f._id,
          nome: f.nome,
          pesoKg: f.pesoKg,
          pesoVariavel: f.pesoVariavel,
          unidadesPorPacote: f.unidadesPorPacote ?? null,
          unidadeContagem: f.unidadeContagem ?? "pacote",
        })),
      })),
    );

    return {
      camaras: ativas.map((c) => ({ _id: c._id, nome: c.nome })),
      produtos: produtosComFormato,
    };
  },
});

// Produto+formato equivalente na câmara de destino: mesmo nome de produto
// (normalizado) e mesmo formato (peso e pesoVariavel iguais — é a mesma
// embalagem física). NUNCA cria nada — devolve null quando não existe, e quem
// chama (a tela) bloqueia com a mensagem de cadastro pendente.
export const equivalente = query({
  args: {
    produtoOrigemId: v.id("produtos"),
    formatoOrigemId: v.id("formatos"),
    camaraDestinoId: v.id("camaras"),
  },
  handler: async (ctx, { produtoOrigemId, formatoOrigemId, camaraDestinoId }) => {
    await exigirAdmin(ctx);
    const produtoOrigem = await ctx.db.get(produtoOrigemId);
    const formatoOrigem = await ctx.db.get(formatoOrigemId);
    if (produtoOrigem === null || formatoOrigem === null) return null;

    const candidatos = await ctx.db
      .query("produtos")
      .withIndex("by_camara", (q) => q.eq("camaraId", camaraDestinoId))
      .collect();
    const nomeAlvo = produtoOrigem.nome.trim().toLowerCase();
    const produtoDestino = candidatos.find((p) => p.ativo && p.nome.trim().toLowerCase() === nomeAlvo);
    if (produtoDestino === undefined) return null;

    const formatosDestino = await formatosDoProduto(ctx, produtoDestino._id);
    const formatoDestino = formatosDestino.find(
      (f) => f.pesoVariavel === formatoOrigem.pesoVariavel && f.pesoKg === formatoOrigem.pesoKg,
    );
    if (formatoDestino === undefined) return null;

    return {
      produtoId: produtoDestino._id,
      formatoId: formatoDestino._id,
      produtoNome: produtoDestino.nome,
      formatoNome: formatoDestino.nome,
    };
  },
});

export const transferir = mutation({
  args: {
    chaveIdempotencia: v.string(),
    produtoOrigemId: v.id("produtos"),
    formatoOrigemId: v.id("formatos"),
    produtoDestinoId: v.id("produtos"),
    formatoDestinoId: v.id("formatos"),
    quantidade: v.optional(v.number()),
    pesoKgVariavel: v.optional(v.number()),
    observacao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const usuario = await exigirAdmin(ctx);

    const produtoOrigem = await ctx.db.get(args.produtoOrigemId);
    if (produtoOrigem === null) throw new ConvexError("Produto de origem não encontrado.");
    const formatoOrigem = await ctx.db.get(args.formatoOrigemId);
    if (formatoOrigem === null || formatoOrigem.produtoId !== args.produtoOrigemId) {
      throw new ConvexError("Formato inválido para o produto de origem.");
    }
    const produtoDestino = await ctx.db.get(args.produtoDestinoId);
    if (produtoDestino === null) throw new ConvexError("Produto de destino não encontrado.");
    const formatoDestino = await ctx.db.get(args.formatoDestinoId);
    if (formatoDestino === null || formatoDestino.produtoId !== args.produtoDestinoId) {
      throw new ConvexError("Formato inválido para o produto de destino.");
    }

    if (produtoOrigem.camaraId === produtoDestino.camaraId) {
      throw new ConvexError("Origem e destino não podem ser a mesma câmara.");
    }

    // Idempotência: as duas pernas nascem juntas, então basta checar a chave
    // da perna de saída — se ela já existe, a de entrada também existe (mesmo
    // loteId), pela mesma garantia de atomicidade da mutation.
    const existente = await movimentacaoExistente(ctx, args.chaveIdempotencia);
    if (existente !== null) {
      const par = await ctx.db
        .query("movimentacoes")
        .withIndex("by_lote", (q) => q.eq("loteId", existente.loteId))
        .collect();
      const entrada = par.find((m) => m._id !== existente._id);
      return {
        saidaId: existente._id,
        entradaId: entrada?._id ?? existente._id,
        protocolo: existente.protocolo ?? protocoloDe(args.chaveIdempotencia),
        duplicado: true,
      };
    }

    const { quantidade, pesoKg } = derivarQtdPeso(formatoOrigem, args.quantidade, args.pesoKgVariavel);

    const disponivel = formatoOrigem.pesoVariavel
      ? await pesoLiquidoDoFormato(ctx, produtoOrigem._id, produtoOrigem.camaraId, formatoOrigem._id)
      : await saldoDoFormato(ctx, produtoOrigem._id, produtoOrigem.camaraId, formatoOrigem._id);
    const pedido = formatoOrigem.pesoVariavel ? pesoKg : quantidade;
    if (pedido > disponivel) {
      throw new ConvexError("Saldo insuficiente na câmara de origem.");
    }

    const loteId = crypto.randomUUID();
    const protocolo = protocoloDe(loteId);
    const observacao = args.observacao?.trim() || undefined;
    const agora = Date.now();
    const autor = { registradoPorTipo: "admin" as const, clerkId: usuario.clerkId, autorNome: usuario.nome };

    const saidaId = await ctx.db.insert("movimentacoes", {
      chaveIdempotencia: args.chaveIdempotencia,
      protocolo,
      tipo: "transferencia",
      sinal: -1,
      produtoId: produtoOrigem._id,
      camaraId: produtoOrigem.camaraId,
      formatoId: formatoOrigem._id,
      quantidade,
      pesoKg,
      observacao,
      loteId,
      ...autor,
      registradoEm: agora,
    });
    const entradaId = await ctx.db.insert("movimentacoes", {
      // Chave própria e determinística (nunca a mesma da perna de saída — o
      // índice by_chave_idempotencia é usado pra idempotência de CADA linha).
      chaveIdempotencia: `${args.chaveIdempotencia}:destino`,
      protocolo,
      tipo: "transferencia",
      sinal: 1,
      produtoId: produtoDestino._id,
      camaraId: produtoDestino.camaraId,
      formatoId: formatoDestino._id,
      quantidade,
      pesoKg,
      observacao,
      loteId,
      ...autor,
      registradoEm: agora,
    });

    return { saidaId, entradaId, protocolo, duplicado: false };
  },
});
