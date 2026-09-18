import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";
import { rotuloPlacaOuTexto } from "../lib/placa";
import type { Doc } from "../_generated/dataModel";

/*
  Histórico de movimentações do Admin (RF61). Somente leitura — não existe nenhuma
  mutation de edição/exclusão de movimentação em lugar nenhum (RF36, RF62). O Admin
  lê tudo, de todas as câmaras (RF64). Filtros: câmara, produto, tipo, período e
  autor.

  Paginação real (auditoria de paginação): a base é sempre o índice
  by_registrado_em (mais recente primeiro), com `de`/`ate` como intervalo do
  próprio índice — não um `.collect()` de tabela inteira filtrado em memória
  como antes. Os demais filtros (câmara, produto, tipo, operador, autor,
  contagem) entram como `.filter()` do Convex sobre esse índice, antes do
  `.paginate()`. Câmara deixou de ter índice dedicado aqui de propósito: com
  uma fábrica só, poucas câmaras, o corte por data já limita o quanto o
  `.filter()` precisa varrer — e assim a ordenação por data fica sempre
  correta entre páginas, o que um índice separado por câmara não garantia.
*/

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
    // ajuste e estorno) pode ser localizado por ele. É uma busca direta pelo
    // índice dedicado, sempre poucos resultados — não passa pelo paginate.
    protocolo: v.optional(v.string()),
    de: v.optional(v.number()),
    ate: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await exigirAdmin(ctx);

    const buscaProtocolo = args.protocolo?.trim().toUpperCase() || undefined;

    // Os filtros que não são o intervalo de data ficam num predicado só,
    // reaproveitado tanto na busca por protocolo (em memória — poucos
    // resultados) quanto na consulta paginada (em Convex .filter()).
    function combina(
      m: Pick<Doc<"movimentacoes">, "camaraId" | "produtoId" | "tipo" | "operadorId" | "clerkId" | "contagemId">,
    ): boolean {
      return (
        (!args.camaraId || m.camaraId === args.camaraId) &&
        (!args.produtoId || m.produtoId === args.produtoId) &&
        (!args.tipo || m.tipo === args.tipo) &&
        (!args.operadorId || m.operadorId === args.operadorId) &&
        (!args.autorClerkId || m.clerkId === args.autorClerkId) &&
        (!args.contagemId || m.contagemId === args.contagemId)
      );
    }

    let page: Doc<"movimentacoes">[];
    let isDone: boolean;
    let continueCursor: string;

    if (buscaProtocolo) {
      const achados = await ctx.db
        .query("movimentacoes")
        .withIndex("by_protocolo", (q) => q.eq("protocolo", buscaProtocolo))
        .collect();
      page = achados.filter(combina);
      isDone = true;
      continueCursor = "";
    } else {
      let consulta = ctx.db
        .query("movimentacoes")
        .withIndex("by_registrado_em", (q) => {
          if (args.de !== undefined && args.ate !== undefined) {
            return q.gte("registradoEm", args.de).lte("registradoEm", args.ate);
          }
          if (args.de !== undefined) return q.gte("registradoEm", args.de);
          if (args.ate !== undefined) return q.lte("registradoEm", args.ate);
          return q;
        })
        .order("desc");

      if (args.camaraId || args.produtoId || args.tipo || args.operadorId || args.autorClerkId || args.contagemId) {
        consulta = consulta.filter((q) =>
          q.and(
            ...(args.camaraId ? [q.eq(q.field("camaraId"), args.camaraId)] : []),
            ...(args.produtoId ? [q.eq(q.field("produtoId"), args.produtoId)] : []),
            ...(args.tipo ? [q.eq(q.field("tipo"), args.tipo)] : []),
            ...(args.operadorId ? [q.eq(q.field("operadorId"), args.operadorId)] : []),
            ...(args.autorClerkId ? [q.eq(q.field("clerkId"), args.autorClerkId)] : []),
            ...(args.contagemId ? [q.eq(q.field("contagemId"), args.contagemId)] : []),
          ),
        );
      }

      const resultado = await consulta.paginate(args.paginationOpts);
      page = resultado.page;
      isDone = resultado.isDone;
      continueCursor = resultado.continueCursor;
    }

    const linhas = await Promise.all(
      page.map(async (m) => {
        // "Este lançamento já foi estornado?" nunca é um campo cacheado (regra
        // arquitetural 1/2 — movimentacoes é append-only, sem patch): é sempre
        // esta leitura, pelo índice by_estorno_de — um lookup pontual por
        // linha, não mais uma varredura de todos os estornos já registrados.
        const produto = await ctx.db.get(m.produtoId);
        const formato = await ctx.db.get(m.formatoId);
        const camara = await ctx.db.get(m.camaraId);
        const operador = m.operadorId ? await ctx.db.get(m.operadorId) : null;
        // Veículo para o comprovante: próprio (placa · modelo) ou terceiro
        // (placa normalizada com máscara de exibição + modelo, marcado como
        // terceiro — tarefa 3). Registro anterior a esta correção pode ter
        // texto livre que não é placa nenhuma; rotuloPlacaOuTexto devolve
        // como veio, sem inventar uma placa que não existe.
        const estorno = await ctx.db
          .query("movimentacoes")
          .withIndex("by_estorno_de", (q) => q.eq("estornoDe", m._id))
          .first();
        const veiculoProprio = m.veiculoId ? await ctx.db.get(m.veiculoId) : null;
        const veiculo = veiculoProprio
          ? `${veiculoProprio.placa}${veiculoProprio.modelo ? ` · ${veiculoProprio.modelo}` : ""}`
          : m.veiculoTerceiro
            ? `${rotuloPlacaOuTexto(m.veiculoTerceiro)} (terceiro)${m.veiculoTerceiroModelo ? ` · ${m.veiculoTerceiroModelo}` : ""}`
            : null;
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
          formatoUnidadeContagem: formato?.unidadeContagem ?? "pacote",
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
          estornado: estorno !== null,
          estornoDeProtocolo: original ? (original.protocolo ?? original.chaveIdempotencia.slice(0, 8).toUpperCase()) : null,
          // Protocolo (tarefa 4 do adendo): campo próprio, nunca o _id interno
          // (RNF13). Registro anterior a este campo cai no cálculo antigo (8
          // chars da chaveIdempotencia) só pra nunca ficar em branco — a
          // migração migrarProtocoloLegado preenche todo mundo de verdade.
          protocolo: m.protocolo ?? m.chaveIdempotencia.slice(0, 8).toUpperCase(),
          // Número sequencial do comprovante (só carregamento tem — ver schema.ts).
          numeroComprovante: m.numeroComprovante ?? null,
        };
      }),
    );

    return { page: linhas, isDone, continueCursor };
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
