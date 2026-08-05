import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { exigirSessaoOperador, exigirCamaraDoProduto } from "../lib/auth";
import { saldoDoFormato, pesoTotalDoProduto, pesoLiquidoDoFormato } from "../lib/saldo";
import { contagemAtivaDaCamara } from "../lib/contagem";

// Contagem cega (sprint PWA, tarefa 1): enquanto ESTE colaborador tiver uma
// contagem aberta NESTA câmara, nenhuma query devolve o saldo esperado — o
// esconderijo é no servidor, não no JSX, porque o dado trafegando aparece no
// cache do React Query e nas devtools mesmo que a tela não o desenhe.
async function contagemMinhaAberta(
  ctx: QueryCtx,
  camaraId: Id<"camaras">,
  operadorId: Id<"operadores">,
): Promise<boolean> {
  const ativa = await contagemAtivaDaCamara(ctx, camaraId);
  return (
    ativa !== null &&
    ativa.status === "aberta" &&
    ativa.abertaPorTipo === "operador" &&
    ativa.operadorId === operadorId
  );
}

/*
  Consultas do colaborador — todas presas à câmara da sessão. O operador só
  enxerga a própria câmara (RF27, RF64). Nada aqui gera movimentação.
*/

// Grid de produtos ativos da câmara + formatos ativos, para os lançamentos
// (RF27). Inclui o saldo do produto (tarefa 3 do sprint PWA) — em pacotes
// quando há um único formato ativo (a unidade que a lista pode mostrar sem
// ambiguidade); em peso quando há mais de um formato, porque somar "pacotes"
// de tamanhos diferentes violaria a regra de agregação por peso (regra 6).
// `saldo: null` durante contagem cega (tarefa 1) — mesma proteção de sempre.
export const gridProdutos = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, token);
    const esconderSaldo = await contagemMinhaAberta(ctx, camara._id, operador._id);

    const produtos = await ctx.db
      .query("produtos")
      .withIndex("by_camara", (q) => q.eq("camaraId", camara._id))
      .collect();

    const ativos = produtos.filter((p) => p.ativo);
    return await Promise.all(
      ativos.map(async (p) => {
        const todosFormatos = await ctx.db
          .query("formatos")
          .withIndex("by_produto", (q) => q.eq("produtoId", p._id))
          .collect();
        const formatosAtivos = todosFormatos.filter((f) => f.ativo);

        let saldo: { pacotes: number | null; pesoKg: number } | null = null;
        if (!esconderSaldo) {
          if (formatosAtivos.length === 1) {
            const f = formatosAtivos[0];
            const pacotes = f.pesoVariavel ? null : await saldoDoFormato(ctx, p._id, camara._id, f._id);
            const pesoKg = await pesoLiquidoDoFormato(ctx, p._id, camara._id, f._id);
            saldo = { pacotes, pesoKg };
          } else if (formatosAtivos.length > 1) {
            saldo = { pacotes: null, pesoKg: await pesoTotalDoProduto(ctx, p._id, camara._id) };
          }
        }

        return {
          _id: p._id,
          nome: p.nome,
          categoria: p.categoria,
          unidadeBase: p.unidadeBase,
          formatos: formatosAtivos.map((f) => ({
            _id: f._id,
            nome: f.nome,
            pesoKg: f.pesoKg,
            pesoVariavel: f.pesoVariavel,
            unidadesPorPacote: f.unidadesPorPacote ?? null,
          })),
          saldo,
        };
      }),
    );
  },
});

// Os 5 produtos que ESTE colaborador mais lançou NESTA câmara nos últimos 7
// dias (tarefa 3) — bloco "Frequentes" no topo da lista. Exige pelo menos 3
// lançamentos no período; com menos que isso o padrão é ruído, não hábito.
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
export const produtosFrequentes = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, token);
    const desde = Date.now() - SETE_DIAS_MS;

    const movs = await ctx.db
      .query("movimentacoes")
      .withIndex("by_camara", (q) => q.eq("camaraId", camara._id))
      .collect();
    const minhas = movs.filter((m) => m.operadorId === operador._id && m.registradoEm >= desde);
    if (minhas.length < 3) return [];

    const contagem = new Map<Id<"produtos">, number>();
    for (const m of minhas) contagem.set(m.produtoId, (contagem.get(m.produtoId) ?? 0) + 1);

    return [...contagem.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([produtoId]) => produtoId);
  },
});

// "Ver saldo" (RF43, RF45) — leitura pura: saldo por formato e peso total por
// produto, da câmara da sessão. Não altera nada. Devolve `null` (em vez do
// saldo) enquanto este colaborador tiver uma contagem aberta nesta câmara —
// contagem às cegas, tarefa 1 do sprint PWA.
export const saldos = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, token);
    if (await contagemMinhaAberta(ctx, camara._id, operador._id)) return null;

    const produtos = await ctx.db
      .query("produtos")
      .withIndex("by_camara", (q) => q.eq("camaraId", camara._id))
      .collect();

    const ativos = produtos.filter((p) => p.ativo);
    return await Promise.all(
      ativos.map(async (p) => {
        const formatos = await ctx.db
          .query("formatos")
          .withIndex("by_produto", (q) => q.eq("produtoId", p._id))
          .collect();
        const formatosComSaldo = await Promise.all(
          formatos
            .filter((f) => f.ativo)
            .map(async (f) => ({
              _id: f._id,
              nome: f.nome,
              pesoKg: f.pesoKg,
              pesoVariavel: f.pesoVariavel,
              unidadesPorPacote: f.unidadesPorPacote ?? null,
              // Fixo: saldo em pacotes. Variável: o estoque real é o peso líquido
              // (kg), pois "quantidade" ali é sempre 1 e não representa o estoque.
              saldo: await saldoDoFormato(ctx, p._id, camara._id, f._id),
              pesoLiquidoKg: await pesoLiquidoDoFormato(ctx, p._id, camara._id, f._id),
            })),
        );
        return {
          _id: p._id,
          nome: p.nome,
          pesoTotalKg: await pesoTotalDoProduto(ctx, p._id, camara._id),
          formatos: formatosComSaldo,
        };
      }),
    );
  },
});

// Patrocínios com saldo em aberto NAQUELA câmara, para o retorno (RF39). Mostra
// data, produto, formato e quanto ainda falta voltar — o que distingue dois
// patrocínios do mesmo cliente.
export const patrociniosAbertos = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { camara } = await exigirSessaoOperador(ctx, token);

    const movs = await ctx.db
      .query("movimentacoes")
      .withIndex("by_camara", (q) => q.eq("camaraId", camara._id))
      .collect();
    const patrocinios = movs.filter((m) => m.tipo === "patrocinio");

    const resultado = [];
    for (const p of patrocinios) {
      const retornos = await ctx.db
        .query("movimentacoes")
        .withIndex("by_patrocinio_origem", (q) => q.eq("patrocinioOrigemId", p._id))
        .collect();
      const produto = await ctx.db.get(p.produtoId);
      const formato = await ctx.db.get(p.formatoId);
      if (produto === null || formato === null) continue;

      const porPeso = formato.pesoVariavel;
      const saido = porPeso ? p.pesoKg : p.quantidade;
      const retornado = retornos.reduce((acc, r) => acc + (porPeso ? r.pesoKg : r.quantidade), 0);
      const aberto = saido - retornado;
      if (aberto <= 0) continue;

      resultado.push({
        origemId: p._id,
        registradoEm: p.registradoEm,
        produtoNome: produto.nome,
        formatoNome: formato.nome,
        formatoPesoKg: formato.pesoKg,
        formatoUnidadesPorPacote: formato.unidadesPorPacote ?? null,
        formatoPesoVariavel: porPeso,
        clienteNome: p.clienteNome ?? "",
        saido,
        retornado,
        aberto,
        unidade: porPeso ? "kg" : "un",
      });
    }
    resultado.sort((a, b) => b.registradoEm - a.registradoEm);
    return resultado;
  },
});

// Checagem de plausibilidade (tarefa 3 do sprint PWA): a quantidade digitada
// é grande demais pra ser digitação normal? Compara com a média diária dos
// últimos 30 dias DESTE tipo+produto+formato, e com o saldo atual. O cliente
// nunca calcula esses números sozinho — a mensagem de confirmação cita um
// valor real, vindo do servidor, nunca inventado. `null` durante contagem
// cega (mesma proteção da tarefa 1: não vaza saldo nem média nesse período).
const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
export const checarPlausibilidade = query({
  args: {
    token: v.string(),
    produtoId: v.id("produtos"),
    formatoId: v.id("formatos"),
    tipo: v.union(v.literal("producao"), v.literal("venda"), v.literal("patrocinio"), v.literal("perda")),
    quantidade: v.number(), // pacotes, ou kg se o formato for de peso variável
  },
  handler: async (ctx, { token, produtoId, formatoId, tipo, quantidade }) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, token);
    if (await contagemMinhaAberta(ctx, camara._id, operador._id)) return null;

    await exigirCamaraDoProduto(ctx, produtoId, camara._id);
    const formato = await ctx.db.get(formatoId);
    if (formato === null || formato.produtoId !== produtoId) {
      throw new ConvexError("Formato inválido para este produto.");
    }

    const saldoAtual = formato.pesoVariavel
      ? await pesoLiquidoDoFormato(ctx, produtoId, camara._id, formatoId)
      : await saldoDoFormato(ctx, produtoId, camara._id, formatoId);

    const desde = Date.now() - TRINTA_DIAS_MS;
    const doFormato = await ctx.db
      .query("movimentacoes")
      .withIndex("by_produto_camara_formato", (q) =>
        q.eq("produtoId", produtoId).eq("camaraId", camara._id).eq("formatoId", formatoId),
      )
      .collect();
    const doTipo = doFormato.filter((m) => m.tipo === tipo);

    // Só confia na média se já existe lançamento deste tipo de 30+ dias atrás
    // — senão a janela estaria parcialmente vazia e a média sairia baixa
    // demais artificialmente, sinalizando "implausível" o que é só recente.
    const maisAntigo = doTipo.reduce(
      (menor, m) => (menor === null || m.registradoEm < menor ? m.registradoEm : menor),
      null as number | null,
    );
    const temHistorico = maisAntigo !== null && maisAntigo <= desde;

    let mediaDiaria: number | null = null;
    if (temHistorico) {
      const totalRecente = doTipo
        .filter((m) => m.registradoEm >= desde)
        .reduce((acc, m) => acc + (formato.pesoVariavel ? m.pesoKg : m.quantidade), 0);
      mediaDiaria = totalRecente / 30;
    }

    const excedeMedia = mediaDiaria !== null && quantidade > mediaDiaria * 3;
    const excedeSaldo = quantidade > saldoAtual * 5;

    return {
      saldoAtual,
      mediaDiaria,
      precisaConfirmar: excedeMedia || excedeSaldo,
    };
  },
});

// Veículos próprios ativos, para o contexto de venda/patrocínio. Global (não é
// por câmara), mas exige sessão válida.
export const veiculos = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await exigirSessaoOperador(ctx, token);
    const lista = await ctx.db
      .query("veiculos")
      .withIndex("by_ativo", (q) => q.eq("ativo", true))
      .collect();
    return lista.map((v) => ({
      _id: v._id,
      placa: v.placa,
      modelo: v.modelo,
      motoristaPadrao: v.motoristaPadrao,
    }));
  },
});

// Últimas movimentações do próprio operador, na própria câmara, das últimas 24h
// (RF64). Read-only, para conferência rápida na tela.
export const minhasMovimentacoes = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { operador, camara } = await exigirSessaoOperador(ctx, token);
    const limite = Date.now() - 24 * 60 * 60 * 1000;

    const movs = await ctx.db
      .query("movimentacoes")
      .withIndex("by_camara", (q) => q.eq("camaraId", camara._id))
      .collect();

    const minhas = movs
      .filter((m) => m.operadorId === operador._id && m.registradoEm >= limite)
      .sort((a, b) => b.registradoEm - a.registradoEm);

    return await Promise.all(
      minhas.map(async (m) => {
        const produto = await ctx.db.get(m.produtoId);
        const formato = await ctx.db.get(m.formatoId);
        return {
          _id: m._id,
          tipo: m.tipo,
          produtoNome: produto?.nome ?? "—",
          formatoNome: formato?.nome ?? "—",
          quantidade: m.quantidade,
          pesoKg: m.pesoKg,
          registradoEm: m.registradoEm,
          clienteNome: m.clienteNome,
          motivoPerda: m.motivoPerda,
        };
      }),
    );
  },
});
