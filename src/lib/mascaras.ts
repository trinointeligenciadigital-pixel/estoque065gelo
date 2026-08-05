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
