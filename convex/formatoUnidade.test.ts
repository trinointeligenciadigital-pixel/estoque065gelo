import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { saldoDoFormato, pesoTotalDoProduto } from "./lib/saldo";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/*
  Migração pacote→unidade (gelo saborizado): um formato pode ser contado em
  "unidade" (peça individual) em vez de "pacote" (embalagem). O campo é
  opcional e fixado na criação — nunca editável depois (ver comentário em
  convex/schema.ts e em convex/admin/formatos.ts). Estes testes travam que:
  (1) a mutation aceita e valida o campo novo; (2) formatos antigos, sem o
  campo, continuam se comportando exatamente como antes; (3) a matemática de
  saldo (saldoDoFormato/pesoTotalDoProduto) não precisa saber nada sobre
  unidade — ela já era agnóstica, e isso é o que torna a migração segura.
*/

async function comoAdmin(t: ReturnType<typeof convexTest>, clerkId = "clerk_a") {
  await t.run((ctx) =>
    ctx.db.insert("usuarios", {
      clerkId,
      nome: "Alisson Sousa",
      email: `${clerkId}@ex.com`,
      papel: "admin",
      ativo: true,
    }),
  );
  return t.withIdentity({ subject: clerkId });
}

async function produtoBase(admin: Awaited<ReturnType<typeof comoAdmin>>) {
  const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Saborizado" });
  const produtoId = await admin.mutation(api.admin.produtos.criar, {
    nome: "Morango",
    categoria: "saborizado",
    camaraId,
    unidadeBase: "pacote",
  });
  return { camaraId, produtoId };
}

describe("formatos.criar — unidadeContagem", () => {
  test("cria um formato em unidade e lê de volta unidadeContagem: 'unidade'", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { produtoId } = await produtoBase(admin);

    const formatoId = await admin.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Unidade",
      pesoKg: 0.19,
      pesoVariavel: false,
      unidadeContagem: "unidade",
    });
    const formato = await t.run((ctx) => ctx.db.get(formatoId));
    expect(formato?.unidadeContagem).toBe("unidade");
    expect(formato?.unidadesPorPacote).toBeUndefined();
  });

  test("sem unidadeContagem, formato nasce como antes (ausente = pacote)", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { produtoId } = await produtoBase(admin);

    const formatoId = await admin.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Pacote",
      pesoKg: 5.7,
      pesoVariavel: false,
      unidadesPorPacote: 30,
    });
    const formato = await t.run((ctx) => ctx.db.get(formatoId));
    expect(formato?.unidadeContagem).toBeUndefined();
    expect(formato?.unidadesPorPacote).toBe(30);
  });

  test("rejeita unidadesPorPacote junto com unidadeContagem 'unidade'", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { produtoId } = await produtoBase(admin);

    await expect(
      admin.mutation(api.admin.formatos.criar, {
        produtoId,
        nome: "Unidade",
        pesoKg: 0.19,
        pesoVariavel: false,
        unidadeContagem: "unidade",
        unidadesPorPacote: 30,
      }),
    ).rejects.toThrow();
  });
});

describe("formatos.atualizar — unidadeContagem nunca muda depois de criado", () => {
  test("atualizar não altera unidadeContagem mesmo editando os outros campos", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { produtoId } = await produtoBase(admin);

    const formatoId = await admin.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Unidade",
      pesoKg: 0.19,
      pesoVariavel: false,
      unidadeContagem: "unidade",
    });
    await admin.mutation(api.admin.formatos.atualizar, {
      id: formatoId,
      nome: "Unidade (revisado)",
      pesoKg: 0.2,
      pesoVariavel: false,
      estoqueMinimo: 100,
      ativo: true,
    });
    const formato = await t.run((ctx) => ctx.db.get(formatoId));
    expect(formato?.unidadeContagem).toBe("unidade");
    expect(formato?.nome).toBe("Unidade (revisado)");
  });
});

describe("saldo — a matemática não precisa saber nada sobre unidadeContagem", () => {
  test("saldoDoFormato e pesoTotalDoProduto funcionam normalmente num formato 'unidade' novo", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId } = await produtoBase(admin);

    const formatoId = await admin.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Unidade",
      pesoKg: 0.2,
      pesoVariavel: false,
      unidadeContagem: "unidade",
    });

    await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: "u1",
        tipo: "producao",
        sinal: 1,
        produtoId,
        camaraId,
        formatoId,
        quantidade: 500,
        pesoKg: 500 * 0.2,
        registradoPorTipo: "operador",
        registradoEm: Date.now(),
      }),
    );

    const saldo = await t.run((ctx) => saldoDoFormato(ctx, produtoId, camaraId, formatoId));
    const peso = await t.run((ctx) => pesoTotalDoProduto(ctx, produtoId, camaraId));
    expect(saldo).toBe(500);
    expect(peso).toBe(100); // 500 × 0,2 kg
  });

  test("formato 'pacote' antigo (com histórico) e formato 'unidade' novo, no mesmo produto: pesoTotalDoProduto soma os dois, saldoDoFormato fica isolado por formato", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId } = await produtoBase(admin);

    const formatoPacoteId = await admin.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Pacote",
      pesoKg: 5.7,
      pesoVariavel: false,
      unidadesPorPacote: 30,
    });
    await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: "p1",
        tipo: "producao",
        sinal: 1,
        produtoId,
        camaraId,
        formatoId: formatoPacoteId,
        quantidade: 10,
        pesoKg: 10 * 5.7,
        registradoPorTipo: "operador",
        registradoEm: Date.now(),
      }),
    );
    // Migração: desativa o formato antigo — histórico preservado, sem novas
    // movimentações contra ele daqui pra frente.
    await admin.mutation(api.admin.formatos.atualizar, {
      id: formatoPacoteId,
      nome: "Pacote",
      pesoKg: 5.7,
      pesoVariavel: false,
      unidadesPorPacote: 30,
      estoqueMinimo: 0,
      ativo: false,
    });

    const formatoUnidadeId = await admin.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Unidade",
      pesoKg: 0.19,
      pesoVariavel: false,
      unidadeContagem: "unidade",
    });
    await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: "u2",
        tipo: "ajuste",
        sinal: 1,
        produtoId,
        camaraId,
        formatoId: formatoUnidadeId,
        quantidade: 300,
        pesoKg: 300 * 0.19,
        motivoCategoria: "contagem",
        registradoPorTipo: "admin",
        registradoEm: Date.now(),
      }),
    );

    const saldoPacote = await t.run((ctx) => saldoDoFormato(ctx, produtoId, camaraId, formatoPacoteId));
    const saldoUnidade = await t.run((ctx) => saldoDoFormato(ctx, produtoId, camaraId, formatoUnidadeId));
    const pesoProduto = await t.run((ctx) => pesoTotalDoProduto(ctx, produtoId, camaraId));

    expect(saldoPacote).toBe(10); // continua ali, isolado — nunca reinterpretado
    expect(saldoUnidade).toBe(300);
    // 10×5,7 + 300×0,19 = 57 + 57 = 114 kg — os dois formatos entram na soma
    // por peso, mesmo o antigo estando desativado (histórico nunca some).
    expect(pesoProduto).toBeCloseTo(114, 5);
  });
});
