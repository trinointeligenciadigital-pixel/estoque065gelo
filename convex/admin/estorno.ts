import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";
import { saldoDoFormato, pesoLiquidoDoFormato } from "../lib/saldo";
import { motivoBloqueio, inserirEstorno, exigirMotivoValido } from "../lib/estorno";

/*
  Estorno do Admin (P0, tarefa 6) — corrige um lançamento errado sem virar
  ajuste (que poluiria o histórico e mentiria sobre o que aconteceu: o erro foi
  no LANÇAMENTO, não no estoque físico). Mecânica em convex/lib/estorno.ts,
  compartilhada com o "Desfazer" do colaborador (sprint PWA, tarefa 5).
*/

// Resumo do impacto, para o modal de confirmação mostrar ANTES de estornar:
// produto/formato, quanto o estorno muda (sinal invertido do original) e o
// saldo que vai resultar. Também revela o bloqueio, se houver, pra UI desabilitar
// o botão de confirmar em vez de deixar o Admin descobrir só depois de tentar.
export const preview = query({
  args: { lancamentoId: v.id("movimentacoes") },
  handler: async (ctx, { lancamentoId }) => {
    await exigirAdmin(ctx);
    const original = await ctx.db.get(lancamentoId);
    if (original === null) throw new ConvexError("Lançamento não encontrado.");

    const produto = await ctx.db.get(original.produtoId);
    const formato = await ctx.db.get(original.formatoId);
    const camara = await ctx.db.get(original.camaraId);
    const pesoVariavel = formato?.pesoVariavel ?? false;

    const bloqueio = await motivoBloqueio(ctx, original);

    const sinalEstorno = original.sinal === 1 ? -1 : 1;
    const saldoAtual = pesoVariavel
      ? await pesoLiquidoDoFormato(ctx, original.produtoId, original.camaraId, original.formatoId)
      : await saldoDoFormato(ctx, original.produtoId, original.camaraId, original.formatoId);
    const impactoQuantidade = sinalEstorno * original.quantidade;
    const impactoPesoKg = sinalEstorno * original.pesoKg;
    const saldoDepois = saldoAtual + (pesoVariavel ? impactoPesoKg : impactoQuantidade);

    return {
      produtoNome: produto?.nome ?? "—",
      formatoNome: formato?.nome ?? "—",
      camaraNome: camara?.nome ?? "—",
      pesoVariavel,
      impactoQuantidade,
      impactoPesoKg,
      saldoDepois,
      bloqueio,
    };
  },
});

export const estornar = mutation({
  args: {
    lancamentoId: v.id("movimentacoes"),
    motivoTexto: v.string(),
  },
  handler: async (ctx, { lancamentoId, motivoTexto }) => {
    const usuario = await exigirAdmin(ctx);

    const original = await ctx.db.get(lancamentoId);
    if (original === null) throw new ConvexError("Lançamento não encontrado.");

    const bloqueio = await motivoBloqueio(ctx, original);
    if (bloqueio !== null) throw new ConvexError(bloqueio);

    const texto = exigirMotivoValido(motivoTexto);

    return await inserirEstorno(
      ctx,
      original,
      { registradoPorTipo: "admin", clerkId: usuario.clerkId, autorNome: usuario.nome },
      texto,
    );
  },
});
