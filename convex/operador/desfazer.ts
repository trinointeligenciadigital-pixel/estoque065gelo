import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation } from "../_generated/server";
import { exigirSessaoOperadorMutavel } from "../lib/auth";
import { motivoBloqueio, inserirEstorno } from "../lib/estorno";

/*
  "Desfazer" do colaborador (sprint PWA, tarefa 5) — o mesmo estorno do P0
  (tarefa 6), mas para o próprio autor, numa janela curta, sem precisar
  chamar o Admin. Mecânica compartilhada em convex/lib/estorno.ts.

  DECISÃO (avisada e aprovada antes de implementar): o sprint original pedia
  pra chamar `estornarLancamento` (P0) direto do colaborador, mas essa
  mutation é explicitamente "só Admin" — regra do próprio P0. Em vez de abrir
  uma exceção nela, esta é uma mutation NOVA, com suas próprias travas
  (autor, janela de 5 min) além de reusar o mesmo motivoBloqueio do Admin
  (não estorna ajuste/estorno, não estorna já estornado, não estorna
  lançamento anterior a contagem aprovada).
*/
const JANELA_DESFAZER_MS = 5 * 60 * 1000;

export const desfazerMeuLancamento = mutation({
  args: { token: v.string(), lancamentoId: v.id("movimentacoes") },
  handler: async (ctx, { token, lancamentoId }) => {
    const { operador, camara } = await exigirSessaoOperadorMutavel(ctx, token);

    const original = await ctx.db.get(lancamentoId);
    if (original === null) throw new ConvexError("Lançamento não encontrado.");
    if (original.camaraId !== camara._id) {
      throw new ConvexError("Este lançamento não pertence a esta câmara.");
    }
    if (original.operadorId !== operador._id) {
      throw new ConvexError("Só quem lançou pode desfazer.");
    }
    if (Date.now() - original.registradoEm > JANELA_DESFAZER_MS) {
      throw new ConvexError("O prazo de 5 minutos para desfazer já passou. Peça a um Admin para corrigir.");
    }

    const bloqueio = await motivoBloqueio(ctx, original);
    if (bloqueio !== null) throw new ConvexError(bloqueio);

    return await inserirEstorno(
      ctx,
      original,
      { registradoPorTipo: "operador", operadorId: operador._id, autorNome: operador.nome },
      "desfeito pelo colaborador",
    );
  },
});

/*
  Desfazer um CARREGAMENTO inteiro — venda/patrocínio com vários produtos
  (adendo PWA, tarefa 4). Mesma janela de 5 min de `desfazerMeuLancamento`,
  mais uma trava que ele não tem: se o comprovante já foi enviado por WhatsApp
  ou copiado (marcarComprovanteCompartilhado, abaixo), o desfazer FECHA — o
  comprovante já pode estar na mão do cliente, e um estorno silencioso depois
  disso mentiria pra quem já recebeu o papel. Estorna TODAS as linhas do
  carregamento nesta mesma mutation — atômico: ou o carregamento inteiro
  volta, ou nada volta (não dá pra desfazer meia venda).
*/
export const desfazerMeuCarregamento = mutation({
  args: { token: v.string(), carregamentoId: v.string() },
  handler: async (ctx, { token, carregamentoId }) => {
    const { operador, camara } = await exigirSessaoOperadorMutavel(ctx, token);

    const itens = await ctx.db
      .query("movimentacoes")
      .withIndex("by_carregamento", (q) => q.eq("carregamentoId", carregamentoId))
      .collect();
    if (itens.length === 0) throw new ConvexError("Carregamento não encontrado.");
    for (const item of itens) {
      if (item.camaraId !== camara._id) {
        throw new ConvexError("Este lançamento não pertence a esta câmara.");
      }
      if (item.operadorId !== operador._id) {
        throw new ConvexError("Só quem lançou pode desfazer.");
      }
    }

    // As linhas do mesmo carregamento são gravadas na mesma mutation, quase no
    // mesmo milissegundo — usa a mais antiga pra decidir a janela (a mais
    // rigorosa das duas).
    const maisAntigo = Math.min(...itens.map((i) => i.registradoEm));
    if (Date.now() - maisAntigo > JANELA_DESFAZER_MS) {
      throw new ConvexError("O prazo de 5 minutos para desfazer já passou. Peça a um Admin para corrigir.");
    }

    const compartilhado = await ctx.db
      .query("carregamentosCompartilhados")
      .withIndex("by_carregamento", (q) => q.eq("carregamentoId", carregamentoId))
      .first();
    if (compartilhado !== null) {
      throw new ConvexError("Comprovante já enviado. Para corrigir, procure o administrador.");
    }

    for (const item of itens) {
      const bloqueio = await motivoBloqueio(ctx, item);
      if (bloqueio !== null) throw new ConvexError(bloqueio);
    }

    const estornoIds = [];
    for (const item of itens) {
      const r = await inserirEstorno(
        ctx,
        item,
        { registradoPorTipo: "operador", operadorId: operador._id, autorNome: operador.nome },
        "desfeito pelo colaborador",
      );
      estornoIds.push(r.estornoId);
    }
    return { estornoIds };
  },
});

// Marca que o comprovante deste carregamento foi enviado por WhatsApp ou
// copiado — a partir daqui, `desfazerMeuCarregamento` fecha (ver acima). NUNCA
// um patch no lançamento (regra arquitetural 2): registro à parte, insert-only,
// na tabela `carregamentosCompartilhados`. Chamar de novo não tem efeito
// (idempotente por natureza — "já foi compartilhado?" só olha se existe ALGUM
// registro, não importa quantos).
export const marcarComprovanteCompartilhado = mutation({
  args: { token: v.string(), carregamentoId: v.string() },
  handler: async (ctx, { token, carregamentoId }) => {
    const { operador, camara } = await exigirSessaoOperadorMutavel(ctx, token);

    const itens = await ctx.db
      .query("movimentacoes")
      .withIndex("by_carregamento", (q) => q.eq("carregamentoId", carregamentoId))
      .collect();
    if (itens.length === 0) throw new ConvexError("Carregamento não encontrado.");
    if (itens.some((i) => i.camaraId !== camara._id || i.operadorId !== operador._id)) {
      throw new ConvexError("Este lançamento não pertence a você.");
    }

    const existente = await ctx.db
      .query("carregamentosCompartilhados")
      .withIndex("by_carregamento", (q) => q.eq("carregamentoId", carregamentoId))
      .first();
    if (existente !== null) return { jaMarcado: true };

    await ctx.db.insert("carregamentosCompartilhados", { carregamentoId, compartilhadoEm: Date.now() });
    return { jaMarcado: false };
  },
});
