import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { saldoDoFormato } from "./lib/saldo";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

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

// Monta câmara + produto + formato + operador com PIN, e faz login, devolvendo
// um token de sessão válido pronto para os lançamentos.
async function setup(
  t: ReturnType<typeof convexTest>,
  opts?: { pesoVariavel?: boolean },
) {
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
    nome: opts?.pesoVariavel ? "Granel" : "Saco 2kg",
    pesoKg: opts?.pesoVariavel ? 0 : 2,
    pesoVariavel: opts?.pesoVariavel ?? false,
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

  return { t, admin, camaraId, produtoId, formatoId, operadorId, token: login.token, qrToken: camara!.qrToken, pin };
}

describe("Saída x saldo (RF35)", () => {
  test("saída acima do saldo do formato é rejeitada, sem saldo negativo", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "p1", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 5,
    });

    // Vender 10 com saldo 5 → bloqueado.
    await expect(
      t.mutation(api.operador.lancamentos.lancarSaida, {
        token: s.token, chaveIdempotencia: "v1", tipo: "venda", produtoId: s.produtoId,
        formatoId: s.formatoId, quantidade: 10, clienteNome: "Bar do Zé",
      }),
    ).rejects.toThrow(/[Ss]aldo insuficiente/);

    // Vender 5 (exatamente o saldo) passa; o saldo vai a zero, nunca negativo.
    await t.mutation(api.operador.lancamentos.lancarSaida, {
      token: s.token, chaveIdempotencia: "v2", tipo: "venda", produtoId: s.produtoId,
      formatoId: s.formatoId, quantidade: 5, clienteNome: "Bar do Zé",
    });
    const saldos = await t.query(api.operador.consulta.saldos, { token: s.token });
    const f = saldos[0].formatos[0];
    expect(f.saldo).toBe(0);
  });
});

describe("Idempotência (RF34)", () => {
  test("mesma chave não duplica; devolve a movimentação existente", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);

    const r1 = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "dup", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 4,
    });
    const r2 = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "dup", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 4,
    });

    expect(r1.duplicado).toBe(false);
    expect(r2.duplicado).toBe(true);
    expect(r2.movimentacaoId).toBe(r1.movimentacaoId);

    const todas = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_chave_idempotencia", (q) => q.eq("chaveIdempotencia", "dup")).collect(),
    );
    expect(todas.length).toBe(1);
  });
});

describe("Barreira de câmara no lançamento (RF07)", () => {
  test("operador da câmara A não escreve em produto da câmara B, mesmo forjando o produtoId", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t); // sessão na Câmara Saborizado

    // Produto numa OUTRA câmara.
    const camaraB = await s.admin.mutation(api.admin.camaras.criar, { nome: "Câmara Cubo/Escamado" });
    const produtoB = await s.admin.mutation(api.admin.produtos.criar, {
      nome: "Cubo", categoria: "cubo", camaraId: camaraB, unidadeBase: "pacote",
    });
    const formatoB = await s.admin.mutation(api.admin.formatos.criar, {
      produtoId: produtoB, nome: "Saco 5kg", pesoKg: 5, pesoVariavel: false,
    });

    await expect(
      t.mutation(api.operador.lancamentos.lancarProducao, {
        token: s.token, chaveIdempotencia: "forjado", produtoId: produtoB, formatoId: formatoB, quantidade: 1,
      }),
    ).rejects.toThrow(/não pertence a esta câmara/);
  });
});

describe("sinal e pesoKg no servidor (RF33)", () => {
  test("são derivados do tipo e do formato, não do cliente", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);

    const r = await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "srv", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 3,
    });
    const mov = await t.run((ctx) => ctx.db.get(r.movimentacaoId));
    expect(mov?.sinal).toBe(1); // produção = entrada, definido no servidor
    expect(mov?.quantidade).toBe(3);
    expect(mov?.pesoKg).toBe(6); // 3 × 2kg, calculado no servidor
  });
});

describe("Retorno de patrocínio (RF41)", () => {
  test("a soma dos retornos nunca ultrapassa o que saiu no patrocínio", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "prod", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 10,
    });
    const pat = await t.mutation(api.operador.lancamentos.lancarSaida, {
      token: s.token, chaveIdempotencia: "pat", tipo: "patrocinio", produtoId: s.produtoId,
      formatoId: s.formatoId, quantidade: 10, clienteNome: "Evento X",
    });

    // Retorna 6 (ok).
    await t.mutation(api.operador.lancamentos.lancarRetorno, {
      token: s.token, chaveIdempotencia: "ret1", patrocinioOrigemId: pat.movimentacaoId, quantidade: 6,
    });
    // Tenta retornar mais 5 → 6 + 5 = 11 > 10 → rejeitado.
    await expect(
      t.mutation(api.operador.lancamentos.lancarRetorno, {
        token: s.token, chaveIdempotencia: "ret2", patrocinioOrigemId: pat.movimentacaoId, quantidade: 5,
      }),
    ).rejects.toThrow(/Retorno maior/);

    // Retornar mais 4 (total 10) ainda cabe.
    await t.mutation(api.operador.lancamentos.lancarRetorno, {
      token: s.token, chaveIdempotencia: "ret3", patrocinioOrigemId: pat.movimentacaoId, quantidade: 4,
    });
    const abertos = await t.query(api.operador.consulta.patrociniosAbertos, { token: s.token });
    expect(abertos.length).toBe(0); // nada mais em aberto
  });
});

describe("Carregamento — saída de vários produtos (lancarSaidaMultipla)", () => {
  // Cria um 2º produto+formato na MESMA câmara da sessão, para os testes de lote.
  async function segundoFormato(s: Awaited<ReturnType<typeof setup>>) {
    const produtoId = await s.admin.mutation(api.admin.produtos.criar, {
      nome: "Uva", categoria: "saborizado", camaraId: s.camaraId, unidadeBase: "pacote",
    });
    const formatoId = await s.admin.mutation(api.admin.formatos.criar, {
      produtoId, nome: "Saco 5kg", pesoKg: 5, pesoVariavel: false,
    });
    return { produtoId, formatoId };
  }

  test("grava todas as linhas com o mesmo carregamentoId e baixa o saldo de cada formato", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const b = await segundoFormato(s);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "pa", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 5,
    });
    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "pb", produtoId: b.produtoId, formatoId: b.formatoId, quantidade: 5,
    });

    const r = await t.mutation(api.operador.lancamentos.lancarSaidaMultipla, {
      token: s.token, carregamentoId: "carr-1", tipo: "venda", clienteNome: "Bar do Zé",
      itens: [
        { chaveIdempotencia: "i1", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 2 },
        { chaveIdempotencia: "i2", produtoId: b.produtoId, formatoId: b.formatoId, quantidade: 3 },
      ],
    });
    expect(r.duplicado).toBe(false);
    expect(r.movimentacaoIds.length).toBe(2);

    const doCarregamento = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_carregamento", (q) => q.eq("carregamentoId", "carr-1")).collect(),
    );
    expect(doCarregamento.length).toBe(2);
    expect(doCarregamento.every((m) => m.sinal === -1 && m.tipo === "venda")).toBe(true);

    expect(await t.run((ctx) => saldoDoFormato(ctx, s.produtoId, s.camaraId, s.formatoId))).toBe(3); // 5 − 2
    expect(await t.run((ctx) => saldoDoFormato(ctx, b.produtoId, s.camaraId, b.formatoId))).toBe(2); // 5 − 3
  });

  test("é atômico: se um item estoura o saldo, nenhuma linha entra", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const b = await segundoFormato(s);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "pa", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 5,
    });
    // formato B fica com saldo 0 (sem produção)

    await expect(
      t.mutation(api.operador.lancamentos.lancarSaidaMultipla, {
        token: s.token, carregamentoId: "carr-2", tipo: "venda", clienteNome: "Bar do Zé",
        itens: [
          { chaveIdempotencia: "i1", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 2 },
          { chaveIdempotencia: "i2", produtoId: b.produtoId, formatoId: b.formatoId, quantidade: 1 },
        ],
      }),
    ).rejects.toThrow(/[Ss]aldo insuficiente/);

    const doCarregamento = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_carregamento", (q) => q.eq("carregamentoId", "carr-2")).collect(),
    );
    expect(doCarregamento.length).toBe(0); // nada gravado
    expect(await t.run((ctx) => saldoDoFormato(ctx, s.produtoId, s.camaraId, s.formatoId))).toBe(5); // intacto
  });

  test("soma o pedido de linhas do MESMO formato antes de validar o saldo", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "pa", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 5,
    });

    // Duas linhas do mesmo formato: 3 + 3 = 6 > 5 → bloqueado (cada uma sozinha passaria).
    await expect(
      t.mutation(api.operador.lancamentos.lancarSaidaMultipla, {
        token: s.token, carregamentoId: "carr-3", tipo: "venda", clienteNome: "Bar do Zé",
        itens: [
          { chaveIdempotencia: "i1", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 3 },
          { chaveIdempotencia: "i2", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 3 },
        ],
      }),
    ).rejects.toThrow(/[Ss]aldo insuficiente/);
  });

  test("idempotência do lote: mesmo carregamentoId não duplica", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);

    await t.mutation(api.operador.lancamentos.lancarProducao, {
      token: s.token, chaveIdempotencia: "pa", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 5,
    });

    const args = {
      token: s.token, carregamentoId: "carr-4", tipo: "venda" as const, clienteNome: "Bar do Zé",
      itens: [{ chaveIdempotencia: "i1", produtoId: s.produtoId, formatoId: s.formatoId, quantidade: 2 }],
    };
    const r1 = await t.mutation(api.operador.lancamentos.lancarSaidaMultipla, args);
    const r2 = await t.mutation(api.operador.lancamentos.lancarSaidaMultipla, args);

    expect(r1.duplicado).toBe(false);
    expect(r2.duplicado).toBe(true);

    const doCarregamento = await t.run((ctx) =>
      ctx.db.query("movimentacoes").withIndex("by_carregamento", (q) => q.eq("carregamentoId", "carr-4")).collect(),
    );
    expect(doCarregamento.length).toBe(1); // só o primeiro lote gravou
    expect(await t.run((ctx) => saldoDoFormato(ctx, s.produtoId, s.camaraId, s.formatoId))).toBe(3); // baixou uma vez só
  });
});

describe("Bloqueio de PIN por câmara (RF08)", () => {
  test("5 PINs errados bloqueiam o teclado da câmara, e o PIN certo também é recusado durante o bloqueio", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t); // já criou operador com PIN e câmara

    const pinErrado = s.pin === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await t.mutation(api.operador.acesso.entrar, { qrToken: s.qrToken, pin: pinErrado });
      expect(r.ok).toBe(false);
    }

    const camara = await t.run((ctx) => ctx.db.get(s.camaraId as Id<"camaras">));
    expect(camara?.bloqueadoAte).toBeDefined();
    expect(camara!.bloqueadoAte!).toBeGreaterThan(Date.now());

    // Mesmo o PIN certo é recusado enquanto a câmara está bloqueada.
    const certo = await t.mutation(api.operador.acesso.entrar, { qrToken: s.qrToken, pin: s.pin });
    expect(certo.ok).toBe(false);
  });
});
