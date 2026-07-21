import { mutation, query } from "../_generated/server";

/*
  Usuários (Admin). O único caminho de escrita em `usuarios` é garantirUsuario,
  e ele deriva TUDO da identidade verificada do Clerk — nunca de argumentos do
  cliente. Nenhuma outra escrita em `usuarios` é exposta (RF02).
*/

// Chamada pelo frontend logo após o login no Clerk. No primeiro login, cria o
// registro do Admin a partir do clerkId (RF02). Nas vezes seguintes, mantém
// nome/email em dia. Idempotente: chamar várias vezes não duplica.
//
// NOTA DE SEGURANÇA (ver mensagem ao Alisson): criar com ativo:true significa
// que quem consegue autenticar no Clerk vira Admin. A barreira é o Clerk estar
// restrito a convidados — precisa ser configurado no painel do Clerk antes do
// go-live (Fase 5). Não é senha fraca aqui; é decisão de quem pode se cadastrar.
export const garantirUsuario = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      // Sem identidade não há o que garantir; o frontend não deve chamar aqui
      // sem estar logado, mas protegemos mesmo assim.
      return null;
    }

    const existente = await ctx.db
      .query("usuarios")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();

    const nome = identity.name ?? identity.email ?? "Admin";
    const email = identity.email ?? "";

    if (existente === null) {
      await ctx.db.insert("usuarios", {
        clerkId: identity.subject,
        nome,
        email,
        papel: "admin",
        ativo: true,
      });
      return null;
    }

    // Mantém nome/email sincronizados com o Clerk, sem tocar em `ativo` nem
    // `papel` (ativação/desativação é decisão administrativa, não do login).
    if (existente.nome !== nome || existente.email !== email) {
      await ctx.db.patch(existente._id, { nome, email });
    }
    return null;
  },
});

// Query de gate da UI: devolve os dados do Admin logado, ou null se não há
// identidade ou não há registro. NÃO lança erro (é usada para decidir a tela) e
// NÃO expõe _id nem clerkId (RNF13). O painel só abre quando ativo === true.
export const usuarioAtual = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;

    const usuario = await ctx.db
      .query("usuarios")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();

    if (usuario === null) return null;

    return {
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
      ativo: usuario.ativo,
    };
  },
});
