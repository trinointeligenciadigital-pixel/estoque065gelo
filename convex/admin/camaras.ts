import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";

/*
  Câmaras (RF18, RF19). O qrToken é gerado automaticamente na criação e NUNCA
  muda — reimprimir o QR reusa o mesmo token. Sem delete: só ativar/desativar.
*/

export const listar = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    return await ctx.db.query("camaras").collect();
  },
});

export const criar = mutation({
  args: { nome: v.string() },
  handler: async (ctx, { nome }) => {
    await exigirAdmin(ctx);
    const qrToken = crypto.randomUUID();
    return await ctx.db.insert("camaras", { nome, qrToken, ativo: true });
  },
});

export const atualizar = mutation({
  // Note: sem qrToken. O token é definido na criação e não é editável (RF19).
  args: { id: v.id("camaras"), nome: v.string(), ativo: v.boolean() },
  handler: async (ctx, { id, nome, ativo }) => {
    await exigirAdmin(ctx);
    await ctx.db.patch(id, { nome, ativo });
  },
});
