import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { exigirAdmin } from "../lib/auth";
import {
  contagemAtivaDaCamara,
  fecharContagemComItens,
  gerarAjustesDaContagem,
} from "../lib/contagem";

/*
  Contagem física — lado do Admin (RF51–RF56). O Admin também pode ABRIR e contar
  (RF46). E é o único que decide: aprovar gera ajuste; rejeitar não mexe no ledger.
  Regra crítica RF52: quem abriu NÃO decide — inclusive quando um Admin abre e
  outro Admin decide, comparamos o clerkId.
*/

// Lista de itens a contar de uma câmara (produtos + formatos ativos), SEM saldo
// do sistema — contagem às cegas também vale para o Admin (RF48).
export const itensParaContagem = query({
  args: { camaraId: v.id("camaras") },
  handler: async (ctx, { camaraId }) => {
    await exigirAdmin(ctx);
    const produtos = await ctx.db
      .query("produtos")
      .withIndex("by_camara", (q) => q.eq("camaraId", camaraId))
      .collect();

    const ativos = produtos.filter((p) => p.ativo);
    return await Promise.all(
      ativos.map(async (p) => {
        const formatos = await ctx.db
          .query("formatos")
          .withIndex("by_produto", (q) => q.eq("produtoId", p._id))
          .collect();
        return {
          _id: p._id,
          nome: p.nome,
          formatos: formatos
            .filter((f) => f.ativo)
            .map((f) => ({
              _id: f._id,
              nome: f.nome,
              pesoKg: f.pesoKg,
              pesoVariavel: f.pesoVariavel,
              unidadesPorPacote: f.unidadesPorPacote ?? null,
              unidadeContagem: f.unidadeContagem ?? "pacote",
            })),
        };
      }),
    );
  },
});

// Abre uma contagem para uma câmara escolhida pelo Admin (RF46). Rejeita se já
// houver aberta/pendente (RF47).
export const abrir = mutation({
  args: { camaraId: v.id("camaras") },
  handler: async (ctx, { camaraId }) => {
    const usuario = await exigirAdmin(ctx);
    const camara = await ctx.db.get(camaraId);
    if (camara === null) throw new ConvexError("Câmara não encontrada.");

    const ativa = await contagemAtivaDaCamara(ctx, camaraId);
    if (ativa !== null) {
      throw new ConvexError("Já existe uma contagem em andamento nesta câmara.");
    }

    const contagemId = await ctx.db.insert("contagens", {
      camaraId,
      status: "aberta",
      abertaPorTipo: "admin",
      abertaPorClerkId: usuario.clerkId,
    });
    return { contagemId };
  },
});

// Fecha uma contagem aberta pelo Admin: congela saldo e calcula divergência.
export const fechar = mutation({
  args: {
    contagemId: v.id("contagens"),
    itens: v.array(
      v.object({
        produtoId: v.id("produtos"),
        formatoId: v.id("formatos"),
        saldoContado: v.number(),
      }),
    ),
  },
  handler: async (ctx, { contagemId, itens }) => {
    const usuario = await exigirAdmin(ctx);
    const contagem = await ctx.db.get(contagemId);
    if (
      contagem === null ||
      contagem.abertaPorTipo !== "admin" ||
      contagem.abertaPorClerkId !== usuario.clerkId
    ) {
      throw new ConvexError("Contagem inválida.");
    }
    await fecharContagemComItens(ctx, contagem, itens);
    return { ok: true };
  },
});

// Contagens pendentes de decisão (RF60). Também informa quem abriu, para o Admin
// saber se PODE decidir esta (RF52).
export const pendentes = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    const lista = await ctx.db
      .query("contagens")
      .withIndex("by_status", (q) => q.eq("status", "pendente"))
      .collect();

    return await Promise.all(
      lista.map(async (c) => {
        const camara = await ctx.db.get(c.camaraId);
        const operador = c.operadorId ? await ctx.db.get(c.operadorId) : null;
        return {
          _id: c._id,
          camaraNome: camara?.nome ?? "—",
          abertaPorTipo: c.abertaPorTipo,
          abertaPorNome: c.abertaPorTipo === "operador" ? operador?.nome ?? "—" : "Admin",
          abertaPorClerkId: c.abertaPorClerkId ?? null,
          fechadaEm: c.fechadaEm ?? null,
        };
      }),
    );
  },
});

// Contagens ABERTAS (em andamento, ainda não finalizadas) de todas as câmaras.
// Uma contagem aberta bloqueia a câmara (RF47) mas nunca aparece em `pendentes`,
// então sem esta lista uma contagem abandonada trava a câmara sem remédio. Informa
// se ESTE Admin foi quem abriu — só ele pode retomar e finalizar (o saldo de quem
// conta é às cegas, RF48; ninguém finaliza a contagem de outra pessoa).
export const emAndamento = query({
  args: {},
  handler: async (ctx) => {
    const usuario = await exigirAdmin(ctx);
    const lista = await ctx.db
      .query("contagens")
      .withIndex("by_status", (q) => q.eq("status", "aberta"))
      .collect();

    return await Promise.all(
      lista.map(async (c) => {
        const camara = await ctx.db.get(c.camaraId);
        const operador = c.operadorId ? await ctx.db.get(c.operadorId) : null;
        return {
          _id: c._id,
          camaraId: c.camaraId,
          camaraNome: camara?.nome ?? "—",
          abertaPorTipo: c.abertaPorTipo,
          abertaPorNome: c.abertaPorTipo === "operador" ? operador?.nome ?? "—" : "Admin",
          abertaEm: c._creationTime,
          // Só o Admin que abriu pode retomar (o `fechar` exige o mesmo clerkId).
          euAbri: c.abertaPorTipo === "admin" && c.abertaPorClerkId === usuario.clerkId,
        };
      }),
    );
  },
});

// Cancela uma contagem que ficou ABERTA sem ser finalizada, liberando a câmara.
// Seguro por construção: uma contagem aberta/pendente nunca gerou movimentação —
// ajuste só nasce da APROVAÇÃO (RF53/RF55) — então cancelar não desfaz nada no
// ledger. Qualquer Admin pode cancelar (inclusive quem abriu e abandonou); a
// restrição de "quem abre não decide" (RF52) vale só para aprovar/rejeitar, que
// mexem no estoque. Uma contagem `pendente` NÃO pode ser cancelada: tem que ser
// decidida (aprovada ou rejeitada) para o histórico não perder a foto do saldo.
export const cancelar = mutation({
  args: { contagemId: v.id("contagens"), observacao: v.optional(v.string()) },
  handler: async (ctx, { contagemId, observacao }) => {
    const usuario = await exigirAdmin(ctx);
    const contagem = await ctx.db.get(contagemId);
    if (contagem === null) throw new ConvexError("Contagem não encontrada.");
    if (contagem.status !== "aberta") {
      throw new ConvexError(
        "Só dá para cancelar uma contagem em andamento (ainda não finalizada).",
      );
    }
    await ctx.db.patch(contagem._id, {
      status: "cancelada",
      decididaPorClerkId: usuario.clerkId,
      decididaEm: Date.now(),
      observacaoDecisao: observacao?.trim() || undefined,
    });
    return { ok: true };
  },
});

// Peso equivalente da divergência de um item, na mesma conta que
// gerarAjustesDaContagem usa pra gravar o ajuste — mas só pra EXIBIR aqui;
// nunca grava nada (o ajuste real, se houver, já está no ledger).
function pesoDivergencia(divergencia: number, formato: Doc<"formatos">): number {
  return formato.pesoVariavel ? divergencia : divergencia * formato.pesoKg;
}

// Contagens já decididas (aprovada/rejeitada), para a aba Histórico (tarefa 5).
// Mostra a divergência total em PESO (kg) — nunca soma quantidade de formatos
// diferentes (regra arquitetural 6) — e quem decidiu, para auditoria.
export const historico = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);

    const [aprovadas, rejeitadas] = await Promise.all([
      ctx.db.query("contagens").withIndex("by_status", (q) => q.eq("status", "aprovada")).collect(),
      ctx.db.query("contagens").withIndex("by_status", (q) => q.eq("status", "rejeitada")).collect(),
    ]);
    const todas = [...aprovadas, ...rejeitadas].sort(
      (a, b) => (b.decididaEm ?? 0) - (a.decididaEm ?? 0),
    );

    return await Promise.all(
      todas.map(async (c) => {
        const camara = await ctx.db.get(c.camaraId);
        const decidiu = c.decididaPorClerkId
          ? await ctx.db
              .query("usuarios")
              .withIndex("by_clerk_id", (q) => q.eq("clerkId", c.decididaPorClerkId!))
              .first()
          : null;

        const itens = await ctx.db
          .query("contagemItens")
          .withIndex("by_contagem", (q) => q.eq("contagemId", c._id))
          .collect();
        let divergenciaTotalKg = 0;
        for (const it of itens) {
          if (it.divergencia === 0) continue;
          const formato = await ctx.db.get(it.formatoId);
          if (formato === null) continue;
          divergenciaTotalKg += pesoDivergencia(it.divergencia, formato);
        }

        return {
          _id: c._id,
          status: c.status as "aprovada" | "rejeitada",
          camaraNome: camara?.nome ?? "—",
          decididaPorNome: decidiu?.nome ?? "—",
          decididaEm: c.decididaEm ?? null,
          divergenciaTotalKg,
        };
      }),
    );
  },
});

// Comparação item a item de uma contagem (RF51): contado, sistema, divergência.
// Aqui o Admin VÊ o saldo do sistema — o sigilo é só de quem conta (RF48).
export const detalhe = query({
  args: { contagemId: v.id("contagens") },
  handler: async (ctx, { contagemId }) => {
    const usuario = await exigirAdmin(ctx);
    const contagem = await ctx.db.get(contagemId);
    if (contagem === null) throw new ConvexError("Contagem não encontrada.");

    const camara = await ctx.db.get(contagem.camaraId);
    const operador = contagem.operadorId ? await ctx.db.get(contagem.operadorId) : null;

    const itens = await ctx.db
      .query("contagemItens")
      .withIndex("by_contagem", (q) => q.eq("contagemId", contagemId))
      .collect();

    const itensDetalhe = await Promise.all(
      itens.map(async (it) => {
        const produto = await ctx.db.get(it.produtoId);
        const formato = await ctx.db.get(it.formatoId);
        return {
          _id: it._id,
          produtoNome: produto?.nome ?? "—",
          formatoNome: formato?.nome ?? "—",
          formatoPesoKg: formato?.pesoKg ?? 0,
          formatoUnidadesPorPacote: formato?.unidadesPorPacote ?? null,
          formatoUnidadeContagem: formato?.unidadeContagem ?? "pacote",
          pesoVariavel: formato?.pesoVariavel ?? false,
          saldoSistema: it.saldoSistema,
          saldoContado: it.saldoContado,
          divergencia: it.divergencia,
        };
      }),
    );

    // Quem abriu não pode decidir (RF52). O cliente usa isso para esconder os
    // botões; a mutation revalida de qualquer forma.
    const euAbri =
      contagem.abertaPorTipo === "admin" && contagem.abertaPorClerkId === usuario.clerkId;

    return {
      _id: contagem._id,
      status: contagem.status,
      camaraNome: camara?.nome ?? "—",
      abertaPorNome: contagem.abertaPorTipo === "operador" ? operador?.nome ?? "—" : "Admin",
      abertaPorTipo: contagem.abertaPorTipo,
      fechadaEm: contagem.fechadaEm ?? null,
      decididaEm: contagem.decididaEm ?? null,
      observacaoDecisao: contagem.observacaoDecisao ?? null,
      euAbri,
      itens: itensDetalhe,
    };
  },
});

// Garante que a contagem está pendente e que este Admin NÃO foi quem abriu (RF52).
async function exigirDecidivel(
  ctx: MutationCtx,
  contagemId: Id<"contagens">,
  clerkId: string,
) {
  const contagem = await ctx.db.get(contagemId);
  if (contagem === null) throw new ConvexError("Contagem não encontrada.");
  if (contagem.status !== "pendente") {
    throw new ConvexError("Esta contagem não está aguardando decisão.");
  }
  if (contagem.abertaPorTipo === "admin" && contagem.abertaPorClerkId === clerkId) {
    throw new ConvexError("Quem abriu a contagem não pode decidir. Peça a outro Admin.");
  }
  return contagem;
}

// Aprovar (RF53): gera ajuste só nos itens com divergência ≠ 0. Ajuste só nasce
// daqui (RF55).
export const aprovar = mutation({
  args: { contagemId: v.id("contagens"), observacao: v.optional(v.string()) },
  handler: async (ctx, { contagemId, observacao }) => {
    const usuario = await exigirAdmin(ctx);
    const contagem = await exigirDecidivel(ctx, contagemId, usuario.clerkId);

    const ajustes = await gerarAjustesDaContagem(ctx, contagem, usuario.clerkId, usuario.nome);

    await ctx.db.patch(contagem._id, {
      status: "aprovada",
      decididaPorClerkId: usuario.clerkId,
      decididaEm: Date.now(),
      observacaoDecisao: observacao?.trim() || undefined,
    });
    return { ok: true, ajustesGerados: ajustes };
  },
});

// Rejeitar (RF54): não gera movimentação nenhuma; o registro permanece.
export const rejeitar = mutation({
  args: { contagemId: v.id("contagens"), observacao: v.optional(v.string()) },
  handler: async (ctx, { contagemId, observacao }) => {
    const usuario = await exigirAdmin(ctx);
    const contagem = await exigirDecidivel(ctx, contagemId, usuario.clerkId);

    await ctx.db.patch(contagem._id, {
      status: "rejeitada",
      decididaPorClerkId: usuario.clerkId,
      decididaEm: Date.now(),
      observacaoDecisao: observacao?.trim() || undefined,
    });
    return { ok: true };
  },
});
