import { v, ConvexError } from "convex/values";
import { action, mutation, query } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { api } from "../_generated/api";
import { exigirAdmin } from "../lib/auth";

/*
  Administradores — gestão de quem tem acesso ao painel, de dentro do painel (o
  cliente não terá acesso ao dashboard do Clerk).

  O convite é feito na API do Clerk (o Clerk é quem cria a conta/senha); a linha em
  `usuarios` continua nascendo só no primeiro login (garantirUsuario). A única
  escrita nova em `usuarios` é `definirAtivo` (liga/desliga o acesso) — desvio
  consciente da RF02, registrado em docs/03-requisitos.md e no cabeçalho de
  convex/admin/usuarios.ts.
*/
const CLERK_API = "https://api.clerk.com/v1";
// URL do site (destino do link do convite). Trocar aqui se o domínio mudar.
const APP_URL = "https://fabrica065gelo.netlify.app";

// Lista reativa de quem já entrou ao menos uma vez (tem linha em `usuarios`).
// Não expõe _id nem clerkId (RNF13); a chave de operação é o e-mail. `souEu`
// permite à UI travar o próprio usuário.
export const listar = query({
  args: {},
  handler: async (ctx) => {
    const eu = await exigirAdmin(ctx);
    const todos = await ctx.db.query("usuarios").collect();
    return todos
      .map((u) => ({
        nome: u.nome,
        email: u.email,
        ativo: u.ativo,
        papel: u.papel,
        souEu: u.clerkId === eu.clerkId,
      }))
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
  },
});

// Liga/desliga o acesso de um admin (identificado pelo e-mail). Travas: não mexe em
// si mesmo, e não desativa o último admin ativo.
export const definirAtivo = mutation({
  args: { email: v.string(), ativo: v.boolean() },
  handler: async (ctx, { email, ativo }) => {
    const eu = await exigirAdmin(ctx);

    const alvo = await ctx.db
      .query("usuarios")
      .filter((q) => q.eq(q.field("email"), email))
      .first();
    if (alvo === null) throw new ConvexError("Administrador não encontrado.");
    if (alvo.clerkId === eu.clerkId) {
      throw new ConvexError("Você não pode ativar ou desativar a si mesmo.");
    }

    if (!ativo && alvo.ativo) {
      const todos = await ctx.db.query("usuarios").collect();
      const qtdAtivos = todos.filter((u) => u.ativo).length;
      if (qtdAtivos <= 1) {
        throw new ConvexError("Não é possível desativar o último administrador ativo.");
      }
    }

    await ctx.db.patch(alvo._id, { ativo });
    return { ok: true };
  },
});

// -----------------------------------------------------------------------------
// Convites (API do Clerk) — dentro de actions, para poder chamar rede + env.
// -----------------------------------------------------------------------------

type Resultado = { ok: boolean; mensagem?: string };

// Só admin ativo pode operar convites. Actions não acessam o banco direto: checam
// a identidade do Clerk e consultam `usuarioAtual` para confirmar acesso.
async function exigirAdminNaAction(ctx: ActionCtx): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError("Não autenticado.");
  const eu = await ctx.runQuery(api.admin.usuarios.usuarioAtual, {});
  if (eu === null || !eu.ativo) throw new ConvexError("Sem acesso ao painel.");
}

function chaveClerk(): string | null {
  return process.env.CLERK_SECRET_KEY ?? null;
}
const SEM_CHAVE = "Configure a chave secreta do Clerk (CLERK_SECRET_KEY) no Convex para convidar.";

async function mensagemErroClerk(resp: Response): Promise<string> {
  try {
    const corpo = (await resp.json()) as { errors?: Array<{ message?: string; long_message?: string }> };
    const bruto = corpo.errors?.[0]?.long_message || corpo.errors?.[0]?.message || "";
    if (/already|exists|duplicate|taken/i.test(bruto)) {
      return "Esse e-mail já é administrador ou já foi convidado.";
    }
    return bruto || `Não foi possível concluir (erro ${resp.status}).`;
  } catch {
    return `Não foi possível concluir (erro ${resp.status}).`;
  }
}

// Convida um e-mail. O Clerk manda o link; ao aceitar, a pessoa cria a senha e, no
// primeiro login, vira Admin (garantirUsuario).
export const convidar = action({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<Resultado> => {
    await exigirAdminNaAction(ctx);
    const chave = chaveClerk();
    if (!chave) return { ok: false, mensagem: SEM_CHAVE };

    const alvo = email.trim().toLowerCase();
    if (!alvo || !alvo.includes("@")) return { ok: false, mensagem: "E-mail inválido." };

    const resp = await fetch(`${CLERK_API}/invitations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email_address: alvo, redirect_url: APP_URL }),
    });
    if (!resp.ok) return { ok: false, mensagem: await mensagemErroClerk(resp) };
    return { ok: true };
  },
});

type ConvitePendente = { id: string; email: string; criadoEm: number };

// Convites ainda não aceitos (pessoas convidadas que não fizeram o primeiro login).
export const listarPendentes = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; mensagem?: string; convites: ConvitePendente[] }> => {
    await exigirAdminNaAction(ctx);
    const chave = chaveClerk();
    if (!chave) return { ok: false, mensagem: SEM_CHAVE, convites: [] };

    const resp = await fetch(`${CLERK_API}/invitations?status=pending&limit=100`, {
      headers: { Authorization: `Bearer ${chave}` },
    });
    if (!resp.ok) return { ok: false, mensagem: await mensagemErroClerk(resp), convites: [] };

    const dados = (await resp.json()) as unknown;
    const lista = (Array.isArray(dados) ? dados : ((dados as { data?: unknown[] })?.data ?? [])) as Array<{
      id: string;
      email_address: string;
      created_at: number;
    }>;
    const convites = lista.map((i) => ({ id: i.id, email: i.email_address, criadoEm: i.created_at }));
    return { ok: true, convites };
  },
});

// Cancela um convite pendente.
export const revogarConvite = action({
  args: { id: v.string() },
  handler: async (ctx, { id }): Promise<Resultado> => {
    await exigirAdminNaAction(ctx);
    const chave = chaveClerk();
    if (!chave) return { ok: false, mensagem: SEM_CHAVE };

    const resp = await fetch(`${CLERK_API}/invitations/${id}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return { ok: false, mensagem: await mensagemErroClerk(resp) };
    return { ok: true };
  },
});
