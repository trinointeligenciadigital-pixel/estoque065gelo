import { ConvexError } from "convex/values";

/*
  Extrai uma mensagem legível de um erro de mutation. ConvexError carrega a
  mensagem em `.data`; o resto vira uma mensagem genérica (nunca stack trace na
  cara do usuário, RNF11).
*/
export function mensagemErro(e: unknown): string {
  if (e instanceof ConvexError) {
    return typeof e.data === "string" ? e.data : "Não foi possível concluir.";
  }
  return "Não foi possível concluir. Tente de novo.";
}

// Distingue "o servidor recusou" (ConvexError — saldo insuficiente, sessão
// inválida etc., precisa corrigir algo) de "a chamada nem chegou lá" (queda de
// rede, timeout — retentar com a MESMA entrada é a ação certa). Usado nas
// telas de conferência (sprint PWA, tarefa 5) para o botão virar "Tentar de
// novo" só quando faz sentido.
export function ehFalhaDeRede(e: unknown): boolean {
  return !(e instanceof ConvexError);
}
