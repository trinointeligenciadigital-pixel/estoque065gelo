import type { MutationCtx } from "../_generated/server";

/*
  Protocolo curto e legível em voz alta (adendo PWA, tarefa 4) — 8 caracteres
  hexadecimais maiúsculos derivados de uma semente. Para lançamentos normais a
  semente é a própria chaveIdempotencia (um UUID real do cliente — determinístico,
  então repetir a mesma chamada por retry gera o MESMO protocolo). Para estorno e
  ajuste, cuja chaveIdempotencia não é um UUID legível ("estorno:<id>",
  "ajuste:<contagem>:<item>"), quem chama passa uma semente própria (um
  crypto.randomUUID() fresco, ou o loteId do grupo).
*/
export function protocoloDe(semente: string): string {
  return semente.slice(0, 8).toUpperCase();
}

// Número sequencial do comprovante de saída (talão de papel: 1, 2, 3…) — só
// carregamento (venda/patrocínio) tem. Lê o maior número já emitido pelo
// índice dedicado e soma 1; sem carregamento numerado ainda, começa em 1.
// Convex detecta conflito e reexecuta a mutation sozinho se dois carregamentos
// tentarem ler/gravar o mesmo "próximo número" ao mesmo tempo (a leitura pelo
// índice entra no conjunto observado da transação) — não precisa de tabela de
// trava à parte. Chame só depois de confirmar que o carregamento é novo (a
// checagem de idempotência já aconteceu), senão reenvio duplo consome um
// número à toa.
export async function proximoNumeroComprovante(ctx: MutationCtx): Promise<number> {
  const ultimo = await ctx.db
    .query("movimentacoes")
    .withIndex("by_numero_comprovante")
    .order("desc")
    .first();
  return (ultimo?.numeroComprovante ?? 0) + 1;
}
