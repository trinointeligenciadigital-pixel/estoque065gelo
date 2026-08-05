import { describe, expect, test } from "vitest";
import { mascaraPlaca, placaCompleta, mascaraTelefone, telefoneCompleto } from "./mascaras.ts";

describe("mascaraPlaca", () => {
  test("aceita o formato Mercosul (ABC1D23)", () => {
    expect(mascaraPlaca("abc1d23")).toBe("ABC1D23");
  });
  test("aceita o formato antigo (ABC1234)", () => {
    expect(mascaraPlaca("abc1234")).toBe("ABC1234");
  });
  test("ignora separadores e espaços digitados", () => {
    expect(mascaraPlaca("abc-1d23")).toBe("ABC1D23");
    expect(mascaraPlaca("ABC 1234")).toBe("ABC1234");
  });
  test("força o tipo por posição: letra onde é letra, dígito onde é dígito", () => {
    // 3 letras: dígitos no começo são descartados
    expect(mascaraPlaca("1ab2c")).toBe("ABC");
    // posição 4 é dígito: uma letra ali é descartada
    expect(mascaraPlaca("ABCD")).toBe("ABC");
    // posições 6–7 são dígitos: letras ali são descartadas
    expect(mascaraPlaca("ABC1D2X")).toBe("ABC1D2");
  });
  test("nunca passa de 7 caracteres", () => {
    expect(mascaraPlaca("ABC1D23999")).toBe("ABC1D23");
  });
  test("placaCompleta só com 7 caracteres", () => {
    expect(placaCompleta("ABC1D23")).toBe(true);
    expect(placaCompleta("ABC1D2")).toBe(false);
    expect(placaCompleta("")).toBe(false);
  });
});

describe("mascaraTelefone", () => {
  test("celular de 11 dígitos vira (DD) 99999-9999", () => {
    expect(mascaraTelefone("65999999999")).toBe("(65) 99999-9999");
  });
  test("fixo de 10 dígitos vira (DD) 9999-9999", () => {
    expect(mascaraTelefone("6533334444")).toBe("(65) 3333-4444");
  });
  test("formata progressivamente enquanto digita", () => {
    expect(mascaraTelefone("6")).toBe("(6");
    expect(mascaraTelefone("65")).toBe("(65");
    expect(mascaraTelefone("659")).toBe("(65) 9");
    expect(mascaraTelefone("659999")).toBe("(65) 9999");
  });
  test("ignora não-dígitos e o excesso além de 11", () => {
    expect(mascaraTelefone("(65) 99999-9999")).toBe("(65) 99999-9999");
    expect(mascaraTelefone("659999999990000")).toBe("(65) 99999-9999");
  });
  test("telefoneCompleto só com 10 ou 11 dígitos", () => {
    expect(telefoneCompleto("(65) 99999-9999")).toBe(true);
    expect(telefoneCompleto("(65) 3333-4444")).toBe(true);
    expect(telefoneCompleto("(65) 9999")).toBe(false);
    expect(telefoneCompleto("")).toBe(false);
  });
});
