import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { exigirAdmin } from "../lib/auth";

/*
  Produtos (RF20, RF21, RF22). A câmara é definida NA CRIAÇÃO e nunca mais muda:
  a mutation de atualizar NÃO aceita camaraId — mudar a câmara faria o saldo do
  produto sumir do cálculo (PRD 8.1). A trava é de código, não só de UI (RF22).
  Sem delete: só ativar/desativar.

  Nome repetido é permitido ENTRE câmaras diferentes (é o caso real da 065: "Cubo"
  existe na Cubo/Escama e na Conteiner) — as telas de lançamento distinguem os dois
  com `rotuloProduto` (nome · câmara). O que NÃO pode é repetir dentro da MESMA
  câmara: aí os dois "Cubo · Cubo/Escama" ficariam indistinguíveis no lançamento.
*/

const categoria = v.union(
  v.literal("saborizado"),
  v.literal("cubo"),
  v.literal("escamado"),
);
const unidadeBase = v.union(v.literal("pacote"), v.literal("kg"));

async function existeNomeNaCamara(
  ctx: MutationCtx,
  camaraId: Id<"camaras">,
  nome: string,
  excetoId?: Id<"produtos">,
): Promise<boolean> {
  const doCamara = await ctx.db
    .query("produtos")
    .withIndex("by_camara", (q) => q.eq("camaraId", camaraId))
    .collect();
  const alvo = nome.trim().toLowerCase();
  return doCamara.some((p) => p._id !== excetoId && p.nome.trim().toLowerCase() === alvo);
}

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
    if (await existeNomeNaCamara(ctx, args.camaraId, args.nome)) {
      throw new ConvexError(`Já existe um produto "${args.nome.trim()}" nesta câmara.`);
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
    const atual = await ctx.db.get(id);
    if (atual === null) throw new ConvexError("Produto não encontrado.");
    if (await existeNomeNaCamara(ctx, atual.camaraId, nome, id)) {
      throw new ConvexError(`Já existe um produto "${nome.trim()}" nesta câmara.`);
    }
    await ctx.db.patch(id, { nome, unidadeBase, ativo });
  },
});
