import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";

/*
  Veículos próprios (RF24): placa, modelo e motorista padrão. Sem delete: só
  ativar/desativar.
*/

export const listar = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    return await ctx.db.query("veiculos").collect();
  },
});

export const criar = mutation({
  args: {
    placa: v.string(),
    modelo: v.optional(v.string()),
    motoristaPadrao: v.optional(v.string()),
  },
  handler: async (ctx, { placa, modelo, motoristaPadrao }) => {
    await exigirAdmin(ctx);
    return await ctx.db.insert("veiculos", {
      placa,
      modelo,
      motoristaPadrao,
      ativo: true,
    });
  },
});

export const atualizar = mutation({
  args: {
    id: v.id("veiculos"),
    placa: v.string(),
    modelo: v.optional(v.string()),
    motoristaPadrao: v.optional(v.string()),
    ativo: v.boolean(),
  },
  handler: async (ctx, { id, placa, modelo, motoristaPadrao, ativo }) => {
    await exigirAdmin(ctx);
    await ctx.db.patch(id, { placa, modelo, motoristaPadrao, ativo });
  },
});
