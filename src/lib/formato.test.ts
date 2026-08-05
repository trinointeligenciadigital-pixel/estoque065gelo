import { describe, expect, it } from "vitest";
import { formatarPacotes, formatarPeso, rotuloFormato } from "./formato.ts";

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

describe("rotuloFormato", () => {
  it("monta peso e unidades no mesmo rótulo, exatamente como no adendo", () => {
    expect(rotuloFormato({ nome: "Pacote", pesoKg: 5.7, pesoVariavel: false, unidadesPorPacote: 30 })).toBe(
      "Pacote 5,7 kg · 30 un",
    );
  });

  it("sem unidadesPorPacote, mostra só nome e peso", () => {
    expect(rotuloFormato({ nome: "Pacote", pesoKg: 20, pesoVariavel: false })).toBe("Pacote 20,0 kg");
  });

  it("peso variável usa o nome sozinho como rótulo (não há peso fixo pra mostrar)", () => {
    expect(rotuloFormato({ nome: "Granel", pesoKg: 0, pesoVariavel: true, unidadesPorPacote: 30 })).toBe("Granel");
  });
});
