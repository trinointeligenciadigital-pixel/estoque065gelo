/*
  Máscaras de formato para campos digitados à mão pelo Admin. O objetivo é
  impedir informação malformada (placa com letra onde vai número, telefone sem
  DDD) já na digitação — o valor guardado sai limpo e no formato certo.
*/

// Placa brasileira: 7 caracteres. Aceita o formato antigo (ABC1234) e o
// Mercosul (ABC1D23), forçando o tipo certo em cada posição:
//   posições 1–3: letras · posição 4: dígito · posição 5: letra (Mercosul) ou
//   dígito (antigo) · posições 6–7: dígitos.
// Caracteres inválidos são simplesmente ignorados; a saída é sempre maiúscula.
export function mascaraPlaca(raw: string): string {
  const limpo = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let out = "";
  for (const c of limpo) {
    if (out.length >= 7) break;
    const pos = out.length;
    const ehLetra = c >= "A" && c <= "Z";
    const ehDigito = c >= "0" && c <= "9";
    if (pos <= 2) {
      if (ehLetra) out += c;
    } else if (pos === 3) {
      if (ehDigito) out += c;
    } else if (pos === 4) {
      if (ehLetra || ehDigito) out += c;
    } else {
      if (ehDigito) out += c;
    }
  }
  return out;
}

// Placa completa = exatamente 7 caracteres.
export function placaCompleta(placa: string): boolean {
  return placa.length === 7;
}

const RE_PLACA_ANTIGA = /^[A-Z]{3}\d{4}$/;
const RE_PLACA_MERCOSUL = /^[A-Z]{3}\d[A-Z]\d{2}$/;

// Exibição normalizada: ABC-1234 (padrão antigo, com hífen) ou ABC1D23
// (Mercosul, sem hífen) — mesma regra do lado do servidor (convex/lib/placa.ts).
// Texto que não bate com nenhum padrão (registro anterior à validação, tarefa
// 3) volta como veio: não dá pra normalizar o que nunca foi placa de verdade.
export function rotuloPlacaOuTexto(raw: string): string {
  const normalizada = mascaraPlaca(raw);
  if (RE_PLACA_ANTIGA.test(normalizada)) return `${normalizada.slice(0, 3)}-${normalizada.slice(3)}`;
  if (RE_PLACA_MERCOSUL.test(normalizada)) return normalizada;
  return raw;
}

// Telefone/WhatsApp brasileiro: (DD) 99999-9999 (celular, 11 dígitos) ou
// (DD) 9999-9999 (fixo, 10 dígitos). Só dígitos entram; o DDI 55 é adicionado
// na hora de montar o link do wa.me, não aqui.
export function mascaraTelefone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  const corte = resto.length <= 8 ? 4 : 5; // 10 dígitos → 4-4 · 11 dígitos → 5-4
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

// Telefone completo = 10 (fixo) ou 11 (celular) dígitos.
export function telefoneCompleto(telefone: string): boolean {
  const d = telefone.replace(/\D/g, "");
  return d.length === 10 || d.length === 11;
}

// CNPJ: 00.000.000/0000-00 (14 dígitos). Correção "quatro ajustes pontuais",
// tarefa 2 — o cabeçalho do comprovante saía sem máscara nenhuma.
export function mascaraCnpj(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function cnpjCompleto(cnpj: string): boolean {
  return cnpj.replace(/\D/g, "").length === 14;
}
