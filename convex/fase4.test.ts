import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// Um Admin identificado por clerkId (para distinguir quem abre de quem decide).
async function comoAdmin(t: ReturnType<typeof convexTest>, clerkId: string) {
  await t.run((ctx) =>
    ctx.db.insert("usuarios", {
      clerkId,
      nome: clerkId,
      email: `${clerkId}@ex.com`,
      papel: "admin",
      ativo: true,
    }),
  );
  return t.withIdentity({ subject: clerkId });
}

// Câmara + produto + um formato (normal, 2kg por padrão), via Admin.
async function cadastroBase(
  admin: Awaited<ReturnType<typeof comoAdmin>>,
) {
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

// Operador com podeContar + sessão válida na câmara.
async function operadorContador(
  t: ReturnType<typeof convexTest>,
  admin: Awaited<ReturnType<typeof comoAdmin>>,
  camaraId: Id<"camaras">,
) {
  const operadorId = await admin.mutation(api.admin.operadores.criar, {
    nome: "João",
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

// -----------------------------------------------------------------------------

describe("RF52 — quem abre a contagem não aprova (crítico)", () => {
  test("Admin que abriu não pode aprovar; outro Admin aprova", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a");
    await comoAdmin(t, "clerk_b");
    const adminB = t.withIdentity({ subject: "clerk_b" });
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);

    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 4 }],
    });

    // Quem abriu (adminA) não decide.
    await expect(
      adminA.mutation(api.admin.contagens.aprovar, { contagemId }),
    ).rejects.toThrow(/Quem abriu/);

    // Outro Admin aprova.
    const r = await adminB.mutation(api.admin.contagens.aprovar, { contagemId });
    expect(r.ok).toBe(true);
  });

  test("operador abre, o Admin aprova normalmente", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const { token } = await operadorContador(t, admin, camaraId);

    const { contagemId } = await t.mutation(api.operador.contagem.abrir, { token });
    await t.mutation(api.operador.contagem.fechar, {
      token,
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 2 }],
    });
    const r = await admin.mutation(api.admin.contagens.aprovar, { contagemId });
    expect(r.ok).toBe(true);
  });
});

describe("RF47 — uma contagem por câmara", () => {
  test("não abre uma segunda contagem enquanto há uma aberta", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a");
    const { camaraId } = await cadastroBase(admin);

    await admin.mutation(api.admin.contagens.abrir, { camaraId });
    await expect(
      admin.mutation(api.admin.contagens.abrir, { camaraId }),
    ).rejects.toThrow(/já existe uma contagem/i);
  });
});

describe("RF47b — cancelar contagem aberta presa libera a câmara", () => {
  test("Admin cancela uma contagem aberta e consegue abrir outra na câmara", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a");
    await comoAdmin(t, "clerk_b");
    const adminB = t.withIdentity({ subject: "clerk_b" });
    const { camaraId } = await cadastroBase(adminA);

    // adminA abre e abandona (nunca finaliza).
    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });

    // A câmara está travada (RF47).
    await expect(
      adminB.mutation(api.admin.contagens.abrir, { camaraId }),
    ).rejects.toThrow(/já existe uma contagem/i);

    // A contagem aparece em "em andamento" para qualquer Admin; só quem abriu retoma.
    const abertas = await adminB.query(api.admin.contagens.emAndamento, {});
    expect(abertas.length).toBe(1);
    expect(abertas[0]._id).toBe(contagemId);
    expect(abertas[0].euAbri).toBe(false); // adminB não abriu

    // Outro Admin cancela (não precisa ser quem abriu) e libera a câmara.
    await adminB.mutation(api.admin.contagens.cancelar, { contagemId });
    const depois = await adminB.query(api.admin.contagens.emAndamento, {});
    expect(depois.length).toBe(0);

    const contagem = await t.run((ctx) => ctx.db.get(contagemId));
    expect(contagem?.status).toBe("cancelada");

    // Câmara liberada: dá para abrir de novo.
    const nova = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    expect(nova.contagemId).toBeDefined();
  });

  test("não dá para cancelar uma contagem pendente (tem que ser decidida)", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);

    const { contagemId } = await adminA.mutation(api.admin.contagens.abrir, { camaraId });
    await adminA.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 1 }],
    });

    await expect(
      adminA.mutation(api.admin.contagens.cancelar, { contagemId }),
    ).rejects.toThrow(/em andamento/i);
  });
});

describe("RF48 — contagem às cegas: saldo do sistema não vai ao cliente", () => {
  test("as listas para contar não trazem saldo", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const { token } = await operadorContador(t, admin, camaraId);

    // Gera saldo para garantir que, se vazasse, apareceria.
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token, chaveIdempotencia: "p1", produtoId, formatoId, quantidade: 7,
    });

    const gridOperador = await t.query(api.operador.consulta.gridProdutos, { token });
    for (const p of gridOperador) {
      for (const f of p.formatos) {
        expect(f).not.toHaveProperty("saldo");
      }
    }

    const listaAdmin = await admin.query(api.admin.contagens.itensParaContagem, { camaraId });
    for (const p of listaAdmin) {
      for (const f of p.formatos) {
        expect(f).not.toHaveProperty("saldo");
      }
    }
  });
});

describe("RF50 — fechar congela a foto do saldo e calcula divergência", () => {
  test("saldoSistema fica com o valor do momento; divergência = contado − sistema", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const { token } = await operadorContador(t, admin, camaraId);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token, chaveIdempotencia: "p1", produtoId, formatoId, quantidade: 5,
    });

    const { contagemId } = await t.mutation(api.operador.contagem.abrir, { token });
    await t.mutation(api.operador.contagem.fechar, {
      token, contagemId, itens: [{ produtoId, formatoId, saldoContado: 3 }],
    });

    const itens = await t.run((ctx) =>
      ctx.db.query("contagemItens").withIndex("by_contagem", (q) => q.eq("contagemId", contagemId)).collect(),
    );
    expect(itens.length).toBe(1);
    expect(itens[0].saldoSistema).toBe(5);
    expect(itens[0].saldoContado).toBe(3);
    expect(itens[0].divergencia).toBe(-2);

    const contagem = await t.run((ctx) => ctx.db.get(contagemId));
    expect(contagem?.status).toBe("pendente");
  });
});

describe("RF53/RF54 — aprovar gera ajuste só na divergência; rejeitar não mexe", () => {
  test("aprovar ajusta o saldo ao contado; item sem divergência não gera ajuste", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a");
    await comoAdmin(t, "clerk_b");
    const adminB = t.withIdentity({ subject: "clerk_b" });
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);
    // Segundo formato, para ter um item sem divergência.
    const formato2 = await adminA.mutation(api.admin.formatos.criar, {
      produtoId, nome: "Saco 5kg", pesoKg: 5, pesoVariavel: false,
    });
    const { token } = await operadorContador(t, adminA, camaraId);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token, chaveIdempotencia: "p1", produtoId, formatoId, quantidade: 5,
    });
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token, chaveIdempotencia: "p2", produtoId, formatoId: formato2, quantidade: 4,
    });

    const { contagemId } = await t.mutation(api.operador.contagem.abrir, { token });
    await t.mutation(api.operador.contagem.fechar, {
      token, contagemId,
      itens: [
        { produtoId, formatoId, saldoContado: 3 },   // divergência -2
        { produtoId, formatoId: formato2, saldoContado: 4 }, // divergência 0
      ],
    });

    const r = await adminB.mutation(api.admin.contagens.aprovar, { contagemId });
    expect(r.ajustesGerados).toBe(1); // só o formato com divergência

    // Saldo do formato ajustado passa a bater com o contado.
    const saldos = await t.query(api.operador.consulta.saldos, { token });
    const prod = saldos.find((p) => p._id === produtoId)!;
    const f1 = prod.formatos.find((f) => f.nome === "Saco 2kg")!;
    const f2 = prod.formatos.find((f) => f.nome === "Saco 5kg")!;
    expect(f1.saldo).toBe(3);
    expect(f2.saldo).toBe(4); // inalterado

    const ajustes = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_tipo", (q) => q.eq("tipo", "ajuste")).collect(),
    );
    expect(ajustes.length).toBe(1);
    expect(ajustes[0].contagemId).toBe(contagemId);
  });

  test("rejeitar não gera movimentação e mantém o saldo", async () => {
    const t = convexTest(schema, modules);
    const adminA = await comoAdmin(t, "clerk_a");
    const { camaraId, produtoId, formatoId } = await cadastroBase(adminA);
    const { token } = await operadorContador(t, adminA, camaraId);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token, chaveIdempotencia: "p1", produtoId, formatoId, quantidade: 5,
    });

    const { contagemId } = await t.mutation(api.operador.contagem.abrir, { token });
    await t.mutation(api.operador.contagem.fechar, {
      token, contagemId, itens: [{ produtoId, formatoId, saldoContado: 99 }],
    });
    await adminA.mutation(api.admin.contagens.rejeitar, { contagemId, observacao: "recontar" });

    const ajustes = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_tipo", (q) => q.eq("tipo", "ajuste")).collect(),
    );
    expect(ajustes.length).toBe(0);

    const saldos = await t.query(api.operador.consulta.saldos, { token });
    expect(saldos[0].formatos[0].saldo).toBe(5); // intacto

    const contagem = await t.run((ctx) => ctx.db.get(contagemId));
    expect(contagem?.status).toBe("rejeitada");
  });
});

describe("RF57 — painel agrega por peso, não por soma de quantidade", () => {
  test("peso total do produto soma os formatos por kg", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const formato2 = await admin.mutation(api.admin.formatos.criar, {
      produtoId, nome: "Saco 5kg", pesoKg: 5, pesoVariavel: false,
    });
    const { token } = await operadorContador(t, admin, camaraId);

    // 3 sacos de 2kg (6kg) + 2 sacos de 5kg (10kg) = 16kg. Quantidade somada seria 5.
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token, chaveIdempotencia: "p1", produtoId, formatoId, quantidade: 3,
    });
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token, chaveIdempotencia: "p2", produtoId, formatoId: formato2, quantidade: 2,
    });

    const resumo = await admin.query(api.admin.painel.resumo, {});
    const linha = resumo.produtos.find((p) => p._id === produtoId)!;
    expect(linha.pesoTotalKg).toBe(16);
    expect(linha.pesoTotalKg).not.toBe(5); // não é a soma de quantidades
  });
});

describe("RF59 — estoque mínimo por formato", () => {
  test("badge conta formatos abaixo do próprio mínimo; formato sem mínimo não alerta", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a");
    const { produtoId, formatoId } = await cadastroBase(admin); // Saco 2kg, sem mínimo
    const f4 = await admin.mutation(api.admin.formatos.criar, {
      produtoId, nome: "Saco 4kg", pesoKg: 4, pesoVariavel: false, estoqueMinimo: 10,
    });

    // 3 pacotes de 4kg (abaixo do mínimo 10) e 5 de 2kg (sem mínimo).
    await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: "a", produtoId, formatoId: f4, quantidade: 3,
    });
    await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: "b", produtoId, formatoId, quantidade: 5,
    });

    const resumo = await admin.query(api.admin.painel.resumo, {});
    expect(resumo.qtdAbaixoMinimo).toBe(1);
    const linha = resumo.produtos.find((p) => p._id === produtoId)!;
    expect(linha.formatos.find((f) => f.nome === "Saco 4kg")!.abaixoMinimo).toBe(true);
    expect(linha.formatos.find((f) => f.nome === "Saco 2kg")!.abaixoMinimo).toBe(false);
  });
});

describe("RF63 — lançamento do Admin respeita saldo e idempotência", () => {
  test("saída acima do saldo é bloqueada; mesma chave não duplica", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t, "clerk_a");
    const { produtoId, formatoId } = await cadastroBase(admin);

    await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: "ap1", produtoId, formatoId, quantidade: 5,
    });

    await expect(
      admin.mutation(api.admin.lancamentos.lancarSaida, {
        chaveIdempotencia: "as1", tipo: "venda", produtoId, formatoId, quantidade: 10, clienteNome: "X",
      }),
    ).rejects.toThrow(/[Ss]aldo insuficiente/);

    const r1 = await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: "dup", produtoId, formatoId, quantidade: 2,
    });
    const r2 = await admin.mutation(api.admin.lancamentos.lancarProducao, {
      chaveIdempotencia: "dup", produtoId, formatoId, quantidade: 2,
    });
    expect(r2.duplicado).toBe(true);
    expect(r2.movimentacaoId).toBe(r1.movimentacaoId);
  });
});
