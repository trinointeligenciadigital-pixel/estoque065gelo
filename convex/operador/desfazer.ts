import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation } from "../_generated/server";
import { exigirSessaoOperador } from "../lib/auth";
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
    const { operador, camara } = await exigirSessaoOperador(ctx, token);

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
