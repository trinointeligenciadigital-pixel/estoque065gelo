import { v } from "convex/values";
import { query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";

/*
  Histórico de movimentações do Admin (RF61). Somente leitura — não existe nenhuma
  mutation de edição/exclusão de movimentação em lugar nenhum (RF36, RF62). O Admin
  lê tudo, de todas as câmaras (RF64). Filtros: câmara, produto, tipo, período e
  autor. A filtragem é em memória (aceitável no v1); o resultado é limitado.
*/

const LIMITE = 500;

export const listar = query({
  args: {
    camaraId: v.optional(v.id("camaras")),
    produtoId: v.optional(v.id("produtos")),
    tipo: v.optional(
      v.union(
        v.literal("producao"),
        v.literal("venda"),
        v.literal("patrocinio"),
        v.literal("retornoPatrocinio"),
        v.literal("perda"),
        v.literal("ajuste"),
      ),
    ),
    operadorId: v.optional(v.id("operadores")),
    // Filtra por um Admin específico (clerkId), não "qualquer admin" — desde a
    // tarefa 3 o filtro lista pessoas reais, não mais um balde genérico "Admin".
    autorClerkId: v.optional(v.string()),
    de: v.optional(v.number()),
    ate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);

    // Se filtra por câmara, usa o índice; senão varre por data (mais recente).
    const base = args.camaraId
      ? await ctx.db
          .query("movimentacoes")
          .withIndex("by_camara", (q) => q.eq("camaraId", args.camaraId!))
          .collect()
      : await ctx.db.query("movimentacoes").withIndex("by_registrado_em").collect();

    const filtradas = base
      .filter((m) => (args.produtoId ? m.produtoId === args.produtoId : true))
      .filter((m) => (args.tipo ? m.tipo === args.tipo : true))
      .filter((m) => (args.operadorId ? m.operadorId === args.operadorId : true))
      .filter((m) => (args.autorClerkId ? m.clerkId === args.autorClerkId : true))
      .filter((m) => (args.de !== undefined ? m.registradoEm >= args.de : true))
      .filter((m) => (args.ate !== undefined ? m.registradoEm <= args.ate : true))
      .sort((a, b) => b.registradoEm - a.registradoEm)
      .slice(0, LIMITE);

    return await Promise.all(
      filtradas.map(async (m) => {
        const produto = await ctx.db.get(m.produtoId);
        const formato = await ctx.db.get(m.formatoId);
        const camara = await ctx.db.get(m.camaraId);
        const operador = m.operadorId ? await ctx.db.get(m.operadorId) : null;
        // Veículo para o comprovante: próprio (placa · modelo) ou terceiro (texto).
        const veiculoProprio = m.veiculoId ? await ctx.db.get(m.veiculoId) : null;
        const veiculo = veiculoProprio
          ? `${veiculoProprio.placa}${veiculoProprio.modelo ? ` · ${veiculoProprio.modelo}` : ""}`
          : m.veiculoTerceiro ?? null;
        return {
          _id: m._id,
          tipo: m.tipo,
          sinal: m.sinal,
          produtoNome: produto?.nome ?? "—",
          formatoNome: formato?.nome ?? "—",
          formatoPesoVariavel: formato?.pesoVariavel ?? false,
          camaraNome: camara?.nome ?? "—",
          quantidade: m.quantidade,
          pesoKg: m.pesoKg,
          clienteNome: m.clienteNome ?? null,
          veiculo,
          motorista: m.motorista ?? null,
          motivoPerda: m.motivoPerda ?? null,
          observacao: m.observacao ?? null,
          // autorNome é o snapshot da tarefa 3; registros pré-migração ainda
          // sem ele caem no mesmo cálculo que o Histórico já fazia antes.
          autor:
            m.autorNome ??
            (m.registradoPorTipo === "operador" ? operador?.nome ?? "—" : "Admin (registro anterior)"),
          autorTipo: m.registradoPorTipo,
          registradoEm: m.registradoEm,
          // Agrupador do carregamento (venda/patrocínio multi-produto). Linhas
          // antigas/avulsas vêm null e seguem como comprovante de 1 item.
          carregamentoId: m.carregamentoId ?? null,
          // Protocolo do comprovante: 8 chars da chave de idempotência (UUID do
          // cliente), nunca o _id interno (RNF13). Num carregamento, o front usa
          // os 8 chars do carregamentoId para todas as linhas do grupo.
          protocolo: m.chaveIdempotencia.slice(0, 8).toUpperCase(),
        };
      }),
    );
  },
});

// Listas para preencher os seletores de filtro.
export const opcoesFiltro = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    const camaras = await ctx.db.query("camaras").collect();
    const produtos = await ctx.db.query("produtos").collect();
    const operadores = await ctx.db.query("operadores").collect();
    const admins = await ctx.db.query("usuarios").collect();
    return {
      camaras: camaras.map((c) => ({ _id: c._id, nome: c.nome })),
      produtos: produtos.map((p) => ({ _id: p._id, nome: p.nome, camaraId: p.camaraId })),
      operadores: operadores.map((o) => ({ _id: o._id, nome: o.nome })),
      // Filtro "Autor" lista pessoas reais (tarefa 3) — inclui inativos porque
      // lançamentos antigos de um Admin desativado continuam no Histórico.
      admins: admins.map((a) => ({ clerkId: a.clerkId, nome: a.nome })),
    };
  },
});
