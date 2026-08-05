import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/*
  Testes do sprint P0 ("o histórico conta a verdade") — auditabilidade dos
  lançamentos. Um arquivo à parte porque a feature atravessa lançamentos
  (fase 3) e contagens (fase 4): autor nominal, motivo obrigatório em ajuste,
  agrupamento por lote e estorno.
*/

async function comoAdmin(t: ReturnType<typeof convexTest>, clerkId: string, nome: string) {
  await t.run((ctx) =>
    ctx.db.insert("usuarios", {
      clerkId,
      nome,
      email: `${clerkId}@ex.com`,
      papel: "admin",
      ativo: true,
    }),
  );
  return t.withIdentity({ subject: clerkId });
}

async function cadastroBase(admin: Awaited<ReturnType<typeof comoAdmin>>) {
  const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Saborizado" });
  const produtoId = await admin.mutation(api.admin.produtos.criar, {
    nome: "Morango",
    categoria: "saborizado",
    camaraId,
    unidadeBase: "pacote",
  });
  const formatoId = await admin.mutation(api.admin.formatos.criar, {
    produtoId,
    nome: "Saco 2kg",
    pesoKg: 2,
    pesoVariavel: false,
  });
  return { camaraId, produtoId, formatoId };
}

async function operadorLogado(
  t: ReturnType<typeof convexTest>,
  admin: Awaited<ReturnType<typeof comoAdmin>>,
  camaraId: Id<"camaras">,
  nome: string,
) {
  const operadorId = await admin.mutation(api.admin.operadores.criar, {
    nome,
    camarasPermitidas: [camaraId],
    podeLancarProducao: true,
    podeLancarSaida: true,
    podeContar: true,
  });
  const { pin } = await admin.mutation(api.admin.operadores.gerarPinOperador, { id: operadorId });
  const camara = await t.run((ctx) => ctx.db.get(camaraId));
  const login = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin });
  if (!login.ok) throw new Error("login falhou");
  return { operadorId, token: login.token };
}

describe("Tarefa 3 — autor nominal em todo lançamento", () => {
  test("lançamento do colaborador grava o nome do colaborador", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const { token } = await operadorLogado(t, admin, camaraId, "João");

    const { movimentacaoId } = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 5,
    });
    const mov = await t.run((ctx) => ctx.db.get(movimentacaoId));
    expect(mov?.autorNome).toBe("João");
    expect(mov?.registradoPorTipo).toBe("operador");
  });

  test("lançamento do Admin grava o nome do Admin que lançou, não um genérico", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { produtoId, formatoId } = await cadastroBase(admin);

    const { movimentacaoId } = await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 3,
    });
    const mov = await t.run((ctx) => ctx.db.get(movimentacaoId));
    expect(mov?.autorNome).toBe("Alisson Sousa");
  });

  test("ajuste de contagem aprovada grava o nome de quem aprovou", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const adminB = await comoAdmin(t, "clerk_b", "Bianca Reis");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);

    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 4 }], // sistema=0 → divergência +4
    });
    await adminB.mutation(api.admin.contagens.aprovar, { contagemId });

    const ajustes = await t.run((ctx) =>
      ctx.db
        .query("movimentacoes")
        .withIndex("by_tipo", (q) => q.eq("tipo", "ajuste"))
        .collect(),
    );
    expect(ajustes).toHaveLength(1);
    expect(ajustes[0].autorNome).toBe("Bianca Reis");
  });

  test("Histórico mostra autor real, não 'Admin' genérico, quando há vários admins", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    await comoAdmin(t, "clerk_b", "Bianca Reis"); // segundo admin ativo, sem lançar nada
    const { produtoId, formatoId } = await cadastroBase(admin);

    await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 3,
    });

    const historico = await admin.query(api.admin.historico.listar, {});
    expect(historico).toHaveLength(1);
    expect(historico[0].autor).toBe("Alisson Sousa");
    expect(historico[0].autorTipo).toBe("admin");
  });
});

describe("Migração — migrarAutorLegado (tarefa 3)", () => {
  test("dryRun não grava nada; sem dryRun preenche operador com o nome real e admin com rótulo genérico", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const operadorId = await admin.mutation(api.admin.operadores.criar, {
      nome: "Marcos",
      camarasPermitidas: [camaraId],
      podeLancarProducao: true,
      podeLancarSaida: true,
      podeContar: true,
    });

    // Simula registros ANTERIORES à sprint: inseridos direto no banco, sem
    // autorNome — é exatamente o estado real dos dados em produção hoje.
    const movOperadorId = await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: crypto.randomUUID(),
        tipo: "producao",
        sinal: 1,
        produtoId,
        camaraId,
        formatoId,
        quantidade: 10,
        pesoKg: 20,
        registradoPorTipo: "operador",
        operadorId,
        registradoEm: Date.now(),
      }),
    );
    const movAdminId = await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: crypto.randomUUID(),
        tipo: "ajuste",
        sinal: 1,
        produtoId,
        camaraId,
        formatoId,
        quantidade: 1,
        pesoKg: 2,
        registradoPorTipo: "admin",
        clerkId: "clerk_a",
        registradoEm: Date.now(),
      }),
    );

    // dryRun (padrão): só conta, não grava.
    const relatorioSeco = await t.mutation(internal.migracoes.migrarAutorLegado, {});
    expect(relatorioSeco).toEqual({
      dryRun: true,
      totalSemAutor: 2,
      migradosComoOperador: 1,
      migradosComoAdminGenerico: 1,
    });
    expect((await t.run((ctx) => ctx.db.get(movOperadorId)))?.autorNome).toBeUndefined();

    // De verdade: grava.
    const relatorio = await t.mutation(internal.migracoes.migrarAutorLegado, { dryRun: false });
    expect(relatorio.totalSemAutor).toBe(2);

    const movOperador = await t.run((ctx) => ctx.db.get(movOperadorId));
    const movAdmin = await t.run((ctx) => ctx.db.get(movAdminId));
    expect(movOperador?.autorNome).toBe("Marcos"); // identificável via operadorId — não é chute
    expect(movAdmin?.autorNome).toBe("Admin (registro anterior)"); // genérico, deliberado

    // Idempotente: rodar de novo não acha mais nada para migrar.
    const relatorioDeNovo = await t.mutation(internal.migracoes.migrarAutorLegado, { dryRun: false });
    expect(relatorioDeNovo.totalSemAutor).toBe(0);
  });
});
