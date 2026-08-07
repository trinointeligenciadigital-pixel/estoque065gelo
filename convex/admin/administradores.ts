import { v, ConvexError } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
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

async function revogarNoClerk(chave: string, clerkInvitationId: string): Promise<void> {
  // Best-effort: se o convite já não existe mais no Clerk (aceito, expirado por
  // lá, já revogado), não há o que fazer — segue em frente mesmo assim.
  await fetch(`${CLERK_API}/invitations/${clerkInvitationId}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
  }).catch(() => {});
}

async function criarNoClerk(chave: string, email: string): Promise<{ ok: true; id: string } | { ok: false; mensagem: string }> {
  const resp = await fetch(`${CLERK_API}/invitations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email_address: email, redirect_url: APP_URL }),
  });
  if (!resp.ok) return { ok: false, mensagem: await mensagemErroClerk(resp) };
  const corpo = (await resp.json()) as { id: string };
  return { ok: true, id: corpo.id };
}

// Rate limit do reenvio — 1 a cada 5 minutos, por convite. Validade do link —
// 7 dias desde o ÚLTIMO envio (original ou reenvio); passado isso, o convite
// aparece com o badge "expirado" e um cron diário revoga o token antigo no
// Clerk (convex/crons.ts) — "Reenviar" continua funcionando, o link não.
const RATE_LIMIT_MS = 5 * 60 * 1000;
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Escrita em `convitesAdmin` — só chamada de dentro das actions acima (via
// runMutation/runQuery), nunca exposta ao cliente.
// -----------------------------------------------------------------------------

export const _porEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db.query("convitesAdmin").withIndex("by_email", (q) => q.eq("email", email)).first();
  },
});

export const _registrarConvite = internalMutation({
  args: { email: v.string(), clerkInvitationId: v.string() },
  handler: async (ctx, { email, clerkInvitationId }) => {
    const existente = await ctx.db.query("convitesAdmin").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (existente) await ctx.db.delete(existente._id);
    const agora = Date.now();
    await ctx.db.insert("convitesAdmin", { email, clerkInvitationId, criadoEm: agora, ultimoEnvioEm: agora });
  },
});

// Revalida o rate limit aqui dentro (defesa em profundidade — a action já
// checou antes de gastar a chamada ao Clerk, mas quem manda é o servidor).
export const _registrarReenvio = internalMutation({
  args: { email: v.string(), clerkInvitationId: v.string() },
  handler: async (ctx, { email, clerkInvitationId }) => {
    const existente = await ctx.db.query("convitesAdmin").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (existente === null) throw new ConvexError("Convite não encontrado.");
    const agora = Date.now();
    if (agora - existente.ultimoEnvioEm < RATE_LIMIT_MS) {
      throw new ConvexError("Aguarde antes de reenviar de novo.");
    }
    await ctx.db.patch(existente._id, { clerkInvitationId, ultimoEnvioEm: agora });
  },
});

export const _removerConvite = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const existente = await ctx.db.query("convitesAdmin").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (existente) await ctx.db.delete(existente._id);
  },
});

// -----------------------------------------------------------------------------
// Actions expostas ao painel
// -----------------------------------------------------------------------------

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

    const criado = await criarNoClerk(chave, alvo);
    if (!criado.ok) return criado;

    await ctx.runMutation(internal.admin.administradores._registrarConvite, {
      email: alvo,
      clerkInvitationId: criado.id,
    });
    return { ok: true };
  },
});

// Convites ainda não aceitos (pessoas convidadas que não fizeram o primeiro
// login) — query reativa de verdade: `expirado` é derivado na leitura (regra
// arquitetural 1, embora esta tabela não seja o ledger — mesmo princípio de
// nunca cachear o que dá pra calcular), nunca um campo gravado.
export const listarPendentes = query({
  args: {},
  handler: async (ctx) => {
    await exigirAdmin(ctx);
    const linhas = await ctx.db.query("convitesAdmin").collect();

    // Convite aceito = a pessoa já tem registro em `usuarios` — some da lista
    // (não é revogação, é sucesso; a linha fica pra trás sem problema).
    const usuarios = await ctx.db.query("usuarios").collect();
    const aceitos = new Set(usuarios.map((u) => u.email.trim().toLowerCase()));

    const agora = Date.now();
    return linhas
      .filter((r) => !aceitos.has(r.email.trim().toLowerCase()))
      .map((r) => ({
        email: r.email,
        criadoEm: r.criadoEm,
        ultimoEnvioEm: r.ultimoEnvioEm,
        expirado: agora - r.ultimoEnvioEm > VALIDADE_MS,
        cooldownAteMs: r.ultimoEnvioEm + RATE_LIMIT_MS,
      }))
      .sort((a, b) => b.ultimoEnvioEm - a.ultimoEnvioEm);
  },
});

// Reenvia um convite parado: gera um token NOVO no Clerk e invalida o
// anterior — um link antigo que vaze não continua valendo depois do reenvio.
// O rate limit (5 min) é checado duas vezes: aqui (evita gastar a chamada ao
// Clerk à toa) e de novo dentro de `_registrarReenvio` (quem manda de
// verdade é o servidor, nunca o botão desabilitado do cliente).
export const reenviarConvite = action({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<Resultado> => {
    await exigirAdminNaAction(ctx);
    const chave = chaveClerk();
    if (!chave) return { ok: false, mensagem: SEM_CHAVE };

    const atual = await ctx.runQuery(internal.admin.administradores._porEmail, { email });
    if (atual === null) return { ok: false, mensagem: "Convite não encontrado." };

    const restanteMs = RATE_LIMIT_MS - (Date.now() - atual.ultimoEnvioEm);
    if (restanteMs > 0) {
      return { ok: false, mensagem: `Aguarde ${Math.ceil(restanteMs / 1000)}s antes de reenviar.` };
    }

    await revogarNoClerk(chave, atual.clerkInvitationId);

    const criado = await criarNoClerk(chave, email);
    if (!criado.ok) return criado;

    try {
      await ctx.runMutation(internal.admin.administradores._registrarReenvio, {
        email,
        clerkInvitationId: criado.id,
      });
    } catch {
      return { ok: false, mensagem: "Aguarde antes de reenviar de novo." };
    }
    return { ok: true };
  },
});

// Cancela um convite pendente.
export const revogarConvite = action({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<Resultado> => {
    await exigirAdminNaAction(ctx);
    const chave = chaveClerk();
    if (!chave) return { ok: false, mensagem: SEM_CHAVE };

    const atual = await ctx.runQuery(internal.admin.administradores._porEmail, { email });
    if (atual !== null) await revogarNoClerk(chave, atual.clerkInvitationId);

    await ctx.runMutation(internal.admin.administradores._removerConvite, { email });
    return { ok: true };
  },
});

export const _todosConvites = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("convitesAdmin").collect();
  },
});

// Cron diário (convex/crons.ts): revoga no Clerk o token de todo convite cujo
// último envio passou dos 7 dias — sem isto, "expirado" seria só um rótulo na
// tela e o link antigo continuaria funcionando de verdade até o Clerk expirá-lo
// sozinho (bem mais tarde). Não apaga a linha: o convite continua na lista,
// com o badge, até o Admin reenviar. É internalAction (não internalMutation)
// porque revogar no Clerk é uma chamada de rede.
export const expirarConvitesAntigos = internalAction({
  args: {},
  handler: async (ctx) => {
    const chave = chaveClerk();
    if (!chave) return; // sem chave configurada, nada a fazer

    const linhas = await ctx.runQuery(internal.admin.administradores._todosConvites, {});
    const agora = Date.now();
    for (const r of linhas) {
      if (agora - r.ultimoEnvioEm > VALIDADE_MS) {
        await revogarNoClerk(chave, r.clerkInvitationId);
      }
    }
  },
});
