import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { verificarPin } from "./lib/pin";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// Cria um Admin ativo e devolve um `t` autenticado como esse Admin.
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

describe("Produtos (RF22) — câmara é imutável após a criação", () => {
  test("atualizar não muda a câmara, e tentar passar camaraId é rejeitado", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);

    const camaraA = await admin.mutation(api.admin.camaras.criar, { nome: "Saborizado" });
    const camaraB = await admin.mutation(api.admin.camaras.criar, { nome: "Cubo/Escamado" });

    const produtoId = await admin.mutation(api.admin.produtos.criar, {
      nome: "Morango",
      categoria: "saborizado",
      camaraId: camaraA,
      unidadeBase: "pacote",
    });

    // Update legítimo (sem câmara) funciona e não toca na câmara.
    await admin.mutation(api.admin.produtos.atualizar, {
      id: produtoId,
      nome: "Morango Especial",
      unidadeBase: "pacote",
      ativo: true,
    });
    const depois = await t.run((ctx) => ctx.db.get(produtoId));
    expect(depois?.camaraId).toBe(camaraA);
    expect(depois?.nome).toBe("Morango Especial");

    // Forjar camaraId no payload é rejeitado pela validação do Convex (RF22):
    // a câmara não pode ser alterada nem chamando a mutation diretamente.
    await expect(
      admin.mutation(api.admin.produtos.atualizar, {
        id: produtoId,
        nome: "Morango",
        unidadeBase: "pacote",
        ativo: true,
        camaraId: camaraB,
      } as never),
    ).rejects.toThrow();

    // E a câmara continua sendo a original.
    const final = await t.run((ctx) => ctx.db.get(produtoId));
    expect(final?.camaraId).toBe(camaraA);
  });
});

describe("Produtos — nome duplicado (sprint P0, tarefa 2)", () => {
  test("bloqueia nome repetido na MESMA câmara, mas permite em câmaras diferentes", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);

    const camaraA = await admin.mutation(api.admin.camaras.criar, { nome: "Cubo/Escama" });
    const camaraB = await admin.mutation(api.admin.camaras.criar, { nome: "Conteiner" });

    await admin.mutation(api.admin.produtos.criar, {
      nome: "Cubo",
      categoria: "cubo",
      camaraId: camaraA,
      unidadeBase: "pacote",
    });

    // Mesma câmara, nome repetido (mesmo com espaços/caixa diferentes) — rejeitado.
    await expect(
      admin.mutation(api.admin.produtos.criar, {
        nome: " cubo ",
        categoria: "cubo",
        camaraId: camaraA,
        unidadeBase: "pacote",
      }),
    ).rejects.toThrow();

    // Câmara diferente, mesmo nome — é o caso real da 065, permitido.
    const idNaOutraCamara = await admin.mutation(api.admin.produtos.criar, {
      nome: "Cubo",
      categoria: "cubo",
      camaraId: camaraB,
      unidadeBase: "pacote",
    });
    expect(idNaOutraCamara).toBeDefined();
  });

  test("bloqueia renomear para um nome já usado na mesma câmara", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);
    const camara = await admin.mutation(api.admin.camaras.criar, { nome: "Saborizado" });

    await admin.mutation(api.admin.produtos.criar, {
      nome: "Morango",
      categoria: "saborizado",
      camaraId: camara,
      unidadeBase: "pacote",
    });
    const uva = await admin.mutation(api.admin.produtos.criar, {
      nome: "Uva",
      categoria: "saborizado",
      camaraId: camara,
      unidadeBase: "pacote",
    });

    await expect(
      admin.mutation(api.admin.produtos.atualizar, {
        id: uva,
        nome: "Morango",
        unidadeBase: "pacote",
        ativo: true,
      }),
    ).rejects.toThrow();
  });
});

describe("Operadores — PIN e sessões (RF12, RF13, RF14, RNF05)", () => {
  test("gerar PIN salva só o hash, devolve o PIN uma vez e derruba a sessão ativa", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);

    const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Saborizado" });
    const operadorId = await admin.mutation(api.admin.operadores.criar, {
      nome: "João",
      camarasPermitidas: [camaraId],
      podeLancarProducao: true,
      podeLancarSaida: true,
      podeContar: false,
    });

    // Simula uma sessão ativa desse operador.
    await t.run((ctx) =>
      ctx.db.insert("sessoesOperador", {
        operadorId,
        camaraId,
        token: "token-antigo",
        expiraEm: Date.now() + 12 * 60 * 60 * 1000,
      }),
    );

    const { pin } = await admin.mutation(api.admin.operadores.gerarPinOperador, {
      id: operadorId,
    });

    // PIN de 6 dígitos, devolvido só nesta resposta.
    expect(pin).toMatch(/^\d{6}$/);

    // A sessão ativa foi derrubada na mesma transação (RF14).
    const sessoes = await t.run((ctx) =>
      ctx.db
        .query("sessoesOperador")
        .withIndex("by_operador_id", (q) => q.eq("operadorId", operadorId))
        .collect(),
    );
    expect(sessoes.length).toBe(0);

    // O hash salvo confere com o PIN retornado; e é hash, não o PIN em texto.
    const operador = await t.run((ctx) => ctx.db.get(operadorId));
    expect(operador?.pinHash).not.toBe(pin);
    expect(operador?.pinHash.startsWith("pbkdf2$")).toBe(true);
    expect(await verificarPin(pin, operador!.pinHash)).toBe(true);

    // O `listar` nunca expõe o pinHash — só se existe PIN.
    const lista = await admin.query(api.admin.operadores.listar, {});
    const encontrado = lista.find((o) => o._id === operadorId);
    expect(encontrado?.temPin).toBe(true);
    expect(JSON.stringify(lista)).not.toContain("pbkdf2$");
  });

  test("desativar operador derruba as sessões ativas dele (RF16)", async () => {
    const t = convexTest(schema, modules);
    const admin = await comoAdmin(t);

    const camaraId = await admin.mutation(api.admin.camaras.criar, { nome: "Saborizado" });
    const operadorId = await admin.mutation(api.admin.operadores.criar, {
      nome: "Maria",
      camarasPermitidas: [camaraId],
      podeLancarProducao: true,
      podeLancarSaida: false,
      podeContar: false,
    });
    await t.run((ctx) =>
      ctx.db.insert("sessoesOperador", {
        operadorId,
        camaraId,
        token: "tok",
        expiraEm: Date.now() + 1000000,
      }),
    );

    await admin.mutation(api.admin.operadores.atualizar, {
      id: operadorId,
      nome: "Maria",
      camarasPermitidas: [camaraId],
      podeLancarProducao: true,
      podeLancarSaida: false,
      podeContar: false,
      ativo: false,
    });

    const sessoes = await t.run((ctx) =>
      ctx.db
        .query("sessoesOperador")
        .withIndex("by_operador_id", (q) => q.eq("operadorId", operadorId))
        .collect(),
    );
    expect(sessoes.length).toBe(0);
  });
});

describe("Autorização (RNF04) — sem Admin, nada de cadastro", () => {
  test("criar câmara sem identidade é rejeitado", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.admin.camaras.criar, { nome: "X" })).rejects.toThrow();
  });
});
