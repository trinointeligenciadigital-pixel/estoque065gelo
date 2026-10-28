import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { diaCuiaba, inicioDoDiaCuiaba, resolverDataMovimento } from "./lib/data";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const DIA_MS = 24 * 60 * 60 * 1000;

async function comoAdmin(t: ReturnType<typeof convexTest>) {
  await t.run((ctx) =>
    ctx.db.insert("usuarios", {
      clerkId: "clerk_admin",
      nome: "Admin",
      email: "admin@ex.com",
      papel: "admin",
      ativo: true,
    }),
  );
  return t.withIdentity({ subject: "clerk_admin" });
}

async function setup(t: ReturnType<typeof convexTest>) {
  const admin = await comoAdmin(t);
  const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Saborizado" });
  const produtoId = await admin.mutation(api.admin.produtos.criar, {
    nome: "Morango",
    categoria: "saborizado",
    camaraId,
    unidadeBase: "pacote",
  });
  const formatoId = await admin.mutation(api.admin.formatos.criar, {
    produtoId,
    nome: "Saco",
    pesoKg: 2,
    pesoVariavel: false,
  });
  const operadorId = await admin.mutation(api.admin.operadores.criar, {
    nome: "João",
    camarasPermitidas: [camaraId],
    podeLancarProducao: true,
    podeLancarSaida: true,
    podeContar: false,
  });
  const { pin } = await admin.mutation(api.admin.operadores.gerarPinOperador, { id: operadorId });
  const camara = await t.run((ctx) => ctx.db.get(camaraId));
  const login = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin });
  if (!login.ok) throw new Error("login falhou no setup");
  return { admin, camaraId, produtoId, formatoId, token: login.token };
}

// "AAAA-MM-DD" de N dias atrás, no fuso de Cuiabá.
const diaAtras = (n: number) => diaCuiaba(Date.now() - n * DIA_MS);

describe("resolverDataMovimento (RF65)", () => {
  test("sem dia ou hoje → agora; passado → meio-dia daquele dia; limites rejeitados", () => {
    const agora = Date.now();
    expect(resolverDataMovimento(undefined, agora)).toBe(agora);
    expect(resolverDataMovimento(diaCuiaba(agora), agora)).toBe(agora);

    const ontem = resolverDataMovimento(diaCuiaba(agora - DIA_MS), agora);
    expect(ontem).toBe(inicioDoDiaCuiaba(agora) - DIA_MS + 12 * 60 * 60 * 1000);

    expect(() => resolverDataMovimento(diaCuiaba(agora - 7 * DIA_MS), agora)).not.toThrow();
    expect(() => resolverDataMovimento(diaCuiaba(agora - 8 * DIA_MS), agora)).toThrow(/7 dias/);
    expect(() => resolverDataMovimento(diaCuiaba(agora + DIA_MS), agora)).toThrow(/futuro/);
    expect(() => resolverDataMovimento("2026-02-31", agora)).toThrow(/inválida/);
    expect(() => resolverDataMovimento("ontem", agora)).toThrow(/inválida/);
  });
});

describe("Lançamentos com data do movimento (RF65)", () => {
  test("operador lança ontem; sem dia grava hoje; registradoEm segue sendo agora", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);

    const { movimentacaoId: idOntem } = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "p1", dia: diaAtras(1),
      produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 5,
    });
    const { movimentacaoId: idHoje } = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "p2", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 3,
    });

    const ontem = await t.run((ctx) => ctx.db.get(idOntem));
    const hoje = await t.run((ctx) => ctx.db.get(idHoje));
    const inicioHoje = inicioDoDiaCuiaba(Date.now());
    expect(ontem!.dataMovimento).toBeLessThan(inicioHoje);
    expect(ontem!.registradoEm).toBeGreaterThanOrEqual(inicioHoje);
    expect(hoje!.dataMovimento).toBe(hoje!.registradoEm);
  });

  test("8 dias atrás e amanhã são rejeitados, no operador e no Admin", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);

    await expect(
      t.mutation(api.operador.lancamentos.lancarProducao, {
        token: s.token, chaveIdempotencia: "p1", dia: diaAtras(8),
        produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 1,
      }),
    ).rejects.toThrow(/7 dias/);
    await expect(
      s.admin.mutation(api.admin.lancamentos.lancarProducao, {
        chaveIdempotencia: "p2", dia: diaAtras(-1),
        produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 1,
      }),
    ).rejects.toThrow(/futuro/);
  });

  test("data anterior a uma contagem fechada da câmara é rejeitada", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const agora = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("contagens", {
        camaraId: s.camaraId,
        status: "aprovada",
        abertaPorTipo: "admin",
        fechadaEm: agora - 60 * 1000,
        decididaEm: agora - 30 * 1000,
      }),
    );

    await expect(
      s.admin.mutation(api.admin.lancamentos.lancarProducao, {
        chaveIdempotencia: "p1", dia: diaAtras(1),
        produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 1,
      }),
    ).rejects.toThrow(/contagem fechada/);

    // Hoje (agora, depois da contagem) continua liberado.
    await s.admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: "p2", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 1,
    });
  });

  test("retorno não pode ter data anterior à do patrocínio", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "p1", dia: diaAtras(5),
      produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 10,
    });
    const { movimentacaoId: patrocinioId } = await t.mutation(api.operador.lancamentos.lancarSaida, {
      token: s.token, chaveIdempotencia: "pat1", tipo: "patrocinio", dia: diaAtras(2),
      produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 4, clienteNome: "Festa",
    });

    await expect(
      t.mutation(api.operador.lancamentos.lancarRetorno, {
        token: s.token, chaveIdempotencia: "r1", dia: diaAtras(3), patrocinioOrigemId: patrocinioId, quantidade: 1,
      }),
    ).rejects.toThrow(/anterior à do patrocínio/);

    await t.mutation(api.operador.lancamentos.lancarRetorno, {
      token: s.token, chaveIdempotencia: "r2", dia: diaAtras(1), patrocinioOrigemId: patrocinioId, quantidade: 1,
    });
  });

  test("carregamento com vários produtos grava a mesma data em todas as linhas", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "p1", dia: diaAtras(3),
      produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 10,
    });
    const { movimentacaoIds } = await t.mutation(api.operador.lancamentos.lancarSaidaMultipla, {
      token: s.token, carregamentoId: "car1", tipo: "venda", dia: diaAtras(2), clienteNome: "Bar",
      itens: [
        { chaveIdempotencia: "i1", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 2 },
        { chaveIdempotencia: "i2", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 3 },
      ],
    });
    const linhas = await t.run((ctx) => Promise.all(movimentacaoIds.map((id) => ctx.db.get(id))));
    expect(new Set(linhas.map((l) => l!.dataMovimento)).size).toBe(1);
    expect(linhas[0]!.dataMovimento).toBeLessThan(inicioDoDiaCuiaba(Date.now()) - DIA_MS);
  });
});

describe("Leituras pela data do movimento (RF65)", () => {
  test("painel agrupa no dia informado, não no dia do registro", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await s.admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: "p1", dia: diaAtras(1), produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 5,
    });

    const { serie } = await s.admin.query(api.admin.painel.movimentoPorPeriodo, { dias: 7 });
    expect(serie[serie.length - 1].producaoKg).toBe(0); // hoje
    expect(serie[serie.length - 2].producaoKg).toBe(10); // ontem

    const resumo = await s.admin.query(api.admin.painel.resumo, {});
    expect(resumo.kpis.produzidoHojeKg).toBe(0);
  });

  test("histórico filtra o período pela data do movimento; legado sem o campo usa registradoEm", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await s.admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: "ontem", dia: diaAtras(1), produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 5,
    });
    // Lançamento legado: gravado hoje, sem dataMovimento.
    await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: "legado", tipo: "producao", sinal: 1,
        produtoId: s.produtoId, camaraId: s.camaraId, formatoId: s.formatoId,
        quantidade: 1, pesoKg: 2, registradoPorTipo: "admin", clerkId: "clerk_admin",
        registradoEm: Date.now(),
      }),
    );

    const inicioHoje = inicioDoDiaCuiaba(Date.now());
    const paginationOpts = { numItems: 50, cursor: null };
    const deOntem = await s.admin.query(api.admin.historico.listar, {
      de: inicioHoje - DIA_MS, ate: inicioHoje - 1, paginationOpts,
    });
    expect(deOntem.page.map((m) => m.quantidade)).toEqual([5]);

    const deHoje = await s.admin.query(api.admin.historico.listar, { de: inicioHoje, paginationOpts });
    expect(deHoje.page.map((m) => m.quantidade)).toEqual([1]);
    expect(deHoje.page[0].dataMovimento).toBe(deHoje.page[0].registradoEm);
  });
});
