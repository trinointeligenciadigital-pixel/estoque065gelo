import { describe, expect, it } from "vitest";
import { formatarPacotes, formatarPeso } from "./formato.ts";

describe("formatarPacotes", () => {
  it("usa singular só para exatamente 1", () => {
    expect(formatarPacotes(1)).toBe("1 pacote");
    expect(formatarPacotes(0)).toBe("0 pacotes");
    expect(formatarPacotes(2)).toBe("2 pacotes");
  });

  it("usa separador de milhar pt-BR e nunca casas decimais", () => {
    expect(formatarPacotes(1461)).toBe("1.461 pacotes");
    expect(formatarPacotes(79)).toBe("79 pacotes");
  });

  it("preserva o sinal negativo", () => {
    expect(formatarPacotes(-1130)).toBe("-1.130 pacotes");
    expect(formatarPacotes(-1)).toBe("-1 pacote");
  });
});

describe("formatarPeso", () => {
  it("sempre mostra exatamente 1 casa decimal, com vírgula", () => {
    expect(formatarPeso(37047)).toBe("37.047,0 kg");
    expect(formatarPeso(1077.3)).toBe("1.077,3 kg");
    expect(formatarPeso(5.7)).toBe("5,7 kg");
  });

  it("preserva o sinal negativo", () => {
    expect(formatarPeso(-250.4)).toBe("-250,4 kg");
  });
});
