import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { verificarPin } from "../lib/pin";

/*
  Acesso do colaborador: QR (câmara) + PIN individual (pessoa). Sessão de 12h
  presa a operador + câmara. A câmara vem SEMPRE do QR (RF06); nunca de lista.

  Bloqueio anti-tentativa é por câmara (RF08, decisão do cliente): o PIN errado
  não identifica o colaborador, então quem trava é o teclado daquela câmara.
*/

const SESSAO_MS = 12 * 60 * 60 * 1000; // 12h
const BLOQUEIO_MS = 15 * 60 * 1000; // 15 min
const MAX_TENTATIVAS = 5;

// Mensagem única — nunca revela se o PIN estava errado ou se está bloqueado (RF08).
const ERRO_ACESSO = "Não foi possível entrar. Verifique o PIN e tente novamente.";

// Resolve a câmara do QR para mostrar o nome na tela de PIN. Público (ainda não
// há sessão). Só devolve o nome; nada sensível.
export const resolverCamara = query({
  args: { qrToken: v.string() },
  handler: async (ctx, { qrToken }) => {
    const camara = await ctx.db
      .query("camaras")
      .withIndex("by_qr_token", (q) => q.eq("qrToken", qrToken))
      .first();
    if (camara === null || !camara.ativo) return null;
    return { nome: camara.nome };
  },
});

// IMPORTANTE: falha de login NÃO lança erro — retorna { ok: false }. No Convex,
// uma mutation que lança desfaz (rollback) todas as suas escritas; se lançássemos
// após incrementar o contador de tentativas, o bloqueio nunca seria gravado.
export const entrar = mutation({
  args: { qrToken: v.string(), pin: v.string() },
  handler: async (ctx, { qrToken, pin }) => {
    const agora = Date.now();
    const falha = { ok: false as const, mensagem: ERRO_ACESSO };

    const camara = await ctx.db
      .query("camaras")
      .withIndex("by_qr_token", (q) => q.eq("qrToken", qrToken))
      .first();
    if (camara === null || !camara.ativo) return falha;

    // Teclado da câmara bloqueado? Mesma resposta genérica (RF08).
    if (camara.bloqueadoAte !== undefined && camara.bloqueadoAte > agora) return falha;

    // Candidatos: operadores ativos que têm esta câmara permitida.
    const ativos = await ctx.db
      .query("operadores")
      .withIndex("by_ativo", (q) => q.eq("ativo", true))
      .collect();
    const candidatos = ativos.filter((o) => o.camarasPermitidas.includes(camara._id));

    let encontrado = null;
    for (const c of candidatos) {
      if (c.pinHash !== "" && (await verificarPin(pin, c.pinHash))) {
        encontrado = c;
        break;
      }
    }

    if (encontrado === null) {
      // PIN errado: conta a tentativa NA CÂMARA e bloqueia ao atingir o limite.
      const tentativas = (camara.tentativasFalhas ?? 0) + 1;
      if (tentativas >= MAX_TENTATIVAS) {
        await ctx.db.patch(camara._id, { tentativasFalhas: 0, bloqueadoAte: agora + BLOQUEIO_MS });
      } else {
        await ctx.db.patch(camara._id, { tentativasFalhas: tentativas });
      }
      return falha;
    }

    // Sucesso: zera o contador da câmara e do operador, cria a sessão de 12h.
    await ctx.db.patch(camara._id, { tentativasFalhas: 0, bloqueadoAte: undefined });
    await ctx.db.patch(encontrado._id, { tentativasFalhas: 0, bloqueadoAte: undefined });

    const token = crypto.randomUUID();
    await ctx.db.insert("sessoesOperador", {
      operadorId: encontrado._id,
      camaraId: camara._id,
      token,
      expiraEm: agora + SESSAO_MS,
    });

    return {
      ok: true as const,
      token,
      operadorNome: encontrado.nome,
      camaraNome: camara.nome,
      podeLancarProducao: encontrado.podeLancarProducao,
      podeLancarSaida: encontrado.podeLancarSaida,
      podeContar: encontrado.podeContar,
    };
  },
});

// Restaura a sessão ao recarregar o app. Devolve null se o token não vale mais
// (expirado, operador desativado, PIN regenerado) — sem lançar erro.
export const sessaoAtual = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const sessao = await ctx.db
      .query("sessoesOperador")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (sessao === null || sessao.expiraEm <= Date.now()) return null;

    const operador = await ctx.db.get(sessao.operadorId);
    if (operador === null || !operador.ativo) return null;
    const camara = await ctx.db.get(sessao.camaraId);
    if (camara === null || !camara.ativo) return null;

    return {
      operadorNome: operador.nome,
      camaraNome: camara.nome,
      podeLancarProducao: operador.podeLancarProducao,
      podeLancarSaida: operador.podeLancarSaida,
      podeContar: operador.podeContar,
    };
  },
});

// "Sair" — encerra a própria sessão (RF10).
export const sair = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const sessao = await ctx.db
      .query("sessoesOperador")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (sessao !== null) {
      await ctx.db.delete(sessao._id);
    }
  },
});
