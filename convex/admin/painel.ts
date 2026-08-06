import { v } from "convex/values";
import { query } from "../_generated/server";
import { exigirAdmin } from "../lib/auth";
import {
  saldoDoFormato,
  pesoLiquidoDoFormato,
  pesoTotalDoProduto,
} from "../lib/saldo";
import { inicioDoDiaCuiaba } from "../lib/data";

/*
  Painel do Admin (RF57–RF60). Regra crítica RF57: o saldo de cada produto agrega
  os formatos POR PESO (kg), nunca somando quantidades de formatos diferentes.

  Estoque mínimo (RF59): é POR FORMATO (por tamanho de pacote). Cada formato compara
  o próprio saldo, na própria unidade (pacotes no normal, kg no de peso variável),
  com o próprio mínimo. Nunca se soma tamanhos diferentes. Mínimo 0/ausente = sem
  alerta. O badge conta formatos abaixo do mínimo.
*/
const DIA_MS = 24 * 60 * 60 * 1000;

/*
  Movimento por período (Fase 2/3 do Painel). LEITURA apenas — soma o ledger por
  dia, no fuso de Cuiabá, sem tocar em nada. Alimenta o filtro de período (KPIs de
  fluxo) e o gráfico de tendência Produção × Saídas.

  A soma é idêntica à do `resumo` de hoje, para os números baterem entre si:
    Produção = tipo "producao"
    Saídas   = tipo "venda" | "patrocinio" | "perda"
  (retornoPatrocinio e ajuste ficam de fora dos dois, como no resumo.)

  Devolve um bucket por dia, incluindo dias com zero, para o gráfico ter um eixo
  contínuo. `dia` é o início do dia local (em ms UTC), do mais antigo ao mais novo.
*/
export const movimentoPorPeriodo = query({
  args: { dias: v.number() },
  handler: async (ctx, { dias }) => {
    await exigirAdmin(ctx);

    // Só 1, 7 ou 30 dias — evita varredura arbitrária vinda do cliente.
    const n = dias <= 1 ? 1 : dias <= 7 ? 7 : 30;

    const agora = Date.now();
    const inicioHoje = inicioDoDiaCuiaba(agora);
    // Início da janela: começo do dia, n-1 dias atrás (inclui hoje). Offset fixo
    // (UTC−4, sem horário de verão), então subtrair DIA_MS mantém o alinhamento.
    const inicioJanela = inicioHoje - (n - 1) * DIA_MS;

    const movs = await ctx.db
      .query("movimentacoes")
      .withIndex("by_registrado_em", (q) => q.gte("registradoEm", inicioJanela))
      .collect();

    // Buckets: um por dia, do mais antigo ao mais novo, zerados.
    const buckets = new Map<number, { producaoKg: number; saidasKg: number; qtdProducao: number }>();
    for (let i = 0; i < n; i++) {
      buckets.set(inicioHoje - (n - 1 - i) * DIA_MS, { producaoKg: 0, saidasKg: 0, qtdProducao: 0 });
    }

    let producaoKg = 0;
    let saidasKg = 0;
    let qtdLancamentos = 0;
    for (const m of movs) {
      const dia = inicioDoDiaCuiaba(m.registradoEm);
      const b = buckets.get(dia);
      if (!b) continue; // fora da janela (borda)
      if (m.tipo === "producao") {
        b.producaoKg += m.pesoKg;
        b.qtdProducao += 1;
        producaoKg += m.pesoKg;
        qtdLancamentos += 1;
      } else if (m.tipo === "venda" || m.tipo === "patrocinio" || m.tipo === "perda") {
        b.saidasKg += m.pesoKg;
        saidasKg += m.pesoKg;
      }
    }

    const serie = [...buckets.entries()].map(([dia, b]) => ({
      dia,
      producaoKg: b.producaoKg,
      saidasKg: b.saidasKg,
      qtdProducao: b.qtdProducao,
    }));

    return {
      dias: n,
      serie,
      totais: { producaoKg, saidasKg, qtdLancamentos },
    };
  },
});

export const resumo = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);

    const camaras = await ctx.db.query("camaras").collect();
    const nomeCamara = new Map(camaras.map((c) => [c._id, c.nome]));

    const produtos = await ctx.db.query("produtos").collect();
    const ativos = produtos.filter((p) => p.ativo);

    const linhas = await Promise.all(
      ativos.map(async (p) => {
        const formatos = await ctx.db
          .query("formatos")
          .withIndex("by_produto", (q) => q.eq("produtoId", p._id))
          .collect();

        const formatosSaldo = await Promise.all(
          formatos
            .filter((f) => f.ativo)
            .map(async (f) => {
              const saldo = f.pesoVariavel
                ? await pesoLiquidoDoFormato(ctx, p._id, p.camaraId, f._id)
                : await saldoDoFormato(ctx, p._id, p.camaraId, f._id);
              const minimo = f.estoqueMinimo ?? 0;
              return {
                _id: f._id,
                nome: f.nome,
                pesoKg: f.pesoKg,
                pesoVariavel: f.pesoVariavel,
                unidadesPorPacote: f.unidadesPorPacote ?? null,
                saldo,
                estoqueMinimo: minimo,
                abaixoMinimo: minimo > 0 && saldo < minimo,
              };
            }),
        );

        const pesoTotalKg = await pesoTotalDoProduto(ctx, p._id, p.camaraId);

        return {
          _id: p._id,
          nome: p.nome,
          categoria: p.categoria,
          camaraId: p.camaraId,
          camaraNome: nomeCamara.get(p.camaraId) ?? "—",
          unidadeBase: p.unidadeBase,
          pesoTotalKg,
          abaixoMinimo: formatosSaldo.some((f) => f.abaixoMinimo),
          formatos: formatosSaldo,
        };
      }),
    );

    // Agregado por categoria, por peso (RF58). Correção "pacote prevalece, quilo
    // agrega": pacote só aparece aqui quando a categoria tem exatamente UM
    // formato ativo no total (entre todos os produtos dela) — é a única situação
    // em que "pacotes" não está misturando tamanhos diferentes. Com dois ou mais
    // formatos ativos (ou o único sendo de peso variável), fica só o peso.
    const porCategoria = new Map<string, number>();
    const formatosPorCategoria = new Map<string, { pesoVariavel: boolean; saldo: number }[]>();
    for (const l of linhas) {
      porCategoria.set(l.categoria, (porCategoria.get(l.categoria) ?? 0) + l.pesoTotalKg);
      const lista = formatosPorCategoria.get(l.categoria) ?? [];
      for (const f of l.formatos) lista.push({ pesoVariavel: f.pesoVariavel, saldo: f.saldo });
      formatosPorCategoria.set(l.categoria, lista);
    }

    const pendentes = await ctx.db
      .query("contagens")
      .withIndex("by_status", (q) => q.eq("status", "pendente"))
      .collect();

    // Badge (RF59): conta FORMATOS abaixo do mínimo, não produtos.
    const qtdAbaixoMinimo = linhas.reduce(
      (acc, l) => acc + l.formatos.filter((f) => f.abaixoMinimo).length,
      0,
    );

    // KPIs e listas de movimentação. Uma janela de 30 dias cobre "hoje" e as
    // saídas recentes numa varredura só.
    const agora = Date.now();
    const inicioHoje = inicioDoDiaCuiaba(agora);
    const janela = await ctx.db
      .query("movimentacoes")
      .withIndex("by_registrado_em", (q) => q.gte("registradoEm", agora - 30 * DIA_MS))
      .collect();

    const nomeProduto = new Map(produtos.map((p) => [p._id, p.nome]));
    const formatosAll = await ctx.db.query("formatos").collect();
    const formatoPorId = new Map(formatosAll.map((f) => [f._id, f]));
    const operadoresAll = await ctx.db.query("operadores").collect();
    const nomeOperador = new Map(operadoresAll.map((o) => [o._id, o.nome]));
    const veiculosAll = await ctx.db.query("veiculos").collect();
    const placaVeiculo = new Map(veiculosAll.map((v) => [v._id, v.placa]));

    const autorDe = (m: (typeof janela)[number]) =>
      m.registradoPorTipo === "operador" ? nomeOperador.get(m.operadorId!) ?? "—" : "Admin";

    let produzidoHojeKg = 0;
    let saidasHojeKg = 0;
    const producaoHojeMovs: typeof janela = [];
    for (const m of janela) {
      if (m.registradoEm < inicioHoje) continue;
      if (m.tipo === "producao") {
        produzidoHojeKg += m.pesoKg;
        producaoHojeMovs.push(m);
      } else if (m.tipo === "venda" || m.tipo === "patrocinio" || m.tipo === "perda") {
        saidasHojeKg += m.pesoKg;
      }
    }

    const producaoHoje = producaoHojeMovs
      .sort((a, b) => b.registradoEm - a.registradoEm)
      .slice(0, 8)
      .map((m) => ({
        produtoNome: nomeProduto.get(m.produtoId) ?? "—",
        formatoNome: formatoPorId.get(m.formatoId)?.nome ?? "—",
        formatoPesoKg: formatoPorId.get(m.formatoId)?.pesoKg ?? 0,
        formatoPesoVariavel: formatoPorId.get(m.formatoId)?.pesoVariavel ?? false,
        formatoUnidadesPorPacote: formatoPorId.get(m.formatoId)?.unidadesPorPacote ?? null,
        autor: autorDe(m),
        quantidade: m.quantidade,
        pesoKg: m.pesoKg,
        registradoEm: m.registradoEm,
      }));

    const saidasRecentes = janela
      .filter((m) => m.tipo === "venda" || m.tipo === "patrocinio" || m.tipo === "perda")
      .sort((a, b) => b.registradoEm - a.registradoEm)
      .slice(0, 6)
      .map((m) => ({
        tipo: m.tipo,
        clienteNome: m.clienteNome ?? null,
        motivoPerda: m.motivoPerda ?? null,
        produtoNome: nomeProduto.get(m.produtoId) ?? "—",
        formatoNome: formatoPorId.get(m.formatoId)?.nome ?? "—",
        formatoPesoKg: formatoPorId.get(m.formatoId)?.pesoKg ?? 0,
        formatoPesoVariavel: formatoPorId.get(m.formatoId)?.pesoVariavel ?? false,
        formatoUnidadesPorPacote: formatoPorId.get(m.formatoId)?.unidadesPorPacote ?? null,
        veiculo: m.veiculoId
          ? placaVeiculo.get(m.veiculoId) ?? "—"
          : m.veiculoTerceiro
            ? "Terceiro"
            : "—",
        pesoKg: m.pesoKg,
        registradoEm: m.registradoEm,
      }));

    const estoqueTotalKg = linhas.reduce((acc, l) => acc + l.pesoTotalKg, 0);

    return {
      produtos: linhas,
      porCategoria: [...porCategoria.entries()].map(([categoria, pesoKg]) => {
        const formatosDaCategoria = formatosPorCategoria.get(categoria) ?? [];
        const pacotes =
          formatosDaCategoria.length === 1 && !formatosDaCategoria[0].pesoVariavel
            ? formatosDaCategoria[0].saldo
            : null;
        return { categoria, pesoKg, pacotes };
      }),
      qtdAbaixoMinimo,
      qtdContagensPendentes: pendentes.length,
      kpis: {
        produzidoHojeKg,
        saidasHojeKg,
        estoqueTotalKg,
        qtdLancamentosHoje: producaoHojeMovs.length,
      },
      producaoHoje,
      saidasRecentes,
    };
  },
});
