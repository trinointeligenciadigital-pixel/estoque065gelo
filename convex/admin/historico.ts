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
        v.literal("estorno"),
        v.literal("transferencia"),
      ),
    ),
    operadorId: v.optional(v.id("operadores")),
    // Filtra por um Admin específico (clerkId), não "qualquer admin" — desde a
    // tarefa 3 o filtro lista pessoas reais, não mais um balde genérico "Admin".
    autorClerkId: v.optional(v.string()),
    // Vindo de um link "ver ajustes desta contagem" (aba Histórico de Contagens,
    // tarefa 5). Quando presente, o front não colapsa por loteId — o Admin já
    // pediu para ver justamente as linhas daquela contagem.
    contagemId: v.optional(v.id("contagens")),
    // Busca por protocolo (tarefa 4 do adendo) — qualquer lançamento (inclusive
    // ajuste e estorno) pode ser localizado por ele. Não combina com o LIMITE
    // dos outros filtros: é uma busca direta pelo índice, não uma varredura.
    protocolo: v.optional(v.string()),
    de: v.optional(v.number()),
    ate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);

    const buscaProtocolo = args.protocolo?.trim().toUpperCase() || undefined;

    // Busca por protocolo: pelo índice dedicado, ignora a escolha de índice
    // por câmara/data (o protocolo já é específico o bastante). Sem protocolo,
    // segue como antes — câmara se filtrada, senão por data (mais recente).
    const base = buscaProtocolo
      ? await ctx.db
          .query("movimentacoes")
          .withIndex("by_protocolo", (q) => q.eq("protocolo", buscaProtocolo))
          .collect()
      : args.camaraId
        ? await ctx.db
            .query("movimentacoes")
            .withIndex("by_camara", (q) => q.eq("camaraId", args.camaraId!))
            .collect()
        : await ctx.db.query("movimentacoes").withIndex("by_registrado_em").collect();

    const filtradas = base
      .filter((m) => (args.camaraId ? m.camaraId === args.camaraId : true))
      .filter((m) => (args.produtoId ? m.produtoId === args.produtoId : true))
      .filter((m) => (args.tipo ? m.tipo === args.tipo : true))
      .filter((m) => (args.operadorId ? m.operadorId === args.operadorId : true))
      .filter((m) => (args.autorClerkId ? m.clerkId === args.autorClerkId : true))
      .filter((m) => (args.contagemId ? m.contagemId === args.contagemId : true))
      .filter((m) => (args.de !== undefined ? m.registradoEm >= args.de : true))
      .filter((m) => (args.ate !== undefined ? m.registradoEm <= args.ate : true))
      .sort((a, b) => b.registradoEm - a.registradoEm)
      .slice(0, LIMITE);

    // "Este lançamento já foi estornado?" nunca é um campo cacheado (regra
    // arquitetural 1/2 — movimentacoes é append-only, sem patch) — é sempre
    // esta leitura: existe algum estorno com estornoDe === este _id? Varre
    // TODOS os estornos (não só os desta página), porque o estorno pode estar
    // fora do filtro atual mesmo que o original esteja dentro.
    const todosEstornos = await ctx.db
      .query("movimentacoes")
      .withIndex("by_tipo", (q) => q.eq("tipo", "estorno"))
      .collect();
    const idsEstornados = new Set(
      todosEstornos.map((e) => e.estornoDe).filter((id) => id !== undefined),
    );

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
        // Se ESTA linha é um estorno, busca o protocolo do original pra
        // referenciar ("Estorno de ABCD1234") — o estorno em si não tem
        // motivoPerda/clienteNome, então o Detalhe mostra isto no lugar.
        const original = m.estornoDe ? await ctx.db.get(m.estornoDe) : null;
        return {
          _id: m._id,
          tipo: m.tipo,
          sinal: m.sinal,
          produtoNome: produto?.nome ?? "—",
          formatoNome: formato?.nome ?? "—",
          formatoPesoKg: formato?.pesoKg ?? 0,
          formatoPesoVariavel: formato?.pesoVariavel ?? false,
          formatoUnidadesPorPacote: formato?.unidadesPorPacote ?? null,
          camaraNome: camara?.nome ?? "—",
          quantidade: m.quantidade,
          pesoKg: m.pesoKg,
          clienteNome: m.clienteNome ?? null,
          veiculo,
          motorista: m.motorista ?? null,
          motivoPerda: m.motivoPerda ?? null,
          observacao: m.observacao ?? null,
          motivoCategoria: m.motivoCategoria ?? null,
          motivoTexto: m.motivoTexto ?? null,
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
          // Agrupador dos ajustes de uma mesma aprovação de contagem (tarefa 5).
          // loteInferido=true → lote reconstruído por migração, sem contagemId
          // (não linka pra contagem nenhuma — não dá pra provar o vínculo).
          loteId: m.loteId ?? null,
          loteInferido: m.loteInferido ?? false,
          contagemId: m.contagemId ?? null,
          // Estorno (tarefa 6): `estornado` é derivado (ver acima), nunca lido de
          // um campo — não existe "estornadoPor" gravado em lugar nenhum.
          estornado: idsEstornados.has(m._id),
          estornoDeProtocolo: original ? (original.protocolo ?? original.chaveIdempotencia.slice(0, 8).toUpperCase()) : null,
          // Protocolo (tarefa 4 do adendo): campo próprio, nunca o _id interno
          // (RNF13). Registro anterior a este campo cai no cálculo antigo (8
          // chars da chaveIdempotencia) só pra nunca ficar em branco — a
          // migração migrarProtocoloLegado preenche todo mundo de verdade.
          protocolo: m.protocolo ?? m.chaveIdempotencia.slice(0, 8).toUpperCase(),
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
