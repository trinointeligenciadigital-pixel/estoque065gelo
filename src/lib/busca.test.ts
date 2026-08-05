import { describe, expect, it } from "vitest";
import { normalizarBusca } from "./busca.ts";

describe("normalizarBusca", () => {
  it("remove acentos e ignora caixa", () => {
    expect(normalizarBusca("Maçã Verde")).toBe("maca verde");
    expect(normalizarBusca("maca")).toBe("maca");
    expect("maçã verde".includes("maca")).toBe(false);
    expect(normalizarBusca("Maçã Verde").includes(normalizarBusca("maca"))).toBe(true);
  });

  it("tira espaços nas pontas", () => {
    expect(normalizarBusca("  Água de Coco  ")).toBe("agua de coco");
  });
});
