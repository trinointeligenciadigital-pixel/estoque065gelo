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
