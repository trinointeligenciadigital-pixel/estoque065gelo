import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { exigirAdmin } from "../lib/auth";
import { gerarPin, hashPin } from "../lib/pin";

/*
  Operadores (RF11–RF17). Regras críticas:
  - `pinHash` NUNCA sai do backend (RNF05): o `listar` devolve só `temPin`.
  - Gerar novo PIN invalida todas as sessões do operador na MESMA transação (RF14).
  - Desativar operador invalida as sessões dele na hora (RF16).
  - Operador nunca é deletado (RF17): só ativar/desativar.
  - O PIN em texto puro é retornado UMA vez, na resposta do gerarPin (RF12, RF13).
*/

// Apaga todas as sessões ativas de um operador (RF14, RF16).
async function invalidarSessoes(ctx: MutationCtx, operadorId: Id<"operadores">) {
  const sessoes = await ctx.db
    .query("sessoesOperador")
    .withIndex("by_operador_id", (q) => q.eq("operadorId", operadorId))
    .collect();
  for (const s of sessoes) {
    await ctx.db.delete(s._id);
  }
}

export const listar = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    const operadores = await ctx.db.query("operadores").collect();
    // Nunca expõe pinHash. Devolve apenas se já existe um PIN definido.
    return operadores.map((o) => ({
      _id: o._id,
      nome: o.nome,
      whatsapp: o.whatsapp,
      camarasPermitidas: o.camarasPermitidas,
      podeLancarProducao: o.podeLancarProducao,
      podeLancarSaida: o.podeLancarSaida,
      podeContar: o.podeContar,
      ativo: o.ativo,
      temPin: o.pinHash !== "",
      bloqueadoAte: o.bloqueadoAte,
    }));
  },
});

export const criar = mutation({
  args: {
    nome: v.string(),
    whatsapp: v.optional(v.string()),
    camarasPermitidas: v.array(v.id("camaras")),
    podeLancarProducao: v.boolean(),
    podeLancarSaida: v.boolean(),
    podeContar: v.boolean(),
  },
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);
    // Nasce sem PIN (pinHash vazio); o Admin gera o PIN depois, num clique.
    return await ctx.db.insert("operadores", {
      nome: args.nome,
      whatsapp: args.whatsapp,
      pinHash: "",
      camarasPermitidas: args.camarasPermitidas,
      podeLancarProducao: args.podeLancarProducao,
      podeLancarSaida: args.podeLancarSaida,
      podeContar: args.podeContar,
      tentativasFalhas: 0,
      ativo: true,
    });
  },
});

export const atualizar = mutation({
  args: {
    id: v.id("operadores"),
    nome: v.string(),
    whatsapp: v.optional(v.string()),
    camarasPermitidas: v.array(v.id("camaras")),
    podeLancarProducao: v.boolean(),
    podeLancarSaida: v.boolean(),
    podeContar: v.boolean(),
    ativo: v.boolean(),
  },
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);
    const { id, ...campos } = args;
    await ctx.db.patch(id, campos);
    // Desativar derruba as sessões ativas imediatamente (RF16).
    if (!args.ativo) {
      await invalidarSessoes(ctx, id);
    }
  },
});

// Gera um PIN novo, salva só o hash, invalida as sessões ativas do operador na
// mesma transação, e devolve o PIN em texto puro UMA única vez (RF12, RF13, RF14).
export const gerarPinOperador = mutation({
  args: { id: v.id("operadores") },
  handler: async (ctx, { id }) => {
    await exigirAdmin(ctx);

    const operador = await ctx.db.get(id);
    if (operador === null) {
      throw new ConvexError("Operador não encontrado.");
    }

    const pin = gerarPin();
    const pinHash = await hashPin(pin);

    await ctx.db.patch(id, {
      pinHash,
      tentativasFalhas: 0,
      bloqueadoAte: undefined,
    });

    await invalidarSessoes(ctx, id);

    // Único ponto em que o PIN em texto puro existe fora da cabeça de quem o
    // recebe. Não é logado, não é persistido, não volta em nenhuma query.
    return { pin, nome: operador.nome, whatsapp: operador.whatsapp ?? "" };
  },
});
