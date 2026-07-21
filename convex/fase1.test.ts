import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { saldoDoFormato, pesoTotalDoProduto } from "./lib/saldo";
import { movimentacaoExistente } from "./lib/idempotencia";
import { exigirCamaraDoProduto, exigirAdmin } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

// Registra os módulos do backend para o convex-test (exceto os próprios testes).
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// Cria uma câmara com um produto e dois formatos, para os testes de saldo.
async function cenarioBase(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const camaraId = await ctx.db.insert("camaras", {
      nome: "Câmara Saborizado",
      qrToken: "qr-sab",
      ativo: true,
    });
    const produtoId = await ctx.db.insert("produtos", {
      nome: "Morango",
      categoria: "saborizado",
      camaraId,
      unidadeBase: "pacote",
      ativo: true,
    });
    const f2kg = await ctx.db.insert("formatos", {
      produtoId,
      nome: "Saco 2kg",
      pesoKg: 2,
      pesoVariavel: false,
      ativo: true,
    });
    const f5kg = await ctx.db.insert("formatos", {
      produtoId,
      nome: "Saco 5kg",
      pesoKg: 5,
      pesoVariavel: false,
      ativo: true,
    });
    return { camaraId, produtoId, f2kg, f5kg };
  });
}

// Insere uma movimentação já com sinal e pesoKg derivados (aqui, no teste, os
// calculamos à mão; nas mutations reais quem calcula é o servidor).
async function inserirMov(
  t: ReturnType<typeof convexTest>,
  args: {
    chave: string;
    tipo: "producao" | "venda";
    produtoId: Id<"produtos">;
    camaraId: Id<"camaras">;
    formatoId: Id<"formatos">;
    quantidade: number;
    pesoUnit: number;
  },
) {
  const sinal = args.tipo === "producao" ? 1 : -1;
  await t.run(async (ctx) => {
    await ctx.db.insert("movimentacoes", {
      chaveIdempotencia: args.chave,
      tipo: args.tipo,
      sinal,
      produtoId: args.produtoId,
      camaraId: args.camaraId,
      formatoId: args.formatoId,
      quantidade: args.quantidade,
      pesoKg: args.quantidade * args.pesoUnit,
      registradoPorTipo: "operador",
      registradoEm: Date.now(),
    });
  });
}

describe("saldoDoFormato (RNF01, RNF03) — soma do ledger, por formato", () => {
  test("soma entradas e saídas do formato, isolado dos outros formatos", async () => {
    const t = convexTest(schema, modules);
    const { camaraId, produtoId, f2kg, f5kg } = await cenarioBase(t);

    await inserirMov(t, { chave: "a1", tipo: "producao", produtoId, camaraId, formatoId: f2kg, quantidade: 10, pesoUnit: 2 });
    await inserirMov(t, { chave: "a2", tipo: "venda", produtoId, camaraId, formatoId: f2kg, quantidade: 3, pesoUnit: 2 });
    await inserirMov(t, { chave: "a3", tipo: "producao", produtoId, camaraId, formatoId: f5kg, quantidade: 4, pesoUnit: 5 });

    const saldo2kg = await t.run((ctx) => saldoDoFormato(ctx, produtoId, camaraId, f2kg));
    const saldo5kg = await t.run((ctx) => saldoDoFormato(ctx, produtoId, camaraId, f5kg));

    expect(saldo2kg).toBe(7); // 10 − 3
    expect(saldo5kg).toBe(4); // isolado do formato de 2kg
  });

  test("pesoTotalDoProduto agrega os formatos POR PESO, nunca somando quantidade", async () => {
    const t = convexTest(schema, modules);
    const { camaraId, produtoId, f2kg, f5kg } = await cenarioBase(t);

    await inserirMov(t, { chave: "b1", tipo: "producao", produtoId, camaraId, formatoId: f2kg, quantidade: 10, pesoUnit: 2 });
    await inserirMov(t, { chave: "b2", tipo: "venda", produtoId, camaraId, formatoId: f2kg, quantidade: 3, pesoUnit: 2 });
    await inserirMov(t, { chave: "b3", tipo: "producao", produtoId, camaraId, formatoId: f5kg, quantidade: 4, pesoUnit: 5 });

    const peso = await t.run((ctx) => pesoTotalDoProduto(ctx, produtoId, camaraId));

    // (10−3)*2 + 4*5 = 14 + 20 = 34 kg. Somar quantidade (7+4=11) estaria errado.
    expect(peso).toBe(34);
  });
});

describe("movimentacaoExistente (RF34) — idempotência", () => {
  test("devolve o registro existente pela chave e null quando não existe", async () => {
    const t = convexTest(schema, modules);
    const { camaraId, produtoId, f2kg } = await cenarioBase(t);
    await inserirMov(t, { chave: "chave-x", tipo: "producao", produtoId, camaraId, formatoId: f2kg, quantidade: 1, pesoUnit: 2 });

    const achado = await t.run((ctx) => movimentacaoExistente(ctx, "chave-x"));
    const inexistente = await t.run((ctx) => movimentacaoExistente(ctx, "chave-y"));

    expect(achado).not.toBeNull();
    expect(achado?.chaveIdempotencia).toBe("chave-x");
    expect(inexistente).toBeNull();
  });
});

describe("exigirCamaraDoProduto (RF07) — barreira de câmara", () => {
  test("aceita produto da câmara certa e rejeita produto de outra câmara", async () => {
    const t = convexTest(schema, modules);
    const { camaraId, produtoId } = await cenarioBase(t);
    const outraCamara = await t.run((ctx) =>
      ctx.db.insert("camaras", { nome: "Câmara Cubo/Escamado", qrToken: "qr-cubo", ativo: true }),
    );

    const produto = await t.run((ctx) => exigirCamaraDoProduto(ctx, produtoId, camaraId));
    expect(produto._id).toBe(produtoId);

    // Operador com sessão em outra câmara não escreve neste produto, mesmo
    // forjando o produtoId no payload.
    await expect(
      t.run((ctx) => exigirCamaraDoProduto(ctx, produtoId, outraCamara)),
    ).rejects.toThrow();
  });
});

describe("exigirAdmin (RF01) — só Admin ativo acessa", () => {
  test("sem identidade, sem registro, e registro inativo são todos rejeitados", async () => {
    const t = convexTest(schema, modules);

    // Sem identidade do Clerk.
    await expect(t.run((ctx) => exigirAdmin(ctx))).rejects.toThrow();

    // Identidade do Clerk sem registro em `usuarios`.
    const semRegistro = t.withIdentity({ subject: "clerk_sem_registro" });
    await expect(semRegistro.run((ctx) => exigirAdmin(ctx))).rejects.toThrow();

    // Registro existente, mas ativo:false.
    await t.run((ctx) =>
      ctx.db.insert("usuarios", {
        clerkId: "clerk_inativo",
        nome: "Fulano",
        email: "f@ex.com",
        papel: "admin",
        ativo: false,
      }),
    );
    const inativo = t.withIdentity({ subject: "clerk_inativo" });
    await expect(inativo.run((ctx) => exigirAdmin(ctx))).rejects.toThrow();
  });

  test("Admin ativo é aceito e devolvido", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("usuarios", {
        clerkId: "clerk_ok",
        nome: "Alisson",
        email: "a@ex.com",
        papel: "admin",
        ativo: true,
      }),
    );

    const admin = t.withIdentity({ subject: "clerk_ok" });
    const usuario = await admin.run((ctx) => exigirAdmin(ctx));
    expect(usuario.nome).toBe("Alisson");
    expect(usuario.ativo).toBe(true);
  });
});
