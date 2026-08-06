import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";

/*
  Dados da empresa emissora do comprovante (tarefa 7) — singleton: sempre um
  registro só (ou nenhum, antes do primeiro "Salvar"). CRUD só de Admin; a
  leitura usada para MONTAR o comprovante em si (operador + reenvio no
  Histórico) é pública e vive em convex/empresaPublica.ts, porque quem gera o
  comprovante nem sempre tem sessão de Admin.
*/

export const obter = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    const registro = await ctx.db.query("empresa").first();
    if (registro === null) return null;
    const logoUrl = registro.logoStorageId ? await ctx.storage.getUrl(registro.logoStorageId) : null;
    return { ...registro, logoUrl };
  },
});

export const gerarUrlUpload = mutation({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const salvar = mutation({
  args: {
    razaoSocial: v.string(),
    nomeFantasia: v.string(),
    cnpj: v.string(),
    inscricaoEstadual: v.string(),
    endereco: v.string(),
    telefone: v.string(),
    whatsapp: v.string(),
    email: v.string(),
    // Ausente = não trocou a logo agora (mantém a que já existia). Passar o
    // storageId de um novo upload troca; não existe "remover logo" ainda.
    logoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);
    const existente = await ctx.db.query("empresa").first();

    // Campo em branco vira `undefined` (o patch do Convex apaga o campo) — é
    // assim que um dado inventado nunca fica: se o Admin limpar o CNPJ e
    // salvar, o comprovante volta a omitir a linha.
    const campos = {
      razaoSocial: args.razaoSocial.trim() || undefined,
      nomeFantasia: args.nomeFantasia.trim() || undefined,
      cnpj: args.cnpj.trim() || undefined,
      inscricaoEstadual: args.inscricaoEstadual.trim() || undefined,
      endereco: args.endereco.trim() || undefined,
      telefone: args.telefone.trim() || undefined,
      whatsapp: args.whatsapp.trim() || undefined,
      email: args.email.trim() || undefined,
      ...(args.logoStorageId !== undefined ? { logoStorageId: args.logoStorageId } : {}),
    };

    if (existente) {
      await ctx.db.patch(existente._id, campos);
    } else {
      await ctx.db.insert("empresa", campos);
    }
  },
});
