import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/*
  Testes do Adendo PWA ("acertos da rodada de venda") — tarefas 2 e 4, que
  mexem em servidor: rótulo canônico de formato (unidadesPorPacote) e
  protocolo + desfazer de carregamento inteiro.
*/

async function comoAdmin(t: ReturnType<typeof convexTest>, clerkId = "clerk_a", nome = "Alisson Sousa") {
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
    nome: "Pacote",
    pesoKg: 5.7,
    pesoVariavel: false,
    unidadesPorPacote: 30,
  });
  const produtoB = await admin.mutation(api.admin.produtos.criar, {
    nome: "Uva",
    categoria: "saborizado",
    camaraId,
    unidadeBase: "pacote",
  });
  const formatoB = await admin.mutation(api.admin.formatos.criar, {
    produtoId: produtoB,
    nome: "Pacote",
    pesoKg: 2,
    pesoVariavel: false,
  });
  return { camaraId, produtoId, formatoId, produtoB, formatoB };
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

describe("Tarefa 2 — unidadesPorPacote", () => {
  test("formatos.criar rejeita unidadesPorPacote <= 0", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { produtoId } = await cadastroBase(admin);

    await expect(
      admin.mutation(api.admin.formatos.criar, {
        produtoId,
        nome: "Pacote",
        pesoKg: 2,
        pesoVariavel: false,
        unidadesPorPacote: 0,
      }),
    ).rejects.toThrow();
  });

  test("peso variável nunca grava unidadesPorPacote, mesmo se enviado", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { produtoId } = await cadastroBase(admin);

    const formatoId = await admin.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Granel",
      pesoKg: 999,
      pesoVariavel: true,
      unidadesPorPacote: 30,
    });
    const formato = await t.run((ctx) => ctx.db.get(formatoId));
    expect(formato?.unidadesPorPacote).toBeUndefined();
    expect(formato?.pesoKg).toBe(0);
  });
});

describe("Tarefa 4 — protocolo em todo lançamento", () => {
  test("lancarProducao, lancarSaida (perda) e lancarRetorno gravam protocolo de 8 chars", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    const producao = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 20,
    });
    expect(producao.protocolo).toHaveLength(8);

    const perda = await t.mutation(api.operador.lancamentos.lancarSaida, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      tipo: "perda",
      produtoId,
      formatoId,
      quantidade: 1,
      motivoPerda: "derreteu",
    });
    expect(perda.protocolo).toHaveLength(8);
    expect(perda.protocolo).not.toBe(producao.protocolo);

    const movProducao = await t.run((ctx) => ctx.db.get(producao.movimentacaoId));
    expect(movProducao?.protocolo).toBe(producao.protocolo);
  });

  test("lancarSaidaMultipla: todas as linhas do mesmo carregamento compartilham UM protocolo", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId, produtoB, formatoB } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 10,
    });
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId: produtoB,
      formatoId: formatoB,
      quantidade: 10,
    });

    const carregamentoId = crypto.randomUUID();
    const r = await t.mutation(api.operador.lancamentos.lancarSaidaMultipla, {
      token: joao.token,
      carregamentoId,
      tipo: "venda",
      itens: [
        { chaveIdempotencia: crypto.randomUUID(), produtoId, formatoId, quantidade: 2 },
        { chaveIdempotencia: crypto.randomUUID(), produtoId: produtoB, formatoId: formatoB, quantidade: 3 },
      ],
      clienteNome: "Cliente X",
    });

    const linhas = await t.run((ctx) =>
      ctx.db
        .query("movimentacoes")
        .withIndex("by_carregamento", (q) => q.eq("carregamentoId", carregamentoId))
        .collect(),
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0].protocolo).toBe(r.protocolo);
    expect(linhas[1].protocolo).toBe(r.protocolo);
  });

  test("historico.listar encontra qualquer lançamento pelo protocolo", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    const { protocolo } = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 20,
    });

    const achados = await admin.query(api.admin.historico.listar, { protocolo });
    expect(achados).toHaveLength(1);
    expect(achados[0].protocolo).toBe(protocolo);

    // Busca sem distinguir maiúsculo/minúsculo.
    const achadosMinusculo = await admin.query(api.admin.historico.listar, {
      protocolo: protocolo.toLowerCase(),
    });
    expect(achadosMinusculo).toHaveLength(1);
  });
});

describe("Tarefa 4 — desfazerMeuCarregamento", () => {
  async function lancarCarregamento(
    t: ReturnType<typeof convexTest>,
    joao: Awaited<ReturnType<typeof operadorLogado>>,
    produtoId: Id<"produtos">,
    formatoId: Id<"formatos">,
    produtoB: Id<"produtos">,
    formatoB: Id<"formatos">,
  ) {
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 10,
    });
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId: produtoB,
      formatoId: formatoB,
      quantidade: 10,
    });

    const carregamentoId = crypto.randomUUID();
    await t.mutation(api.operador.lancamentos.lancarSaidaMultipla, {
      token: joao.token,
      carregamentoId,
      tipo: "venda",
      itens: [
        { chaveIdempotencia: crypto.randomUUID(), produtoId, formatoId, quantidade: 2 },
        { chaveIdempotencia: crypto.randomUUID(), produtoId: produtoB, formatoId: formatoB, quantidade: 3 },
      ],
      clienteNome: "Cliente X",
    });
    return carregamentoId;
  }

  test("estorna TODOS os itens do carregamento numa chamada só", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId, produtoB, formatoB } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");
    const carregamentoId = await lancarCarregamento(t, joao, produtoId, formatoId, produtoB, formatoB);

    const { estornoIds } = await t.mutation(api.operador.desfazer.desfazerMeuCarregamento, {
      token: joao.token,
      carregamentoId,
    });
    expect(estornoIds).toHaveLength(2);

    const saldoA = await t.run((ctx) =>
      ctx.db
        .query("movimentacoes")
        .withIndex("by_produto_camara_formato", (q) =>
          q.eq("produtoId", produtoId).eq("camaraId", camaraId).eq("formatoId", formatoId),
        )
        .collect(),
    );
    expect(saldoA.reduce((acc, m) => acc + m.sinal * m.quantidade, 0)).toBe(10); // 10 produzido − 2 vendido + 2 estornado

    const saldoB = await t.run((ctx) =>
      ctx.db
        .query("movimentacoes")
        .withIndex("by_produto_camara_formato", (q) =>
          q.eq("produtoId", produtoB).eq("camaraId", camaraId).eq("formatoId", formatoB),
        )
        .collect(),
    );
    expect(saldoB.reduce((acc, m) => acc + m.sinal * m.quantidade, 0)).toBe(10);
  });

  test("bloqueia depois de marcarComprovanteCompartilhado, com a mensagem certa", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId, produtoB, formatoB } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");
    const carregamentoId = await lancarCarregamento(t, joao, produtoId, formatoId, produtoB, formatoB);

    const primeira = await t.mutation(api.operador.desfazer.marcarComprovanteCompartilhado, {
      token: joao.token,
      carregamentoId,
    });
    expect(primeira.jaMarcado).toBe(false);

    // Chamar de novo não duplica nem dá erro (idempotente).
    const segunda = await t.mutation(api.operador.desfazer.marcarComprovanteCompartilhado, {
      token: joao.token,
      carregamentoId,
    });
    expect(segunda.jaMarcado).toBe(true);
    const registros = await t.run((ctx) =>
      ctx.db
        .query("carregamentosCompartilhados")
        .withIndex("by_carregamento", (q) => q.eq("carregamentoId", carregamentoId))
        .collect(),
    );
    expect(registros).toHaveLength(1);

    await expect(
      t.mutation(api.operador.desfazer.desfazerMeuCarregamento, { token: joao.token, carregamentoId }),
    ).rejects.toThrow(/Comprovante já enviado/);
  });

  test("sem marcar compartilhado, desfazer continua disponível dentro da janela", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId, produtoB, formatoB } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");
    const carregamentoId = await lancarCarregamento(t, joao, produtoId, formatoId, produtoB, formatoB);

    await expect(
      t.mutation(api.operador.desfazer.desfazerMeuCarregamento, { token: joao.token, carregamentoId }),
    ).resolves.toBeDefined();
  });

  test("bloqueia: outro operador não pode desfazer o carregamento de outra pessoa", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId, produtoB, formatoB } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");
    const maria = await operadorLogado(t, admin, camaraId, "Maria");
    const carregamentoId = await lancarCarregamento(t, joao, produtoId, formatoId, produtoB, formatoB);

    await expect(
      t.mutation(api.operador.desfazer.desfazerMeuCarregamento, { token: maria.token, carregamentoId }),
    ).rejects.toThrow();
  });

  test("bloqueia: fora da janela de 5 minutos (usa a linha mais antiga do grupo)", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    const carregamentoId = crypto.randomUUID();
    const seisMinAtras = Date.now() - 6 * 60 * 1000;
    await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: crypto.randomUUID(),
        protocolo: "ABCD1234",
        carregamentoId,
        tipo: "venda",
        sinal: -1,
        produtoId,
        camaraId,
        formatoId,
        quantidade: 2,
        pesoKg: 11.4,
        clienteNome: "Cliente X",
        registradoPorTipo: "operador",
        operadorId: joao.operadorId,
        autorNome: "João",
        registradoEm: seisMinAtras,
      }),
    );

    await expect(
      t.mutation(api.operador.desfazer.desfazerMeuCarregamento, { token: joao.token, carregamentoId }),
    ).rejects.toThrow(/5 minutos/);
  });
});
