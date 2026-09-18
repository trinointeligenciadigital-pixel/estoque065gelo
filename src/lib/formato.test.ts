import { describe, expect, it } from "vitest";
import { formatarContagem, formatarPacotes, formatarPeso, formatarQuantidade, nomeUnidade, rotuloFormato } from "./formato.ts";

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

  it("abaixo de 1kg, mostra até 3 casas decimais sem perder precisão (peso de 1 unidade do saborizado)", () => {
    expect(formatarPeso(0.19)).toBe("0,19 kg");
    expect(formatarPeso(0.2)).toBe("0,2 kg");
    expect(formatarPeso(0.125)).toBe("0,125 kg");
    expect(formatarPeso(0)).toBe("0,0 kg");
  });

  it("1kg ou mais continua com exatamente 1 casa, mesmo vindo de pesos miúdos somados", () => {
    expect(formatarPeso(500 * 0.19)).toBe("95,0 kg");
  });
});

describe("formatarContagem (migração pacote→unidade)", () => {
  it("sem unidadeContagem, mantém o comportamento de sempre (pacote)", () => {
    expect(formatarContagem(1, { pesoVariavel: false })).toBe("1 pacote");
    expect(formatarContagem(2, { pesoVariavel: false })).toBe("2 pacotes");
  });

  it("com unidadeContagem 'pacote' explícito, mesmo resultado", () => {
    expect(formatarContagem(1, { pesoVariavel: false, unidadeContagem: "pacote" })).toBe("1 pacote");
  });

  it("com unidadeContagem 'unidade', usa singular/plural de 'unidade'", () => {
    expect(formatarContagem(1, { pesoVariavel: false, unidadeContagem: "unidade" })).toBe("1 unidade");
    expect(formatarContagem(30, { pesoVariavel: false, unidadeContagem: "unidade" })).toBe("30 unidades");
    expect(formatarContagem(0, { pesoVariavel: false, unidadeContagem: "unidade" })).toBe("0 unidades");
  });
});

describe("nomeUnidade", () => {
  it("escolhe o substantivo certo, no singular/plural certo", () => {
    expect(nomeUnidade({ pesoVariavel: false }, 1)).toBe("pacote");
    expect(nomeUnidade({ pesoVariavel: false }, 2)).toBe("pacotes");
    expect(nomeUnidade({ pesoVariavel: false, unidadeContagem: "unidade" }, 1)).toBe("unidade");
    expect(nomeUnidade({ pesoVariavel: false, unidadeContagem: "unidade" }, 2)).toBe("unidades");
  });
});

describe("formatarQuantidade", () => {
  it("peso variável sempre vira kg, não importa o unidadeContagem", () => {
    expect(formatarQuantidade(5.7, { pesoVariavel: true, unidadeContagem: "unidade" })).toBe("5,7 kg");
  });

  it("não-variável delega pro substantivo certo", () => {
    expect(formatarQuantidade(30, { pesoVariavel: false, unidadeContagem: "unidade" })).toBe("30 unidades");
    expect(formatarQuantidade(30, { pesoVariavel: false })).toBe("30 pacotes");
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
