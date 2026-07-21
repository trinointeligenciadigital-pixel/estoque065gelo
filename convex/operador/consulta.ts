import { v } from "convex/values";
import { query } from "../_generated/server";
import { exigirSessaoOperador } from "../lib/auth";
import { saldoDoFormato, pesoTotalDoProduto } from "../lib/saldo";

/*
  Consultas do colaborador — todas presas à câmara da sessão. O operador só
  enxerga a própria câmara (RF27, RF64). Nada aqui gera movimentação.
*/

// Grid de produtos ativos da câmara + formatos ativos, para os lançamentos
// (RF27). SEM saldo — o saldo só aparece na tela "Ver saldo".
export const gridProdutos = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { camara } = await exigirSessaoOperador(ctx, token);

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
        return {
          _id: p._id,
          nome: p.nome,
          categoria: p.categoria,
          unidadeBase: p.unidadeBase,
          formatos: formatos
            .filter((f) => f.ativo)
            .map((f) => ({ _id: f._id, nome: f.nome, pesoKg: f.pesoKg, pesoVariavel: f.pesoVariavel })),
        };
      }),
    );
  },
});

// "Ver saldo" (RF43, RF45) — leitura pura: saldo por formato e peso total por
// produto, da câmara da sessão. Não altera nada.
export const saldos = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { camara } = await exigirSessaoOperador(ctx, token);

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
              pesoVariavel: f.pesoVariavel,
              saldo: await saldoDoFormato(ctx, p._id, camara._id, f._id),
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
