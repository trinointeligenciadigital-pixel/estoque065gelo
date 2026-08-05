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

describe("Tarefa 4 — checarPlausibilidade", () => {
  test("sem 30 dias de histórico: pula a checagem de média, só o saldo (5×) vale", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 10, // saldo = 10
    });

    // 60 pacotes: bem mais que 3× qualquer média recente, mas SEM histórico de
    // 30+ dias a checagem de média não entra — só sobra saldo×5 = 50.
    const abaixoDoSaldo = await t.query(api.operador.consulta.checarPlausibilidade, {
      token: joao.token, produtoId, formatoId, tipo: "producao", quantidade: 40,
    });
    expect(abaixoDoSaldo).toEqual({ saldoAtual: 10, mediaDiaria: null, precisaConfirmar: false });

    const acimaDoSaldo = await t.query(api.operador.consulta.checarPlausibilidade, {
      token: joao.token, produtoId, formatoId, tipo: "producao", quantidade: 60,
    });
    expect(acimaDoSaldo).toEqual({ saldoAtual: 10, mediaDiaria: null, precisaConfirmar: true });
  });

  test("com 30+ dias de histórico: quantidade > 3× a média diária pede confirmação", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    // Lançamento de 31 dias atrás — prova que há histórico de 30+ dias.
    const trintaEUmDias = 31 * 24 * 60 * 60 * 1000;
    await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: crypto.randomUUID(),
        tipo: "producao",
        sinal: 1,
        produtoId,
        camaraId,
        formatoId,
        quantidade: 60,
        pesoKg: 120,
        registradoPorTipo: "operador",
        registradoEm: Date.now() - trintaEUmDias,
      }),
    );
    // Mais 59 pacotes dentro dos últimos 30 dias: total 60 → média diária = 2.
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 59,
    });

    // Só os 59 pacotes de agora contam pra média — o lançamento de 31 dias
    // atrás fica fora da janela de 30 dias. Média = 59/30 ≈ 1,97/dia.
    const media = 59 / 30;

    // 5 pacotes é menos que 3× a média (≈5,9) — não pede confirmação.
    const normal = await t.query(api.operador.consulta.checarPlausibilidade, {
      token: joao.token, produtoId, formatoId, tipo: "producao", quantidade: 5,
    });
    expect(normal.mediaDiaria).toBeCloseTo(media, 5);
    expect(normal.precisaConfirmar).toBe(false);

    // 7 pacotes é mais que 3× a média (≈5,9) — pede confirmação, mesmo dentro do saldo.
    const implausivel = await t.query(api.operador.consulta.checarPlausibilidade, {
      token: joao.token, produtoId, formatoId, tipo: "producao", quantidade: 7,
    });
    expect(implausivel.precisaConfirmar).toBe(true);
  });

  test("durante contagem aberta, devolve null — mesma proteção da tarefa 1", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    await t.mutation(api.operador.contagem.abrir, { token: joao.token });

    const check = await t.query(api.operador.consulta.checarPlausibilidade, {
      token: joao.token, produtoId, formatoId, tipo: "producao", quantidade: 1000,
    });
    expect(check).toBeNull();
  });

  test("rejeita produtoId de outra câmara (RF07)", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    const outraCamaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Cubo" });
    const outroProdutoId = await admin.mutation(api.admin.produtos.criar, {
      nome: "Cubo", categoria: "cubo", camaraId: outraCamaraId, unidadeBase: "pacote",
    });

    await expect(
      t.query(api.operador.consulta.checarPlausibilidade, {
        token: joao.token, produtoId: outroProdutoId, formatoId, tipo: "producao", quantidade: 10,
      }),
    ).rejects.toThrow();
  });
});

describe("Tarefa 5 — desfazerMeuLancamento", () => {
  test("desfaz o próprio lançamento dentro da janela: contra-lançamento com sinal invertido", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    const { movimentacaoId } = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 10,
    });

    const { estornoId } = await t.mutation(api.operador.desfazer.desfazerMeuLancamento, {
      token: joao.token,
      lancamentoId: movimentacaoId,
    });

    const estorno = await t.run((ctx) => ctx.db.get(estornoId));
    expect(estorno?.tipo).toBe("estorno");
    expect(estorno?.sinal).toBe(-1);
    expect(estorno?.estornoDe).toBe(movimentacaoId);
    expect(estorno?.motivoTexto).toBe("desfeito pelo colaborador");
    expect(estorno?.autorNome).toBe("João");
    expect(estorno?.registradoPorTipo).toBe("operador");

    const saldo = await t.run((ctx) =>
      ctx.db
        .query("movimentacoes")
        .withIndex("by_produto_camara_formato", (q) =>
          q.eq("produtoId", produtoId).eq("camaraId", camaraId).eq("formatoId", formatoId),
        )
        .collect(),
    );
    expect(saldo.reduce((acc, m) => acc + m.sinal * m.quantidade, 0)).toBe(0);
  });

  test("bloqueia: só quem lançou pode desfazer", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");
    const maria = await operadorLogado(t, admin, camaraId, "Maria");

    const { movimentacaoId } = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 10,
    });

    await expect(
      t.mutation(api.operador.desfazer.desfazerMeuLancamento, {
        token: maria.token,
        lancamentoId: movimentacaoId,
      }),
    ).rejects.toThrow();
  });

  test("bloqueia: fora da janela de 5 minutos", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    // Lançamento simulado como se fosse de 6 minutos atrás.
    const seisMinAtras = Date.now() - 6 * 60 * 1000;
    const movimentacaoId = await t.run((ctx) =>
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
        operadorId: joao.operadorId,
        registradoEm: seisMinAtras,
      }),
    );

    await expect(
      t.mutation(api.operador.desfazer.desfazerMeuLancamento, {
        token: joao.token,
        lancamentoId: movimentacaoId,
      }),
    ).rejects.toThrow();
  });

  test("bloqueia: lançamento de outra câmara (a sessão do colaborador é de uma câmara só)", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const outraCamaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Cubo" });
    const joao = await operadorLogado(t, admin, camaraId, "João");
    // João também tem acesso à outra câmara — mas a SESSÃO dele é presa à primeira.
    await admin.mutation(api.admin.operadores.atualizar, {
      id: joao.operadorId,
      nome: "João",
      camarasPermitidas: [camaraId, outraCamaraId],
      podeLancarProducao: true,
      podeLancarSaida: true,
      podeContar: true,
      ativo: true,
    });

    const movimentacaoId = await t.run((ctx) =>
      ctx.db.insert("movimentacoes", {
        chaveIdempotencia: crypto.randomUUID(),
        tipo: "producao",
        sinal: 1,
        produtoId,
        camaraId: outraCamaraId,
        formatoId,
        quantidade: 10,
        pesoKg: 20,
        registradoPorTipo: "operador",
        operadorId: joao.operadorId,
        registradoEm: Date.now(),
      }),
    );

    await expect(
      t.mutation(api.operador.desfazer.desfazerMeuLancamento, {
        token: joao.token,
        lancamentoId: movimentacaoId,
      }),
    ).rejects.toThrow();
  });

  test("bloqueia: mesma regra de contagem aprovada do estorno do Admin", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const outroAdmin = await comoAdmin(t, "clerk_b", "Bianca Reis");
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    const { movimentacaoId } = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 10,
    });

    const { contagemId } = await admin.mutation(api.admin.contagens.abrir, { camaraId });
    await admin.mutation(api.admin.contagens.fechar, {
      contagemId,
      itens: [{ produtoId, formatoId, saldoContado: 10 }],
    });
    await outroAdmin.mutation(api.admin.contagens.aprovar, { contagemId });

    await expect(
      t.mutation(api.operador.desfazer.desfazerMeuLancamento, {
        token: joao.token,
        lancamentoId: movimentacaoId,
      }),
    ).rejects.toThrow();
  });
});

describe("Tarefa 6 — sessão, PIN e identidade", () => {
  test("a partir da 3ª tentativa a mensagem conta quantas faltam; 5ª bloqueia 1 min; 8ª bloqueia 15 min", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Saborizado" });
    const operadorId = await admin.mutation(api.admin.operadores.criar, {
      nome: "João",
      camarasPermitidas: [camaraId],
      podeLancarProducao: true,
      podeLancarSaida: true,
      podeContar: true,
    });
    const { pin } = await admin.mutation(api.admin.operadores.gerarPinOperador, { id: operadorId });
    const camara = await t.run((ctx) => ctx.db.get(camaraId));
    const pinErrado = pin === "000000" ? "111111" : "000000";

    // 1ª e 2ª: mensagem genérica, sem contar tentativas.
    const r1 = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin: pinErrado });
    expect(r1.ok).toBe(false);
    expect("mensagem" in r1 && r1.mensagem).not.toMatch(/tentativa/);
    await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin: pinErrado });

    // 3ª: "Mais 2 tentativas antes do bloqueio."
    const r3 = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin: pinErrado });
    expect("mensagem" in r3 && r3.mensagem).toContain("Mais 2 tentativas");

    // 4ª: "Mais 1 tentativa" (singular).
    const r4 = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin: pinErrado });
    expect("mensagem" in r4 && r4.mensagem).toContain("Mais 1 tentativa antes");

    // 5ª: bloqueia por 1 minuto.
    const r5 = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin: pinErrado });
    expect("mensagem" in r5 && r5.mensagem).toContain("Aguarde 1 minuto");
    const camaraApos5 = await t.run((ctx) => ctx.db.get(camaraId));
    expect(camaraApos5?.bloqueadoAte).toBeDefined();

    // Simula o minuto passando (sem esperar de verdade) pra continuar até a 8ª.
    await t.run((ctx) => ctx.db.patch(camaraId, { bloqueadoAte: Date.now() - 1000 }));
    await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin: pinErrado }); // 6ª
    await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin: pinErrado }); // 7ª
    const r8 = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin: pinErrado }); // 8ª
    expect("mensagem" in r8 && r8.mensagem).toContain("Aguarde 15 minutos");

    // O PIN certo continua recusado durante o bloqueio de 15 min.
    const certo = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin });
    expect(certo.ok).toBe(false);
  });

  test("login cria sessão de ~20 minutos (não mais 12h fixas)", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Saborizado" });
    const operadorId = await admin.mutation(api.admin.operadores.criar, {
      nome: "João",
      camarasPermitidas: [camaraId],
      podeLancarProducao: true,
      podeLancarSaida: true,
      podeContar: true,
    });
    const { pin } = await admin.mutation(api.admin.operadores.gerarPinOperador, { id: operadorId });
    const camara = await t.run((ctx) => ctx.db.get(camaraId));

    const antes = Date.now();
    const login = await t.mutation(api.operador.acesso.entrar, { qrToken: camara!.qrToken, pin });
    if (!login.ok) throw new Error("login falhou");

    const sessao = await t.run((ctx) =>
      ctx.db.query("sessoesOperador").withIndex("by_token", (q) => q.eq("token", login.token)).first(),
    );
    const duracaoMs = sessao!.expiraEm - antes;
    expect(duracaoMs).toBeLessThanOrEqual(20 * 60 * 1000 + 2000); // folga p/ tempo de execução do teste
    expect(duracaoMs).toBeGreaterThan(19 * 60 * 1000); // bem menor que as 12h de antes
  });

  test("uma mutation do colaborador estende a sessão (janela de inatividade desliza)", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const { camaraId, produtoId, formatoId } = await cadastroBase(admin);
    const joao = await operadorLogado(t, admin, camaraId, "João");

    // Simula a sessão prestes a expirar (2 min restantes).
    const sessaoAntes = await t.run((ctx) =>
      ctx.db.query("sessoesOperador").withIndex("by_token", (q) => q.eq("token", joao.token)).first(),
    );
    const expiraEmCurto = Date.now() + 2 * 60 * 1000;
    await t.run((ctx) => ctx.db.patch(sessaoAntes!._id, { expiraEm: expiraEmCurto }));

    // Uma mutation real (lançar produção) estende a janela pra ~20 min de novo.
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: joao.token,
      chaveIdempotencia: crypto.randomUUID(),
      produtoId,
      formatoId,
      quantidade: 5,
    });

    const sessaoDepois = await t.run((ctx) => ctx.db.get(sessaoAntes!._id));
    expect(sessaoDepois!.expiraEm).toBeGreaterThan(expiraEmCurto);
  });
});
