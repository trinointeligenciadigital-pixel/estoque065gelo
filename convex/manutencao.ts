import { internalMutation } from "./_generated/server";

/*
  Manutenção agendada. Só roda pelo cron (internalMutation não é exposta ao
  cliente). RF09: limpeza diária de sessões expiradas.

  IMPORTANTE: isto é só faxina. Uma sessão expirada JÁ não autoriza nada mesmo que
  o cron ainda não tenha rodado — a autorização confere `expiraEm` a cada chamada
  (ver exigirSessaoOperador), não a existência do registro. O cron só evita que a
  tabela cresça com lixo.
*/
export const limparSessoesExpiradas = internalMutation({
  args: {},
  handler: async (ctx) => {
    const agora = Date.now();
    const expiradas = await ctx.db
      .query("sessoesOperador")
      .withIndex("by_expira_em", (q) => q.lt("expiraEm", agora))
      .collect();

    for (const s of expiradas) {
      await ctx.db.delete(s._id);
    }
    return { removidas: expiradas.length };
  },
});
