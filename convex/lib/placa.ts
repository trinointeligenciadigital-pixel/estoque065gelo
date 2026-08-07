import { ConvexError } from "convex/values";

/*
  Placa de veículo de terceiro (correção "quatro ajustes pontuais", tarefa 3)
  — até aqui o campo era texto livre e já apareceu "zxfsfsfsfas" gravado, indo
  parar no comprovante que chega ao cliente. A máscara do lado do cliente
  (src/lib/mascaras.ts, mascaraPlaca) já existia, mas nada validava no
  servidor — quem manda é sempre o servidor, nunca a máscara da tela.

  Dois padrões brasileiros, ambos 7 caracteres:
    Antigo:   3 letras + 4 dígitos     (ABC1234)
    Mercosul: 3 letras + 1 dígito + 1 letra + 2 dígitos (ABC1D23)
*/
const RE_ANTIGO = /^[A-Z]{3}\d{4}$/;
const RE_MERCOSUL = /^[A-Z]{3}\d[A-Z]\d{2}$/;

// Maiúscula, sem hífen/espaço/qualquer outro separador — é assim que se
// guarda (7 caracteres, normalizado), nunca como foi digitado.
export function normalizarPlaca(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function placaValida(normalizada: string): boolean {
  return RE_ANTIGO.test(normalizada) || RE_MERCOSUL.test(normalizada);
}

// Valida e devolve a placa normalizada, ou lança com mensagem clara — chamado
// por toda mutation que grava veiculoTerceiro (operador e Admin, venda e
// patrocínio). Não mexe em registros já gravados (regra desta tarefa: a
// validação vale daqui pra frente, sem migração retroativa).
export function exigirPlacaValida(raw: string): string {
  const normalizada = normalizarPlaca(raw);
  if (!placaValida(normalizada)) {
    throw new ConvexError("Placa inválida. Use o formato ABC-1234 ou ABC1D23.");
  }
  return normalizada;
}

// Monta os dois campos de veículo de terceiro prontos para gravar, com a
// mesma regra nos quatro pontos de escrita (operador e Admin, single e
// carregamento em lote): sem veículo (perda) ou campo vazio viram `undefined`
// nos dois; texto presente exige placa válida (lança ConvexError, senão).
export function veiculoTerceiroValidado(
  incluiVeiculo: boolean,
  veiculoTerceiro: string | undefined,
  veiculoTerceiroModelo: string | undefined,
): { veiculoTerceiro: string | undefined; veiculoTerceiroModelo: string | undefined } {
  if (!incluiVeiculo) return { veiculoTerceiro: undefined, veiculoTerceiroModelo: undefined };
  const texto = veiculoTerceiro?.trim();
  if (!texto) return { veiculoTerceiro: undefined, veiculoTerceiroModelo: undefined };
  return {
    veiculoTerceiro: exigirPlacaValida(texto),
    veiculoTerceiroModelo: veiculoTerceiroModelo?.trim() || undefined,
  };
}

// Exibição: ABC-1234 (padrão antigo, com hífen) ou ABC1D23 (Mercosul, sem
// hífen). Usado onde o servidor já monta a linha final (Histórico) — texto
// que não bate com nenhum padrão (registro anterior a esta correção) volta
// como veio: não há como normalizar o que nunca foi uma placa de verdade.
export function rotuloPlacaOuTexto(raw: string): string {
  const normalizada = normalizarPlaca(raw);
  if (RE_ANTIGO.test(normalizada)) return `${normalizada.slice(0, 3)}-${normalizada.slice(3)}`;
  if (RE_MERCOSUL.test(normalizada)) return normalizada;
  return raw;
}
