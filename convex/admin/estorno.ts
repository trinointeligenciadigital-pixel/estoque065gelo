import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { exigirAdmin } from "../lib/auth";
import { movimentacaoExistente } from "../lib/idempotencia";
import { saldoDoFormato, pesoLiquidoDoFormato } from "../lib/saldo";

/*
  Estorno (tarefa 6 do sprint P0) — corrige um lançamento errado sem virar
  ajuste (que poluiria o histórico e mentiria sobre o que aconteceu: o erro foi
  no LANÇAMENTO, não no estoque físico).

  DECISÃO: `movimentacoes` continua rigorosamente append-only (regra
  arquitetural 2 — "nenhum ctx.db.patch... em nenhum ponto, para nenhum
  perfil, nem admin"). Por isso NÃO existe campo "estornadoPor" no original.
  "Este lançamento já foi estornado?" é sempre uma leitura pelo índice
  by_estorno_de (existe uma movimentação com estornoDe === este._id?) — a
  mesma filosofia da regra 1 (nunca cachear o que dá pra derivar em leitura).
*/

const CUIABA_OFFSET_MS = -4 * 60 * 60 * 1000; // UTC−4, sem horário de verão (RNF15)
function dataHoraCuiaba(ms: number): string {
  const d = new Date(ms + CUIABA_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()} ${hh}:${min}`;
}

// Motivo pelo qual este lançamento NÃO pode ser estornado agora, ou null se
// puder. Usado tanto pela preview (mostra o bloqueio antes de tentar) quanto
// pela mutation (revalida — nunca confia só na UI).
async function motivoBloqueio(ctx: QueryCtx, original: Doc<"movimentacoes">): Promise<string | null> {
  if (original.tipo === "estorno") {
    return "Não é possível estornar um estorno.";
  }
  if (original.tipo === "ajuste") {
    return "Ajuste de contagem não é estornado por aqui — a correção é rejeitar a contagem que o gerou.";
  }

  const jaEstornado = await ctx.db
    .query("movimentacoes")
    .withIndex("by_estorno_de", (q) => q.eq("estornoDe", original._id))
    .first();
  if (jaEstornado !== null) {
    return "Este lançamento já foi estornado.";
  }

  // O saldo já foi reconciliado por uma contagem aprovada depois deste
  // lançamento: estornar agora desmentiria a contagem (o que foi fisicamente
  // contado incluía o efeito deste lançamento). Corrigir por uma nova contagem.
  const contagensDaCamara = await ctx.db
    .query("contagens")
    .withIndex("by_camara", (q) => q.eq("camaraId", original.camaraId))
    .collect();
  const ultimaAprovada = contagensDaCamara
    .filter((c) => c.status === "aprovada" && c.decididaEm !== undefined)
    .sort((a, b) => b.decididaEm! - a.decididaEm!)[0];
  if (ultimaAprovada !== undefined && original.registradoEm < ultimaAprovada.decididaEm!) {
    return `Este lançamento é anterior à contagem aprovada em ${dataHoraCuiaba(ultimaAprovada.decididaEm!)}. O saldo já foi reconciliado — corrija por uma nova contagem.`;
  }

  return null;
}

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

    const texto = motivoTexto.trim();
    if (texto.length < 5) {
      throw new ConvexError("Descreva o motivo do estorno (mínimo 5 caracteres).");
    }

    const chaveIdempotencia = `estorno:${original._id}`;
    const existente = await movimentacaoExistente(ctx, chaveIdempotencia);
    if (existente !== null) return { estornoId: existente._id, duplicado: true };

    const sinal = original.sinal === 1 ? (-1 as const) : (1 as const);

    // "Recalcula o saldo": não há nada a fazer além deste insert — o saldo
    // nunca é cacheado (regra arquitetural 1), toda leitura soma o ledger
    // inteiro, então a reversão já é o recálculo.
    const estornoId = await ctx.db.insert("movimentacoes", {
      chaveIdempotencia,
      tipo: "estorno",
      sinal,
      produtoId: original.produtoId,
      camaraId: original.camaraId,
      formatoId: original.formatoId,
      quantidade: original.quantidade,
      pesoKg: original.pesoKg,
      estornoDe: original._id,
      motivoTexto: texto,
      registradoPorTipo: "admin",
      clerkId: usuario.clerkId,
      autorNome: usuario.nome,
      registradoEm: Date.now(),
    });

    return { estornoId, duplicado: false };
  },
});
