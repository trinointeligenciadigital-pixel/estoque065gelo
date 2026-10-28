import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { dataHoraCuiaba, resolverDataMovimento } from "./data";

/*
  Data do movimento (RF65) validada contra a última contagem FECHADA da câmara
  (pendente ou aprovada). A foto da contagem (saldoSistema) é tirada no
  fechamento e o físico contado já reflete tudo que aconteceu até ali: um
  lançamento com data ANTERIOR a esse fechamento, gravado depois, contaria o
  mesmo gelo duas vezes (uma pelo ajuste da contagem, outra pelo lançamento).
  Mesmo raciocínio do bloqueio de estorno em lib/estorno.ts.

  Devolve o timestamp a gravar em `dataMovimento`.
*/
export async function dataMovimentoValidada(
  ctx: MutationCtx,
  camaraIds: Id<"camaras">[],
  dia: string | undefined,
  agora: number,
): Promise<number> {
  const dataMovimento = resolverDataMovimento(dia, agora);
  if (dataMovimento === agora) return dataMovimento;

  for (const camaraId of new Set(camaraIds)) {
    const contagens = await ctx.db
      .query("contagens")
      .withIndex("by_camara", (q) => q.eq("camaraId", camaraId))
      .collect();
    const ultimoFechamento = contagens
      .filter((c) => (c.status === "pendente" || c.status === "aprovada") && c.fechadaEm !== undefined)
      .reduce<number | null>((maior, c) => (maior === null || c.fechadaEm! > maior ? c.fechadaEm! : maior), null);
    if (ultimoFechamento !== null && dataMovimento < ultimoFechamento) {
      throw new ConvexError(
        `Esta câmara teve uma contagem fechada em ${dataHoraCuiaba(ultimoFechamento)}. Não dá para lançar com data anterior a ela — escolha uma data mais recente.`,
      );
    }
  }
  return dataMovimento;
}
