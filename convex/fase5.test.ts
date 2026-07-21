import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// Cria câmara + operador ativo e uma sessão com a expiração desejada.
async function sessaoCom(t: ReturnType<typeof convexTest>, expiraEm: number, token: string) {
  return await t.run(async (ctx) => {
    const camaraId = await ctx.db.insert("camaras", {
      nome: "Câmara", qrToken: "qr", ativo: true,
    });
    const operadorId = await ctx.db.insert("operadores", {
      nome: "João", pinHash: "x", camarasPermitidas: [camaraId],
      podeLancarProducao: true, podeLancarSaida: true, podeContar: true,
      tentativasFalhas: 0, ativo: true,
    });
    await ctx.db.insert("sessoesOperador", { operadorId, camaraId, token, expiraEm });
    return { camaraId, operadorId };
  });
}

describe("RF09 — limpeza de sessões expiradas", () => {
  test("o cron remove as expiradas e mantém as válidas", async () => {
    const t = convexTest(schema, modules);
    const agora = Date.now();
    await sessaoCom(t, agora - 1000, "expirada"); // já venceu
    await sessaoCom(t, agora + 60 * 60 * 1000, "valida"); // vence daqui a 1h

    const r = await t.mutation(internal.manutencao.limparSessoesExpiradas, {});
    expect(r.removidas).toBe(1);

    const restantes = await t.run((ctx) => ctx.db.query("sessoesOperador").collect());
    expect(restantes.length).toBe(1);
    expect(restantes[0].token).toBe("valida");
  });

  test("sessão expirada não autoriza, mesmo antes de o cron rodar", async () => {
    const t = convexTest(schema, modules);
    await sessaoCom(t, Date.now() - 1000, "venceu");

    // A validação é por expiraEm a cada chamada, não pela existência do registro.
    await expect(
      t.query(api.operador.consulta.saldos, { token: "venceu" }),
    ).rejects.toThrow(/[Ss]essão/);
  });
});
