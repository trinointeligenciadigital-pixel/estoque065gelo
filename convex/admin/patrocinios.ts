import { query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";

/*
  Consulta de patrocínio do Admin (RF42). Para cada patrocínio: quanto saiu, quanto
  retornou e quanto foi consumido (saiu − retornado). Vale para todas as câmaras.
  A unidade segue o formato: pacotes no formato normal, kg no de peso variável.
*/
export const listar = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);

    const patrocinios = await ctx.db
      .query("movimentacoes")
      .withIndex("by_tipo", (q) => q.eq("tipo", "patrocinio"))
      .collect();

    const resultado = await Promise.all(
      patrocinios.map(async (p) => {
        const retornos = await ctx.db
          .query("movimentacoes")
          .withIndex("by_patrocinio_origem", (q) => q.eq("patrocinioOrigemId", p._id))
          .collect();
        const produto = await ctx.db.get(p.produtoId);
        const formato = await ctx.db.get(p.formatoId);
        const porPeso = formato?.pesoVariavel ?? false;

        const saiu = porPeso ? p.pesoKg : p.quantidade;
        const retornado = retornos.reduce((acc, r) => acc + (porPeso ? r.pesoKg : r.quantidade), 0);
        const consumido = saiu - retornado;

        return {
          _id: p._id,
          registradoEm: p.registradoEm,
          clienteNome: p.clienteNome ?? "",
          produtoNome: produto?.nome ?? "—",
          formatoNome: formato?.nome ?? "—",
          unidade: porPeso ? "kg" : "un",
          saiu,
          retornado,
          consumido,
          emAberto: saiu - retornado > 0,
        };
      }),
    );

    resultado.sort((a, b) => b.registradoEm - a.registradoEm);
    return resultado;
  },
});
