import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { movimentacaoExistente } from "./idempotencia";

/*
  Estorno — mecânica compartilhada entre o Admin (convex/admin/estorno.ts,
  P0 tarefa 6) e o "Desfazer" do colaborador (convex/operador/desfazer.ts,
  sprint PWA tarefa 5). Os dois criam o MESMO tipo de contra-lançamento; o que
  muda é quem pode chamar e sob quais condições extras (o colaborador só
  desfaz o PRÓPRIO lançamento, dentro de 5 minutos).

  DECISÃO: `movimentacoes` continua rigorosamente append-only (regra
  arquitetural 2 — "nenhum ctx.db.patch... em nenhum ponto, para nenhum
  perfil, nem admin"). Por isso NÃO existe campo "estornadoPor" no original.
  "Este lançamento já foi estornado?" é sempre uma leitura pelo índice
  by_estorno_de — a mesma filosofia da regra 1 (nunca cachear o que dá pra
  derivar em leitura).
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
// puder. Usado tanto pela preview do Admin (mostra o bloqueio antes de
// tentar) quanto pelas duas mutations — nunca confia só na UI.
export async function motivoBloqueio(ctx: QueryCtx, original: Doc<"movimentacoes">): Promise<string | null> {
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

export type AutorEstorno =
  | { registradoPorTipo: "admin"; clerkId: string; autorNome: string }
  | { registradoPorTipo: "operador"; operadorId: Id<"operadores">; autorNome: string };

// Grava o contra-lançamento (sinal invertido, mesmo produto/formato/
// quantidade, `estornoDe` apontando pro original). Idempotente pela mesma
// chave determinística `estorno:<id do original>` — chamar duas vezes não
// duplica. NÃO valida bloqueio nem motivo — quem chama já validou
// (motivoBloqueio + mínimo de caracteres), cada caller com suas próprias regras.
export async function inserirEstorno(
  ctx: MutationCtx,
  original: Doc<"movimentacoes">,
  autor: AutorEstorno,
  motivoTexto: string,
): Promise<{ estornoId: Id<"movimentacoes">; duplicado: boolean }> {
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
    motivoTexto,
    registradoPorTipo: autor.registradoPorTipo,
    clerkId: autor.registradoPorTipo === "admin" ? autor.clerkId : undefined,
    operadorId: autor.registradoPorTipo === "operador" ? autor.operadorId : undefined,
    autorNome: autor.autorNome,
    registradoEm: Date.now(),
  });

  return { estornoId, duplicado: false };
}

// Mínimo de 5 caracteres pro motivo — mesma regra em todo lugar que grava
// motivoTexto de estorno (Admin exige digitar; o colaborador usa um motivo
// fixo, que já respeita o mínimo por construção).
export function exigirMotivoValido(motivoTexto: string): string {
  const texto = motivoTexto.trim();
  if (texto.length < 5) {
    throw new ConvexError("Descreva o motivo do estorno (mínimo 5 caracteres).");
  }
  return texto;
}
