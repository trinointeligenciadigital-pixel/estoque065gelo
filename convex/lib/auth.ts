import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/*
  Autorização — o Convex NÃO tem RLS. Toda checagem de identidade e escopo vive
  aqui e é chamada dentro de cada query/mutation (regra arquitetural 5, RNF04).

  Erros usam ConvexError para que a mensagem chegue limpa ao cliente (em
  produção o Convex esconde o texto de `Error` comum). As mensagens voltadas ao
  colaborador são operacionais, sem jargão (RNF11).
*/

// -----------------------------------------------------------------------------
// Admin (Clerk)
// -----------------------------------------------------------------------------

// Valida o Clerk, busca o usuário em `usuarios` pelo clerkId e exige ativo:true.
// Um usuário do Clerk sem registro ativo em `usuarios` NÃO é Admin (RF01).
export async function exigirAdmin(ctx: QueryCtx): Promise<Doc<"usuarios">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError("Não autenticado.");
  }

  const usuario = await ctx.db
    .query("usuarios")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .first();

  if (usuario === null || !usuario.ativo) {
    throw new ConvexError("Sem acesso ao painel.");
  }

  return usuario;
}

// -----------------------------------------------------------------------------
// Operador (sessão por token)
// -----------------------------------------------------------------------------

export type SessaoOperador = {
  sessao: Doc<"sessoesOperador">;
  operador: Doc<"operadores">;
  camara: Doc<"camaras">;
};

// Valida o token de sessão, confere a expiração (por `expiraEm`, nunca por
// existência do registro — RF09), e devolve operador + câmara da sessão.
// Mensagem única e genérica: nunca revela se o token é inválido, expirou, ou se
// o operador foi desativado (RF08 em espírito — não vaza estado de acesso).
export async function exigirSessaoOperador(
  ctx: QueryCtx,
  token: string,
): Promise<SessaoOperador> {
  const semAcesso = () => new ConvexError("Sessão inválida. Entre de novo.");

  const sessao = await ctx.db
    .query("sessoesOperador")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();

  if (sessao === null || sessao.expiraEm <= Date.now()) {
    throw semAcesso();
  }

  const operador = await ctx.db.get(sessao.operadorId);
  if (operador === null || !operador.ativo) {
    throw semAcesso();
  }

  const camara = await ctx.db.get(sessao.camaraId);
  if (camara === null || !camara.ativo) {
    throw semAcesso();
  }

  return { sessao, operador, camara };
}

// -----------------------------------------------------------------------------
// Permissão por tipo de ação do operador
// -----------------------------------------------------------------------------

export type AcaoOperador = "producao" | "saida" | "contar";

// Checa a flag de permissão correspondente ao tipo de ação. Não toca no banco.
export function exigirPermissao(
  operador: Doc<"operadores">,
  acao: AcaoOperador,
): void {
  const permitido =
    acao === "producao"
      ? operador.podeLancarProducao
      : acao === "saida"
        ? operador.podeLancarSaida
        : operador.podeContar;

  if (!permitido) {
    throw new ConvexError("Você não tem permissão para esta ação.");
  }
}

// -----------------------------------------------------------------------------
// Câmara do produto x câmara da sessão (regra arquitetural 6)
// -----------------------------------------------------------------------------

// Confere que o produto pertence à câmara da sessão ANTES de qualquer escrita.
// Um operador com sessão na Câmara A não escreve na Câmara B, mesmo que forje o
// produtoId no payload (RF07). Devolve o produto para reuso pela mutation.
export async function exigirCamaraDoProduto(
  ctx: QueryCtx,
  produtoId: Id<"produtos">,
  camaraId: Id<"camaras">,
): Promise<Doc<"produtos">> {
  const produto = await ctx.db.get(produtoId);
  if (produto === null || produto.camaraId !== camaraId) {
    throw new ConvexError("Produto não pertence a esta câmara.");
  }
  return produto;
}
