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

    const historico = await admin.query(api.admin.historico.listar, {
      paginationOpts: { numItems: 500, cursor: null },
    });
    expect(historico.page).toHaveLength(1);
    expect(historico.page[0].autor).toBe("Alisson Sousa");
    expect(historico.page[0].autorTipo).toBe("admin");
  });
});

describe("Tarefa 4 — motivo obrigatório em ajuste", () => {
  test("ajuste gerado pela aprovação de contagem recebe motivoCategoria 'contagem' automaticamente", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const adminB = await comoAdmin(t, "clerk_b", "Bianca Reis");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);

    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 4 }],
    });
    await adminB.mutation(api.admin.contagens.aprovar, { contagemId });

    const ajustes = await t.run((ctx) =>
      ctx.db
        .query("movimentacoes")
        .withIndex("by_tipo", (q) => q.eq("tipo", "ajuste"))
        .collect(),
    );
    expect(ajustes).toHaveLength(1);
    expect(ajustes[0].motivoCategoria).toBe("contagem");
  });
});

describe("Migração — migrarMotivoAjusteLegado (tarefa 4)", () => {
  test("dryRun não grava nada; sem dryRun marca ajustes antigos como 'nao_informado', sem chutar o motivo real", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);

    // Ajuste "legado": exatamente como gerarAjustesDaContagem gravava antes da
    // tarefa 4 existir (sem motivoCategoria).
    const ajusteId = await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: crypto.randomUUID(),
        tipo: "ajuste",
        sinal: 1,
        produtoId,
        camaraId,
        formatoId,
        quantidade: 2,
        pesoKg: 4,
        registradoPorTipo: "admin",
        clerkId: "clerk_a",
        registradoEm: Date.now(),
      }),
    );

    const seco = await t.mutation(internal.migracoes.migrarMotivoAjusteLegado, {});
    expect(seco).toEqual({ dryRun: true, totalSemMotivo: 1 });
    expect((await t.run((ctx) => ctx.db.get(ajusteId)))?.motivoCategoria).toBeUndefined();

    await t.mutation(internal.migracoes.migrarMotivoAjusteLegado, { dryRun: false });
    expect((await t.run((ctx) => ctx.db.get(ajusteId)))?.motivoCategoria).toBe("nao_informado");

    const deNovo = await t.mutation(internal.migracoes.migrarMotivoAjusteLegado, { dryRun: false });
    expect(deNovo.totalSemMotivo).toBe(0);
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

describe("Tarefa 5 — agrupar ajustes de contagem por loteId", () => {
  test("todos os ajustes de uma aprovação recebem o mesmo loteId e contagemId", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const adminB = await comoAdmin(t, "clerk_b", "Bianca Reis");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);
    const formatoId2 = await adminA.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Saco 5kg",
      pesoKg: 5,
      pesoVariavel: false,
    });

    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [
        { produtoId, formatoId, saldoContado: 4 }, // sistema=0 → +4
        { produtoId, formatoId: formatoId2, saldoContado: 2 }, // sistema=0 → +2
      ],
    });
    await adminB.mutation(api.admin.contagens.aprovar, { contagemId });

    const ajustes = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_tipo", (q) => q.eq("tipo", "ajuste")).collect(),
    );
    expect(ajustes).toHaveLength(2);
    expect(ajustes[0].loteId).toBeDefined();
    expect(ajustes[0].loteId).toBe(ajustes[1].loteId);
    expect(ajustes.every((a) => a.contagemId === contagemId)).toBe(true);
    expect(ajustes.every((a) => a.loteInferido === undefined)).toBe(true);
  });

  test("admin.contagens.historico lista aprovadas/rejeitadas com divergência total em kg e quem decidiu", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const adminB = await comoAdmin(t, "clerk_b", "Bianca Reis");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);

    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 4 }], // +4 pacotes de 2kg = +8kg
    });
    await adminB.mutation(api.admin.contagens.aprovar, { contagemId, observacao: "confere" });

    const historico = await adminA.query(api.admin.contagens.historico, {});
    expect(historico).toHaveLength(1);
    expect(historico[0].status).toBe("aprovada");
    expect(historico[0].camaraNome).toBe("Câmara Saborizado");
    expect(historico[0].decididaPorNome).toBe("Bianca Reis");
    expect(historico[0].divergenciaTotalKg).toBe(8);
  });
});

describe("Migração — migrarLoteAjusteLegado (tarefa 5)", () => {
  test("agrupa ajustes legados por segundo+autor+câmara, sem atribuir contagemId", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const outraCamaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Cubo" });

    const agora = Date.now();
    // Dois ajustes no MESMO segundo, mesmo autor, mesma câmara — devem virar 1 lote.
    const ajuste1 = await t.run((ctx) =>
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
        registradoEm: agora,
      }),
    );
    const ajuste2 = await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: crypto.randomUUID(),
        tipo: "ajuste",
        sinal: -1,
        produtoId,
        camaraId,
        formatoId,
        quantidade: 1,
        pesoKg: 2,
        registradoPorTipo: "admin",
        clerkId: "clerk_a",
        registradoEm: agora + 1, // mesmo segundo, ms diferente
      }),
    );
    // Câmara diferente, mesmo segundo/autor — NÃO deve entrar no mesmo lote.
    const ajusteOutraCamara = await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: crypto.randomUUID(),
        tipo: "ajuste",
        sinal: 1,
        produtoId,
        camaraId: outraCamaraId,
        formatoId,
        quantidade: 1,
        pesoKg: 2,
        registradoPorTipo: "admin",
        clerkId: "clerk_a",
        registradoEm: agora,
      }),
    );

    const seco = await t.mutation(internal.migracoes.migrarLoteAjusteLegado, {});
    expect(seco).toEqual({ dryRun: true, totalSemLote: 3, lotesReconstruidos: 2 });

    await t.mutation(internal.migracoes.migrarLoteAjusteLegado, { dryRun: false });

    const m1 = await t.run((ctx) => ctx.db.get(ajuste1));
    const m2 = await t.run((ctx) => ctx.db.get(ajuste2));
    const m3 = await t.run((ctx) => ctx.db.get(ajusteOutraCamara));

    expect(m1?.loteId).toBeDefined();
    expect(m1?.loteId).toBe(m2?.loteId);
    expect(m3?.loteId).not.toBe(m1?.loteId);
    expect(m1?.loteInferido).toBe(true);
    expect(m1?.contagemId).toBeUndefined(); // não dá pra provar o vínculo — não inventa

    const deNovo = await t.mutation(internal.migracoes.migrarLoteAjusteLegado, { dryRun: false });
    expect(deNovo.totalSemLote).toBe(0);
  });
});

describe("Tarefa 6 — estorno de lançamento", () => {
  test("estorna um lançamento normal: contra-lançamento com sinal invertido, saldo zera", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { produtoId, formatoId } = await cadastroBase(admin);

    const { movimentacaoId } = await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 1130,
    });

    const previewAntes = await admin.query(api.admin.estorno.preview, { lancamentoId: movimentacaoId });
    expect(previewAntes.bloqueio).toBeNull();
    expect(previewAntes.impactoQuantidade).toBe(-1130);
    expect(previewAntes.impactoPesoKg).toBe(-2260); // 1130 × 2kg
    expect(previewAntes.saldoDepois).toBe(0);

    const { estornoId } = await admin.mutation(api.admin.estorno.estornar, {
      lancamentoId: movimentacaoId,
      motivoTexto: "digitei 1130 em vez de 113",
    });

    const estorno = await t.run((ctx) => ctx.db.get(estornoId));
    expect(estorno?.tipo).toBe("estorno");
    expect(estorno?.sinal).toBe(-1);
    expect(estorno?.quantidade).toBe(1130);
    expect(estorno?.estornoDe).toBe(movimentacaoId);
    expect(estorno?.autorNome).toBe("Alisson Sousa");

    const original = await t.run((ctx) => ctx.db.get(movimentacaoId));
    expect(original?.sinal).toBe(1); // original NUNCA muda (append-only)

    const historico = await admin.query(api.admin.historico.listar, {
      paginationOpts: { numItems: 500, cursor: null },
    });
    const linhaOriginal = historico.page.find((m) => m._id === movimentacaoId)!;
    expect(linhaOriginal.estornado).toBe(true); // derivado, não um campo gravado
  });

  test("bloqueia: motivo com menos de 5 caracteres", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { produtoId, formatoId } = await cadastroBase(admin);
    const { movimentacaoId } = await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 5,
    });

    await expect(
      admin.mutation(api.admin.estorno.estornar, { lancamentoId: movimentacaoId, motivoTexto: "oi" }),
    ).rejects.toThrow();
  });

  test("bloqueia: não estorna um estorno, nem estorna duas vezes o mesmo original", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { produtoId, formatoId } = await cadastroBase(admin);
    const { movimentacaoId } = await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 5,
    });

    const { estornoId } = await admin.mutation(api.admin.estorno.estornar, {
      lancamentoId: movimentacaoId,
      motivoTexto: "correção de teste",
    });

    // Estornar de novo o mesmo original.
    await expect(
      admin.mutation(api.admin.estorno.estornar, {
        lancamentoId: movimentacaoId,
        motivoTexto: "tentando de novo",
      }),
    ).rejects.toThrow();

    // Estornar o próprio estorno.
    await expect(
      admin.mutation(api.admin.estorno.estornar, { lancamentoId: estornoId, motivoTexto: "estorna o estorno" }),
    ).rejects.toThrow();
  });

  test("bloqueia: ajuste de contagem não é estornado por aqui", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const adminB = await comoAdmin(t, "clerk_b", "Bianca Reis");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);

    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 4 }],
    });
    await adminB.mutation(api.admin.contagens.aprovar, { contagemId });

    const ajustes = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_tipo", (q) => q.eq("tipo", "ajuste")).collect(),
    );

    await expect(
      adminA.mutation(api.admin.estorno.estornar, {
        lancamentoId: ajustes[0]._id,
        motivoTexto: "não deveria funcionar",
      }),
    ).rejects.toThrow();
  });

  test("bloqueia: lançamento anterior à última contagem aprovada daquela câmara", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const adminB = await comoAdmin(t, "clerk_b", "Bianca Reis");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);

    const { movimentacaoId } = await adminA.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 5,
    });

    // Uma contagem é aberta, fechada e aprovada DEPOIS do lançamento — reconcilia o saldo.
    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 5 }], // bate com o sistema, sem divergência
    });
    await adminB.mutation(api.admin.contagens.aprovar, { contagemId });

    const preview = await adminA.query(api.admin.estorno.preview, { lancamentoId: movimentacaoId });
    expect(preview.bloqueio).toContain("contagem aprovada");

    await expect(
      adminA.mutation(api.admin.estorno.estornar, { lancamentoId: movimentacaoId, motivoTexto: "tarde demais" }),
    ).rejects.toThrow();
  });

  test("lançamento DEPOIS da contagem aprovada continua estornável normalmente", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const adminB = await comoAdmin(t, "clerk_b", "Bianca Reis");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);

    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, { contagemId, itens: [{ produtoId, formatoId, saldoContado: 0 }] });
    await adminB.mutation(api.admin.contagens.aprovar, { contagemId });

    const { movimentacaoId } = await adminA.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 5,
    });

    const preview = await adminA.query(api.admin.estorno.preview, { lancamentoId: movimentacaoId });
    expect(preview.bloqueio).toBeNull();
  });

  test("sem Admin autenticado, estornar é rejeitado", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a", "Alisson Sousa");
    const { produtoId, formatoId } = await cadastroBase(admin);
    const { movimentacaoId } = await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 5,
    });

    await expect(
      t.mutation(api.admin.estorno.estornar, { lancamentoId: movimentacaoId, motivoTexto: "sem login" }),
    ).rejects.toThrow();
  });
});
