import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function comoAdmin(t: ReturnType<typeof convexTest>, clerkId: string) {
  await t.run((ctx) =>
    ctx.db.insert("usuarios", { clerkId, nome: clerkId, email: `${clerkId}@ex.com`, papel: "admin", ativo: true }),
  );
  return t.withIdentity({ subject: clerkId });
}

// Câmara Saborizado com Morango em dois formatos (Saco 2kg e Saco 5kg) e Uva
// (2kg). Lançamentos: Morango 2kg ×5 (10 kg), Morango 5kg ×2 (10 kg), Uva ×3
// (6 kg), venda de Morango 2kg ×2 (4 kg).
async function cenario() {
  const t = convexTest(schema, modules);
  const admin = await comoAdmin(t, "clerk_a");
  const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Saborizado" });

  const morangoId = await admin.mutation(api.admin.produtos.criar, { nome: "Morango", categoria: "saborizado", camaraId, unidadeBase: "pacote" });
  const m2 = await admin.mutation(api.admin.formatos.criar, { produtoId: morangoId, nome: "Saco", pesoKg: 2, pesoVariavel: false });
  const m5 = await admin.mutation(api.admin.formatos.criar, { produtoId: morangoId, nome: "Saco", pesoKg: 5, pesoVariavel: false });
  const uvaId = await admin.mutation(api.admin.produtos.criar, { nome: "Uva", categoria: "saborizado", camaraId, unidadeBase: "pacote" });
  const u2 = await admin.mutation(api.admin.formatos.criar, { produtoId: uvaId, nome: "Saco", pesoKg: 2, pesoVariavel: false });

  await admin.mutation(api.admin.lancamentos.lancarProducao, { chaveIdempotencia: "p1", produtoId: morangoId, formatoId: m2, quantidade: 5 });
  await admin.mutation(api.admin.lancamentos.lancarProducao, { chaveIdempotencia: "p2", produtoId: morangoId, formatoId: m5, quantidade: 2 });
  await admin.mutation(api.admin.lancamentos.lancarProducao, { chaveIdempotencia: "p3", produtoId: uvaId, formatoId: u2, quantidade: 3 });
  await admin.mutation(api.admin.lancamentos.lancarSaida, {
    chaveIdempotencia: "v1", tipo: "venda", produtoId: morangoId, formatoId: m2, quantidade: 2, clienteNome: "Cliente",
  });

  return { t, admin, camaraId, morangoId, m2, m5, uvaId };
}

describe("Histórico — soma do recorte (Entradas · Saídas · Líquido)", () => {
  test("sem filtro soma o ledger inteiro, por peso", async () => {
    const { admin } = await cenario();
    const r = await admin.query(api.admin.historico.resumo, {});
    expect(r).toMatchObject({ entradasKg: 26, saidasKg: 4, liquidoKg: 22, movimentacoes: 4, incompleto: false });
    // Formatos diferentes no recorte: quantidade nunca é somada (regra 6).
    expect(r.quantidade).toBeNull();
  });

  test("produto com dois formatos: peso soma, quantidade não", async () => {
    const { admin, morangoId } = await cenario();
    const r = await admin.query(api.admin.historico.resumo, { produtoId: morangoId });
    expect(r).toMatchObject({ entradasKg: 20, saidasKg: 4, liquidoKg: 16, movimentacoes: 3 });
    expect(r.quantidade).toBeNull();
  });

  test("produto + formato: aparece a quantidade, igual ao saldo do formato", async () => {
    const { admin, morangoId, m2 } = await cenario();
    const r = await admin.query(api.admin.historico.resumo, { produtoId: morangoId, formatoId: m2 });
    expect(r).toMatchObject({ entradasKg: 10, saidasKg: 4, liquidoKg: 6, movimentacoes: 2 });
    expect(r.quantidade).toEqual({ entradas: 5, saidas: 2, liquido: 3, unidadeContagem: "pacote" });
  });

  test("a lista paginada respeita o mesmo filtro de formato", async () => {
    const { admin, morangoId, m5 } = await cenario();
    const lista = await admin.query(api.admin.historico.listar, {
      produtoId: morangoId,
      formatoId: m5,
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(lista.page).toHaveLength(1);
    expect(lista.page[0].pesoKg).toBe(10);
  });

  test("estorno entra pelo próprio sinal: a venda estornada se anula no líquido", async () => {
    const { t, admin, morangoId, m2 } = await cenario();
    const venda = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_chave_idempotencia", (q) => q.eq("chaveIdempotencia", "v1")).first(),
    );
    await admin.mutation(api.admin.estorno.estornar, { lancamentoId: venda!._id, motivoTexto: "venda lançada em dobro" });

    const r = await admin.query(api.admin.historico.resumo, { produtoId: morangoId, formatoId: m2 });
    expect(r).toMatchObject({ entradasKg: 14, saidasKg: 4, liquidoKg: 10, movimentacoes: 3 });
    expect(r.quantidade).toMatchObject({ liquido: 5 });
  });

  test("período fora do que foi lançado devolve zeros", async () => {
    const { admin } = await cenario();
    const ontemAntes = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const r = await admin.query(api.admin.historico.resumo, { de: ontemAntes - 1000, ate: ontemAntes });
    expect(r).toMatchObject({ entradasKg: 0, saidasKg: 0, liquidoKg: 0, movimentacoes: 0, quantidade: null });
  });

  test("extrato (produto + formato): saldo final bate com o saldo do formato", async () => {
    const { t, admin, camaraId, morangoId, m2 } = await cenario();
    const r = await admin.query(api.admin.historico.resumo, { produtoId: morangoId, formatoId: m2 });
    // Sem "De": tudo cai dentro do período, saldo antes = 0.
    expect(r.extrato).toEqual({ antesKg: 0, depoisKg: 6, antesQtd: 0, depoisQtd: 3 });
    const saldo = await t.run(async (ctx) => {
      const movs = await ctx.db
        .query("movimentacoes")
        .withIndex("by_produto_camara_formato", (q) => q.eq("produtoId", morangoId).eq("camaraId", camaraId).eq("formatoId", m2))
        .collect();
      return movs.reduce((acc, m) => acc + m.sinal * m.quantidade, 0);
    });
    expect(r.extrato?.depoisQtd).toBe(saldo);
  });

  test("extrato com período depois dos lançamentos: tudo vira saldo antes", async () => {
    const { admin, morangoId, m2 } = await cenario();
    const amanha = Date.now() + 24 * 60 * 60 * 1000;
    const r = await admin.query(api.admin.historico.resumo, { produtoId: morangoId, formatoId: m2, de: amanha });
    expect(r).toMatchObject({ entradasKg: 0, saidasKg: 0, movimentacoes: 0 });
    expect(r.extrato).toEqual({ antesKg: 6, depoisKg: 6, antesQtd: 3, depoisQtd: 3 });
  });

  test("filtro de tipo corta o ledger: sem extrato, só a soma", async () => {
    const { admin, morangoId, m2 } = await cenario();
    const r = await admin.query(api.admin.historico.resumo, { produtoId: morangoId, formatoId: m2, tipo: "venda" });
    expect(r.extrato).toBeNull();
    expect(r).toMatchObject({ saidasKg: 4, entradasKg: 0 });
  });

  test("link com contagem malformada não derruba: lista vazia e soma zero", async () => {
    const { admin } = await cenario();
    const lista = await admin.query(api.admin.historico.listar, {
      contagemId: "link-cortado",
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(lista.page).toHaveLength(0);
    const r = await admin.query(api.admin.historico.resumo, { contagemId: "link-cortado" });
    expect(r).toMatchObject({ entradasKg: 0, saidasKg: 0, movimentacoes: 0 });
  });

  test("só Admin lê a soma", async () => {
    const { t } = await cenario();
    await expect(t.query(api.admin.historico.resumo, {})).rejects.toThrow();
  });
});
