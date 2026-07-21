import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { exigirSessaoOperador, exigirPermissao } from "../lib/auth";
import {
  contagemAtivaDaCamara,
  fecharContagemComItens,
} from "../lib/contagem";

/*
  Contagem física pelo colaborador (RF46–RF50). CONTAGEM ÀS CEGAS: nenhuma query
  aqui devolve o saldo do sistema ao cliente (RF48). A lista de itens a contar é o
  grid de produtos/formatos da câmara, sem saldo — o mesmo que o lançamento usa.
*/

// Estado da contagem para a tela do operador: se há uma contagem aberta por ELE
// nesta câmara (para retomar), ou pendente/de outra pessoa (para avisar). Nunca
// devolve saldo do sistema.
export const estado = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, token);
    const ativa = await contagemAtivaDaCamara(ctx, camara._id);
    if (ativa === null) return { situacao: "nenhuma" as const };

    if (ativa.status === "pendente") {
      return { situacao: "pendente" as const };
    }
    // aberta
    const minha = ativa.abertaPorTipo === "operador" && ativa.operadorId === operador._id;
    return minha
      ? { situacao: "minha" as const, contagemId: ativa._id }
      : { situacao: "de_outro" as const };
  },
});

// Abre uma contagem para a câmara da sessão (RF46). Rejeita se já houver aberta
// ou pendente de outra pessoa (RF47). Se o próprio operador já tem uma aberta,
// devolve-a (retomar), em vez de criar outra.
export const abrir = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, token);
    exigirPermissao(operador, "contar");

    const ativa = await contagemAtivaDaCamara(ctx, camara._id);
    if (ativa !== null) {
      if (
        ativa.status === "aberta" &&
        ativa.abertaPorTipo === "operador" &&
        ativa.operadorId === operador._id
      ) {
        return { contagemId: ativa._id, retomada: true };
      }
      throw new ConvexError("Já existe uma contagem em andamento nesta câmara.");
    }

    const contagemId = await ctx.db.insert("contagens", {
      camaraId: camara._id,
      status: "aberta",
      abertaPorTipo: "operador",
      operadorId: operador._id,
    });
    return { contagemId, retomada: false };
  },
});

// Fecha a contagem: recebe o contado por formato, congela o saldo do sistema e
// calcula a divergência (RF49, RF50). Só o operador que abriu pode fechar.
export const fechar = mutation({
  args: {
    token: v.string(),
    contagemId: v.id("contagens"),
    itens: v.array(
      v.object({
        produtoId: v.id("produtos"),
        formatoId: v.id("formatos"),
        saldoContado: v.number(),
      }),
    ),
  },
  handler: async (ctx, { token, contagemId, itens }) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, token);
    exigirPermissao(operador, "contar");

    const contagem = await ctx.db.get(contagemId);
    if (
      contagem === null ||
      contagem.camaraId !== camara._id ||
      contagem.abertaPorTipo !== "operador" ||
      contagem.operadorId !== operador._id
    ) {
      throw new ConvexError("Contagem inválida para esta sessão.");
    }

    await fecharContagemComItens(ctx, contagem, itens);
    return { ok: true };
  },
});
