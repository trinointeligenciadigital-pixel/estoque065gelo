import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";

/*
  Formatos por produto (RF23). Um produto pode ter vários. Quando pesoVariavel é
  true, o peso é digitado no lançamento e o pesoKg cadastrado é ignorado — aqui
  ele é gravado como 0 para não confundir. Sem delete: só ativar/desativar.
*/

export const listarPorProduto = query({
  args: { produtoId: v.id("produtos") },
  handler: async (ctx, { produtoId }) => {
    await exigirAdmin(ctx);
    return await ctx.db
      .query("formatos")
      .withIndex("by_produto", (q) => q.eq("produtoId", produtoId))
      .collect();
  },
});

export const criar = mutation({
  args: {
    produtoId: v.id("produtos"),
    nome: v.string(),
    pesoKg: v.number(),
    pesoVariavel: v.boolean(),
    unidadesPorPacote: v.optional(v.number()),
    unidadeContagem: v.optional(v.union(v.literal("pacote"), v.literal("unidade"))),
    estoqueMinimo: v.optional(v.number()),
  },
  handler: async (ctx, { produtoId, nome, pesoKg, pesoVariavel, unidadesPorPacote, unidadeContagem, estoqueMinimo }) => {
    await exigirAdmin(ctx);

    const produto = await ctx.db.get(produtoId);
    if (produto === null) {
      throw new ConvexError("Produto não encontrado.");
    }
    if (!pesoVariavel && pesoKg <= 0) {
      throw new ConvexError("Peso em kg deve ser maior que zero.");
    }
    if (estoqueMinimo !== undefined && estoqueMinimo < 0) {
      throw new ConvexError("Estoque mínimo não pode ser negativo.");
    }
    if (unidadesPorPacote !== undefined && unidadesPorPacote <= 0) {
      throw new ConvexError("Unidades por pacote deve ser maior que zero.");
    }
    const unidade = unidadeContagem ?? "pacote";
    if (unidade === "unidade" && unidadesPorPacote !== undefined) {
      throw new ConvexError("Formato em unidades não tem \"unidades por pacote\" — ele já é a unidade.");
    }

    return await ctx.db.insert("formatos", {
      produtoId,
      nome,
      pesoKg: pesoVariavel ? 0 : pesoKg,
      pesoVariavel,
      // Peso variável e formato "unidade" não têm contagem de unidades por
      // pacote — só faz sentido pra formato "pacote" de peso fixo.
      unidadesPorPacote: pesoVariavel || unidade === "unidade" ? undefined : unidadesPorPacote,
      // Ausente = "pacote", pra não distinguir de todo formato já existente.
      unidadeContagem: unidade === "pacote" ? undefined : unidade,
      estoqueMinimo: estoqueMinimo ?? 0,
      ativo: true,
    });
  },
});

// Sem unidadeContagem aqui de propósito: é fixada na criação e nunca muda
// depois (ver comentário do campo em convex/schema.ts). Passar unidadeContagem
// aqui é rejeitado pela validação de argumentos do Convex.
export const atualizar = mutation({
  args: {
    id: v.id("formatos"),
    nome: v.string(),
    pesoKg: v.number(),
    pesoVariavel: v.boolean(),
    unidadesPorPacote: v.optional(v.number()),
    estoqueMinimo: v.optional(v.number()),
    ativo: v.boolean(),
  },
  handler: async (ctx, { id, nome, pesoKg, pesoVariavel, unidadesPorPacote, estoqueMinimo, ativo }) => {
    await exigirAdmin(ctx);
    if (!pesoVariavel && pesoKg <= 0) {
      throw new ConvexError("Peso em kg deve ser maior que zero.");
    }
    if (estoqueMinimo !== undefined && estoqueMinimo < 0) {
      throw new ConvexError("Estoque mínimo não pode ser negativo.");
    }
    if (unidadesPorPacote !== undefined && unidadesPorPacote <= 0) {
      throw new ConvexError("Unidades por pacote deve ser maior que zero.");
    }
    await ctx.db.patch(id, {
      nome,
      pesoKg: pesoVariavel ? 0 : pesoKg,
      pesoVariavel,
      unidadesPorPacote: pesoVariavel ? undefined : unidadesPorPacote,
      estoqueMinimo: estoqueMinimo ?? 0,
      ativo,
    });
  },
});
