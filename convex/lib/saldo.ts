import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/*
  Cálculo de saldo — fonte de verdade é sempre o ledger somado em tempo de
  leitura. NUNCA existe campo `saldo` (regra arquitetural 1).
  Transcrito de docs/02-schema-convex.md, seção "Cálculo de saldo".
*/

// Fonte de verdade para saldo consultável, validável em saída, e usado na
// comparação de contagem física. Sempre por formato — nunca agrega quantidade
// de formatos diferentes, porque "quantidade" não é unidade comparável entre
// um saco de 2kg e um saco de 5kg.
export async function saldoDoFormato(
  ctx: QueryCtx,
  produtoId: Id<"produtos">,
  camaraId: Id<"camaras">,
  formatoId: Id<"formatos">,
): Promise<number> {
  const movs = await ctx.db
    .query("movimentacoes")
    .withIndex("by_produto_camara_formato", (q) =>
      q
        .eq("produtoId", produtoId)
        .eq("camaraId", camaraId)
        .eq("formatoId", formatoId),
    )
    .collect();

  return movs.reduce((acc, m) => acc + m.sinal * m.quantidade, 0);
}

// Para o painel (saldo do produto/sabor agregando todos os formatos) — agrega
// por PESO, que é a unidade comparável entre formatos diferentes. Nunca soma
// "quantidade" de formatos distintos.
export async function pesoTotalDoProduto(
  ctx: QueryCtx,
  produtoId: Id<"produtos">,
  camaraId: Id<"camaras">,
): Promise<number> {
  const movs = await ctx.db
    .query("movimentacoes")
    .withIndex("by_produto_camara", (q) =>
      q.eq("produtoId", produtoId).eq("camaraId", camaraId),
    )
    .collect();

  return movs.reduce((acc, m) => acc + m.sinal * m.pesoKg, 0);
}

// Peso líquido de UM formato (soma de peso, por formato). Usado onde "quantidade"
// não representa o estoque físico — o caso do formato de peso variável (granel),
// onde cada movimentação tem quantidade = 1 e o estoque real é o peso somado.
// A validação de saída de granel na Fase 3 usa esta mesma lógica.
export async function pesoLiquidoDoFormato(
  ctx: QueryCtx,
  produtoId: Id<"produtos">,
  camaraId: Id<"camaras">,
  formatoId: Id<"formatos">,
): Promise<number> {
  const movs = await ctx.db
    .query("movimentacoes")
    .withIndex("by_produto_camara_formato", (q) =>
      q.eq("produtoId", produtoId).eq("camaraId", camaraId).eq("formatoId", formatoId),
    )
    .collect();

  return movs.reduce((acc, m) => acc + m.sinal * m.pesoKg, 0);
}
