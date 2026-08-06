import { query } from "./_generated/server";

/*
  Dados da empresa que aparecem no CABEÇALHO do comprovante de saída (tarefa
  7.2) — só os campos que vão para o documento que o cliente recebe. Sem
  exigirAdmin: o comprovante é montado tanto pelo operador (sessão por token,
  sem identidade Clerk) quanto pelo Admin (reenvio no Histórico), e nenhum
  destes campos é sigiloso — são os mesmos que já saem impressos/copiados no
  próprio comprovante.
*/
export const dadosComprovante = query({
  args: {},
  handler: async (ctx) => {
    const registro = await ctx.db.query("empresa").first();
    if (registro === null) return null;
    const logoUrl = registro.logoStorageId ? await ctx.storage.getUrl(registro.logoStorageId) : null;
    return {
      nomeFantasia: registro.nomeFantasia ?? null,
      cnpj: registro.cnpj ?? null,
      endereco: registro.endereco ?? null,
      telefone: registro.telefone ?? null,
      logoUrl,
    };
  },
});
