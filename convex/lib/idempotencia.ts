import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/*
  Idempotência (RF34, RNF10). Protege contra duplo-toque e retry na porta da
  câmara: antes de inserir uma movimentação, a mutation chama este helper. Se já
  existe uma movimentação com a mesma chave, devolve a existente — a mutation
  então NÃO insere e NÃO dá erro, apenas retorna o registro que já estava lá.

  A chave é um UUID gerado no cliente, uma por lançamento.
*/
export async function movimentacaoExistente(
  ctx: MutationCtx,
  chaveIdempotencia: string,
): Promise<Doc<"movimentacoes"> | null> {
  return await ctx.db
    .query("movimentacoes")
    .withIndex("by_chave_idempotencia", (q) =>
      q.eq("chaveIdempotencia", chaveIdempotencia),
    )
    .first();
}
