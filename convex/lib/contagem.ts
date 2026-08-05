import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { saldoDoFormato, pesoLiquidoDoFormato } from "./saldo";

/*
  Contagem física — lógica compartilhada entre o fluxo do operador e o do Admin.
  A tabela `contagens`/`contagemItens` NÃO é o ledger imutável: pode receber patch
  de status. O que é imutável é `movimentacoes` — e ajuste só nasce da APROVAÇÃO
  de uma contagem (RF53, RF55).

  DECISÃO (peso variável): o "saldo do sistema" congelado por formato usa a mesma
  unidade que o código já usa na saída — pacotes (quantidade) para formato normal,
  peso (kg) para formato de peso variável. Assim a divergência fica na unidade que
  a pessoa realmente conta.
*/

// Saldo do sistema de um formato, na unidade natural dele: quantidade para
// formato normal, peso (kg) para formato de peso variável.
export async function saldoDeContagem(
  ctx: QueryCtx,
  produtoId: Id<"produtos">,
  camaraId: Id<"camaras">,
  formato: Doc<"formatos">,
): Promise<number> {
  return formato.pesoVariavel
    ? await pesoLiquidoDoFormato(ctx, produtoId, camaraId, formato._id)
    : await saldoDoFormato(ctx, produtoId, camaraId, formato._id);
}

// A contagem em andamento (aberta ou pendente) de uma câmara, se houver. Só pode
// existir uma por vez (RF47).
export async function contagemAtivaDaCamara(
  ctx: QueryCtx,
  camaraId: Id<"camaras">,
): Promise<Doc<"contagens"> | null> {
  const contagens = await ctx.db
    .query("contagens")
    .withIndex("by_camara", (q) => q.eq("camaraId", camaraId))
    .collect();
  return contagens.find((c) => c.status === "aberta" || c.status === "pendente") ?? null;
}

export type ItemContado = {
  produtoId: Id<"produtos">;
  formatoId: Id<"formatos">;
  saldoContado: number;
};

// Fecha a contagem (RF49, RF50): por formato, congela o saldo do sistema em
// `saldoSistema`, grava o contado e a divergência (contado − sistema). O status
// passa a `pendente`, aguardando a decisão do Admin. Nada entra no ledger aqui.
export async function fecharContagemComItens(
  ctx: MutationCtx,
  contagem: Doc<"contagens">,
  itens: ItemContado[],
): Promise<void> {
  if (contagem.status !== "aberta") {
    throw new ConvexError("Esta contagem não está mais aberta.");
  }
  for (const it of itens) {
    if (!Number.isFinite(it.saldoContado) || it.saldoContado < 0) {
      throw new ConvexError("Quantidade contada inválida.");
    }
    const produto = await ctx.db.get(it.produtoId);
    if (produto === null || produto.camaraId !== contagem.camaraId) {
      throw new ConvexError("Item fora desta câmara.");
    }
    const formato = await ctx.db.get(it.formatoId);
    if (formato === null || formato.produtoId !== it.produtoId) {
      throw new ConvexError("Formato inválido para este produto.");
    }
    const saldoSistema = await saldoDeContagem(ctx, it.produtoId, contagem.camaraId, formato);
    await ctx.db.insert("contagemItens", {
      contagemId: contagem._id,
      produtoId: it.produtoId,
      formatoId: it.formatoId,
      saldoSistema,
      saldoContado: it.saldoContado,
      divergencia: it.saldoContado - saldoSistema,
    });
  }
  await ctx.db.patch(contagem._id, { status: "pendente", fechadaEm: Date.now() });
}

// Aprova a contagem (RF53): gera UMA movimentação de ajuste por item com
// divergência ≠ 0, com o sinal da divergência, vinculada à contagem. Item sem
// divergência não gera nada. A chave de idempotência é determinística por item,
// então uma reaprovação acidental nunca duplica ajuste.
export async function gerarAjustesDaContagem(
  ctx: MutationCtx,
  contagem: Doc<"contagens">,
  clerkId: string,
  autorNome: string,
): Promise<number> {
  const itens = await ctx.db
    .query("contagemItens")
    .withIndex("by_contagem", (q) => q.eq("contagemId", contagem._id))
    .collect();

  // Um loteId por aprovação — agrupa todos os ajustes desta contagem no
  // Histórico (tarefa 5). Só é gerado uma vez aqui porque `aprovar` já garante
  // que uma contagem só passa por esta função uma única vez (exigirDecidivel
  // exige status "pendente", que vira "aprovada" na mesma chamada).
  const loteId = crypto.randomUUID();

  let gerados = 0;
  for (const it of itens) {
    if (it.divergencia === 0) continue;
    const formato = await ctx.db.get(it.formatoId);
    if (formato === null) continue;

    const sinal = it.divergencia > 0 ? (1 as const) : (-1 as const);
    const magnitude = Math.abs(it.divergencia);
    // Formato normal: divergência em pacotes → quantidade = magnitude, peso derivado.
    // Formato de peso variável: divergência em kg → peso = magnitude, quantidade = 1.
    const quantidade = formato.pesoVariavel ? 1 : magnitude;
    const pesoKg = formato.pesoVariavel ? magnitude : magnitude * formato.pesoKg;

    await ctx.db.insert("movimentacoes", {
      chaveIdempotencia: `ajuste:${contagem._id}:${it._id}`,
      tipo: "ajuste",
      sinal,
      produtoId: it.produtoId,
      camaraId: contagem.camaraId,
      formatoId: it.formatoId,
      quantidade,
      pesoKg,
      contagemId: contagem._id,
      loteId,
      motivoCategoria: "contagem",
      registradoPorTipo: "admin",
      clerkId,
      autorNome,
      registradoEm: Date.now(),
    });
    gerados++;
  }
  return gerados;
}
