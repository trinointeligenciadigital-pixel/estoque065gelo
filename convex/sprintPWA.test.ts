import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

/*
  Testes do sprint PWA ("o operador não erra e a contagem volta a valer") —
  fluxo do colaborador. Arquivo à parte de sprintP0.test.ts porque cobre outra
  metade do sistema (PWA), mesmo dependendo de mutations do P0 (estorno, motivo).
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
  permissoes?: { producao?: boolean; saida?: boolean; contar?: boolean },
) {
  const operadorId = await admin.mutation(api.admin.operadores.criar, {
    nome,
    camarasPermitidas: [camaraId],
    podeLancarProducao: permissoes?.producao ?? true,
    podeLancarSaida: permissoes?.saida ?? true,
    podeContar: permissoes?.contar ?? true,
  });
  const { pin } = await admin.mutation(api.admin.operadores.gerarPinOperador, { id: operadorId });
  const camara = await t.run((ctx) => ctx.db.get(camaraId));
  const login = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin });
  if (!login.ok) throw new Error("login falhou");
  return { operadorId, token: login.token };
}

describe("Tarefa 1 — contagem cega", () => {
  test("contagemAbertaDoColaborador: null sem contagem, {contagemId} com a MINHA aberta, null com a de outro", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");
    const maria = await operadorLogado(t, admin, camaraId, "Maria");

    // Sem nenhuma contagem aberta.
    expect(
      await t.query(api.operador.contagem.contagemAbertaDoColaborador, { token: joao.token }),
    ).toBeNull();

    // João abre — é dele.
    const { contagemId } = await t.mutation(api.operador.contagem.abrir, { token: joao.token });
    expect(
      await t.query(api.operador.contagem.contagemAbertaDoColaborador, { token: joao.token }),
    ).toEqual({ contagemId });

    // Maria não vê a contagem do João como sua.
    expect(
      await t.query(api.operador.contagem.contagemAbertaDoColaborador, { token: maria.token }),
    ).toBeNull();
  });

  test("saldos: null enquanto EU tenho contagem aberta nesta câmara; volta ao normal depois de fechar", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 10,
    });

    // Antes de abrir contagem: saldo normal.
    const antes = await t.query(api.operador.consulta.saldos, { token: joao.token });
    expect(antes).not.toBeNull();

    const { contagemId } = await t.mutation(api.operador.contagem.abrir, { token: joao.token });

    // Com a contagem aberta: null, não o saldo.
    const durante = await t.query(api.operador.consulta.saldos, { token: joao.token });
    expect(durante).toBeNull();

    await t.mutation(api.operador.contagem.fechar, {
      token: joao.token,
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 10 }],
    });

    // Fechada: saldo volta a aparecer.
    const depois = await t.query(api.operador.consulta.saldos, { token: joao.token });
    expect(depois).not.toBeNull();
  });

  test("uma contagem pendente (fechada, aguardando Admin) não é 'minha aberta' — não bloqueia saldo de outro colaborador", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");
    const maria = await operadorLogado(t, admin, camaraId, "Maria");

    const { contagemId } = await t.mutation(api.operador.contagem.abrir, { token: joao.token });
    await t.mutation(api.operador.contagem.fechar, {
      token: joao.token,
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 0 }],
    });

    // Maria não tem contagem aberta nenhuma — vê o saldo normalmente.
    expect(await t.query(api.operador.consulta.saldos, { token: maria.token })).not.toBeNull();
  });
});

describe("Tarefa 3 — lista de produtos utilizável", () => {
  test("gridProdutos: saldo em pacotes com 1 formato; em peso com vários; null durante contagem aberta", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    // Segundo formato pro mesmo produto — passa a ter 2 formatos ativos.
    const formatoId2 = await admin.mutation(api.admin.formatos.criar, {
      produtoId,
      nome: "Saco 5kg",
      pesoKg: 5,
      pesoVariavel: false,
    });

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 10, // 10 × 2kg = 20kg
    });

    // Com 2 formatos ativos: saldo em peso, sem pacotes (não dá pra somar
    // pacotes de tamanhos diferentes).
    let grid = await t.query(api.operador.consulta.gridProdutos, { token: joao.token });
    let produto = grid.find((p) => p._id === produtoId)!;
    expect(produto.saldo).toEqual({ pacotes: null, pesoKg: 20 });

    // Desativa o segundo formato: volta a ter 1 só — saldo em pacotes.
    await admin.mutation(api.admin.formatos.atualizar, {
      id: formatoId2,
      nome: "Saco 5kg",
      pesoKg: 5,
      pesoVariavel: false,
      ativo: false,
    });
    grid = await t.query(api.operador.consulta.gridProdutos, { token: joao.token });
    produto = grid.find((p) => p._id === produtoId)!;
    expect(produto.saldo).toEqual({ pacotes: 10, pesoKg: 20 });

    // Contagem aberta: saldo escondido, mesma regra da tarefa 1.
    await t.mutation(api.operador.contagem.abrir, { token: joao.token });
    grid = await t.query(api.operador.consulta.gridProdutos, { token: joao.token });
    produto = grid.find((p) => p._id === produtoId)!;
    expect(produto.saldo).toBeNull();
  });

  test("produtosFrequentes: vazio com menos de 3 lançamentos; top 5 por contagem quando há", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Saborizado" });
    const joao = await operadorLogado(t, admin, camaraId, "João");
    const maria = await operadorLogado(t, admin, camaraId, "Maria");

    const produtoA = await admin.mutation(api.admin.produtos.criar, {
      nome: "Morango", categoria: "saborizado", camaraId, unidadeBase: "pacote",
    });
    const formatoA = await admin.mutation(api.admin.formatos.criar, {
      produtoId: produtoA, nome: "Saco 2kg", pesoKg: 2, pesoVariavel: false,
    });
    const produtoB = await admin.mutation(api.admin.produtos.criar, {
      nome: "Uva", categoria: "saborizado", camaraId, unidadeBase: "pacote",
    });
    const formatoB = await admin.mutation(api.admin.formatos.criar, {
      produtoId: produtoB, nome: "Saco 2kg", pesoKg: 2, pesoVariavel: false,
    });

    // Só 2 lançamentos ainda — abaixo do mínimo de 3.
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token, chaveIdempotencia: crypto.randomUUID(), produtoId: produtoA, formatoId: formatoA, quantidade: 1,
    });
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token, chaveIdempotencia: crypto.randomUUID(), produtoId: produtoA, formatoId: formatoA, quantidade: 1,
    });
    expect(await t.query(api.operador.consulta.produtosFrequentes, { token: joao.token })).toEqual([]);

    // 3º lançamento (produto B) — passa do mínimo. A (2x) vem antes de B (1x).
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token, chaveIdempotencia: crypto.randomUUID(), produtoId: produtoB, formatoId: formatoB, quantidade: 1,
    });
    expect(await t.query(api.operador.consulta.produtosFrequentes, { token: joao.token })).toEqual([
      produtoA,
      produtoB,
    ]);

    // Maria não lançou nada — lista vazia, não vê os lançamentos do João.
    expect(await t.query(api.operador.consulta.produtosFrequentes, { token: maria.token })).toEqual([]);
  });
});
