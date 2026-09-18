import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";
import { saldoDoFormato, pesoLiquidoDoFormato } from "../lib/saldo";
import {
  motivoBloqueio,
  inserirEstorno,
  exigirMotivoValido,
  motivoBloqueioTransferencia,
  inserirEstornoTransferencia,
} from "../lib/estorno";

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
      formatoPesoKg: formato?.pesoKg ?? 0,
      formatoUnidadesPorPacote: formato?.unidadesPorPacote ?? null,
      formatoUnidadeContagem: formato?.unidadeContagem ?? "pacote",
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

// Preview do estorno de uma transferência inteira (as duas pernas), pelo
// loteId compartilhado — mesmo espírito do `preview` acima, mas mostrando o
// impacto nas DUAS câmaras de uma vez.
export const previewTransferencia = query({
  args: { loteId: v.string() },
  handler: async (ctx, { loteId }) => {
    await exigirAdmin(ctx);
    const pernas = await ctx.db
      .query("movimentacoes")
      .withIndex("by_lote", (q) => q.eq("loteId", loteId))
      .collect();
    const transferPernas = pernas.filter((p) => p.tipo === "transferencia");
    if (transferPernas.length !== 2) throw new ConvexError("Transferência não encontrada.");

    const bloqueio = await motivoBloqueioTransferencia(ctx, transferPernas);

    const detalhe = await Promise.all(
      transferPernas.map(async (perna) => {
        const produto = await ctx.db.get(perna.produtoId);
        const camara = await ctx.db.get(perna.camaraId);
        const formato = await ctx.db.get(perna.formatoId);
        return {
          produtoNome: produto?.nome ?? "—",
          camaraNome: camara?.nome ?? "—",
          formatoNome: formato?.nome ?? "—",
          formatoPesoKg: formato?.pesoKg ?? 0,
          formatoPesoVariavel: formato?.pesoVariavel ?? false,
          formatoUnidadesPorPacote: formato?.unidadesPorPacote ?? null,
          formatoUnidadeContagem: formato?.unidadeContagem ?? "pacote",
          quantidade: perna.quantidade,
          pesoKg: perna.pesoKg,
          sentido: perna.sinal === -1 ? ("origem" as const) : ("destino" as const),
        };
      }),
    );

    return { pernas: detalhe, bloqueio };
  },
});

export const estornarTransferencia = mutation({
  args: { loteId: v.string(), motivoTexto: v.string() },
  handler: async (ctx, { loteId, motivoTexto }) => {
    const usuario = await exigirAdmin(ctx);

    const pernas = await ctx.db
      .query("movimentacoes")
      .withIndex("by_lote", (q) => q.eq("loteId", loteId))
      .collect();
    const transferPernas = pernas.filter((p) => p.tipo === "transferencia");
    if (transferPernas.length !== 2) throw new ConvexError("Transferência não encontrada.");

    const bloqueio = await motivoBloqueioTransferencia(ctx, transferPernas);
    if (bloqueio !== null) throw new ConvexError(bloqueio);

    const texto = exigirMotivoValido(motivoTexto);

    return await inserirEstornoTransferencia(
      ctx,
      transferPernas,
      { registradoPorTipo: "admin", clerkId: usuario.clerkId, autorNome: usuario.nome },
      texto,
    );
  },
});
