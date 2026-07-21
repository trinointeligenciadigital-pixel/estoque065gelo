import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";

/*
  Produtos (RF20, RF21, RF22). A câmara é definida NA CRIAÇÃO e nunca mais muda:
  a mutation de atualizar NÃO aceita camaraId — mudar a câmara faria o saldo do
  produto sumir do cálculo (PRD 8.1). A trava é de código, não só de UI (RF22).
  Sem delete: só ativar/desativar.
*/

const categoria = v.union(
  v.literal("saborizado"),
  v.literal("cubo"),
  v.literal("escamado"),
);
const unidadeBase = v.union(v.literal("pacote"), v.literal("kg"));

export const listar = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    return await ctx.db.query("produtos").collect();
  },
});

export const criar = mutation({
  args: {
    nome: v.string(),
    categoria,
    camaraId: v.id("camaras"),
    unidadeBase,
  },
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);

    const camara = await ctx.db.get(args.camaraId);
    if (camara === null) {
      throw new ConvexError("Câmara não encontrada.");
    }

    // O estoque mínimo é definido no FORMATO, não aqui (por tamanho de pacote).
    return await ctx.db.insert("produtos", {
      nome: args.nome,
      categoria: args.categoria,
      camaraId: args.camaraId,
      unidadeBase: args.unidadeBase,
      ativo: true,
    });
  },
});

export const atualizar = mutation({
  // Sem camaraId e sem categoria: ambos são fixados na criação. Passar camaraId
  // aqui é rejeitado pela validação de argumentos do Convex — a câmara é
  // imutável por construção (RF22).
  args: {
    id: v.id("produtos"),
    nome: v.string(),
    unidadeBase,
    ativo: v.boolean(),
  },
  handler: async (ctx, { id, nome, unidadeBase, ativo }) => {
    await exigirAdmin(ctx);
    await ctx.db.patch(id, { nome, unidadeBase, ativo });
  },
});
