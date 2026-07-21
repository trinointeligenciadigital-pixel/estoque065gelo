import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";

/*
  Deriva `quantidade` e `pesoKg` de uma movimentação a partir do formato e do que
  o colaborador informou. É SEMPRE calculado no servidor (RF33): o cliente manda
  a quantidade (ou o kg, se peso variável), nunca o pesoKg final nem o sinal.

  - Formato de peso fixo:  quantidade = nº informado (inteiro > 0); pesoKg = quantidade × formato.pesoKg
  - Formato de peso variável: quantidade = 1; pesoKg = kg informado (> 0)
*/
export function derivarQtdPeso(
  formato: Doc<"formatos">,
  quantidade: number | undefined,
  pesoKgVariavel: number | undefined,
): { quantidade: number; pesoKg: number } {
  if (formato.pesoVariavel) {
    if (pesoKgVariavel === undefined || pesoKgVariavel <= 0) {
      throw new ConvexError("Informe o peso em kg.");
    }
    return { quantidade: 1, pesoKg: pesoKgVariavel };
  }

  if (quantidade === undefined || quantidade <= 0 || !Number.isInteger(quantidade)) {
    throw new ConvexError("Informe uma quantidade válida.");
  }
  return { quantidade, pesoKg: quantidade * formato.pesoKg };
}
