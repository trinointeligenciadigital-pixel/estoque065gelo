import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function comoAdmin(t: ReturnType<typeof convexTest>, clerkId: string) {
  await t.run((ctx) =>
    ctx.db.insert("usuarios", { clerkId, nome: clerkId, email: `${clerkId}@ex.com`, papel: "admin", ativo: true }),
  );
  return t.withIdentity({ subject: clerkId });
}

// Duas câmaras e três produtos:
//   Câmara Saborizado: Morango (2kg/pacote) e Uva (2kg/pacote)
//   Câmara Cubo: Cubo (5kg/pacote)
// Lançamentos (hoje): Morango 5 pac (10 kg) + venda de 2 pac (4 kg); Uva 3 pac (6 kg); Cubo 4 pac (20 kg).
async function cenario() {
  const t = convexTest(schema, modules);
  const admin = await comoAdmin(t, "clerk_a");

  const camSabor = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Saborizado" });
  const camCubo = await admin.mutation(api.admin.camaras.criar, { nome: "Câmara Cubo" });

  async function produto(nome: string, categoria: "saborizado" | "cubo", camaraId: typeof camSabor, pesoKg: number) {
    const produtoId = await admin.mutation(api.admin.produtos.criar, { nome, categoria, camaraId, unidadeBase: "pacote" });
    const formatoId = await admin.mutation(api.admin.formatos.criar, { produtoId, nome: `Saco ${pesoKg}kg`, pesoKg, pesoVariavel: false });
    return { produtoId, formatoId };
  }
  const morango = await produto("Morango", "saborizado", camSabor, 2);
  const uva = await produto("Uva", "saborizado", camSabor, 2);
  const cubo = await produto("Cubo", "cubo", camCubo, 5);

  await admin.mutation(api.admin.lancamentos.lancarProducao, { chaveIdempotencia: "m1", ...morango, quantidade: 5 });
  await admin.mutation(api.admin.lancamentos.lancarProducao, { chaveIdempotencia: "u1", ...uva, quantidade: 3 });
  await admin.mutation(api.admin.lancamentos.lancarProducao, { chaveIdempotencia: "c1", ...cubo, quantidade: 4 });
  await admin.mutation(api.admin.lancamentos.lancarSaida, {
    chaveIdempotencia: "v1", tipo: "venda", ...morango, quantidade: 2, clienteNome: "Cliente",
  });

  return { admin, camSabor, camCubo, morango, uva, cubo };
}

describe("Painel — movimento por período com recorte", () => {
  test("sem filtro soma a fábrica inteira (comportamento anterior)", async () => {
    const { admin } = await cenario();
    const r = await admin.query(api.admin.painel.movimentoPorPeriodo, { dias: 7 });
    expect(r.totais.producaoKg).toBe(36);
    expect(r.totais.saidasKg).toBe(4);
    expect(r.totais.qtdLancamentos).toBe(3);
  });

  test("por câmara: só o que aconteceu naquela câmara", async () => {
    const { admin, camSabor, camCubo } = await cenario();
    const sabor = await admin.query(api.admin.painel.movimentoPorPeriodo, { dias: 7, camaraId: camSabor });
    expect(sabor.totais).toMatchObject({ producaoKg: 16, saidasKg: 4, qtdLancamentos: 2 });
    const cubo = await admin.query(api.admin.painel.movimentoPorPeriodo, { dias: 7, camaraId: camCubo });
    expect(cubo.totais).toMatchObject({ producaoKg: 20, saidasKg: 0, qtdLancamentos: 1 });
  });

  test("por categoria e por produto", async () => {
    const { admin, uva, morango } = await cenario();
    const cat = await admin.query(api.admin.painel.movimentoPorPeriodo, { dias: 7, categoria: "cubo" });
    expect(cat.totais).toMatchObject({ producaoKg: 20, saidasKg: 0 });

    const soUva = await admin.query(api.admin.painel.movimentoPorPeriodo, { dias: 7, produtoId: uva.produtoId });
    expect(soUva.totais).toMatchObject({ producaoKg: 6, saidasKg: 0 });

    const soMorango = await admin.query(api.admin.painel.movimentoPorPeriodo, { dias: 7, produtoId: morango.produtoId });
    expect(soMorango.totais).toMatchObject({ producaoKg: 10, saidasKg: 4 });
  });

  test("filtros combinam por E; recorte vazio devolve zeros, com o eixo de dias intacto", async () => {
    const { admin, camCubo } = await cenario();
    // Câmara de cubo + categoria saborizado: nada casa.
    const r = await admin.query(api.admin.painel.movimentoPorPeriodo, {
      dias: 7, camaraId: camCubo, categoria: "saborizado",
    });
    expect(r.totais).toMatchObject({ producaoKg: 0, saidasKg: 0, qtdLancamentos: 0 });
    expect(r.serie).toHaveLength(7);
  });

  test("continua exigindo Admin", async () => {
    const { camSabor } = await cenario();
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.admin.painel.movimentoPorPeriodo, { dias: 7, camaraId: camSabor }),
    ).rejects.toThrow();
  });
});
