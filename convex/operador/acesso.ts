import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { verificarPin } from "../lib/pin";
import { INATIVIDADE_MS } from "../lib/auth";
import { fimDoDiaCuiaba } from "../lib/data";

/*
  Acesso do colaborador: QR (câmara) + PIN individual (pessoa). Sessão presa a
  operador + câmara, por 20 minutos de inatividade ou até a virada do dia em
  Cuiabá — o que vier primeiro (sprint PWA, tarefa 6; era 12h fixas). A câmara
  vem SEMPRE do QR (RF06); nunca de lista.

  Bloqueio anti-tentativa é por câmara (RF08, decisão do cliente, reafirmada
  na tarefa 6): o PIN errado não identifica o colaborador — o sistema testa
  contra todos os candidatos daquela câmara e nenhum bate — então não dá pra
  atribuir a tentativa a uma pessoa sem pedir identificação antes do PIN
  (mudança de UX maior, fora deste sprint). Quem trava é o teclado da câmara,
  progressivamente: 5 erros → 1 min; 8 erros → 15 min.
*/

const BLOQUEIO_5_MS = 1 * 60 * 1000;
const BLOQUEIO_8_MS = 15 * 60 * 1000;

// Mensagem genérica — nunca revela se ALGUM PIN estava certo ou errado (RF08).
// A partir da 3ª tentativa, passa a contar quantas faltam pro bloqueio: isso é
// um sinal do TECLADO DA CÂMARA (não de uma pessoa), então não fere RF08.
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

// "Aguarde 1 minuto..." / "Aguarde 15 minutos...", arredondado pra cima —
// nunca "0 minutos" no fim da contagem.
function mensagemBloqueio(bloqueadoAte: number, agora: number): string {
  const min = Math.max(1, Math.ceil((bloqueadoAte - agora) / 60_000));
  return `Muitas tentativas. Aguarde ${min} minuto${min === 1 ? "" : "s"} ou procure o encarregado.`;
}

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

    // Teclado da câmara já bloqueado: diz quanto falta (é um sinal do
    // TECLADO, não de uma pessoa específica — não fere RF08).
    if (camara.bloqueadoAte !== undefined && camara.bloqueadoAte > agora) {
      return { ok: false as const, mensagem: mensagemBloqueio(camara.bloqueadoAte, agora) };
    }

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
      // PIN errado: conta a tentativa NA CÂMARA. Bloqueio progressivo — 5
      // erros trava 1 minuto, 8+ erros trava 15 (tarefa 6; 8 é teto — toda
      // tentativa a partir daí volta a bloquear 15 min). `=== 5`, não `>= 5`:
      // só bloqueia de novo ao CRUZAR o 1º patamar, senão o teclado nunca
      // sairia do bloqueio de 1 min (toda tentativa depois da 5ª cairia em
      // "≥5" de novo). Entre a 5ª e a 8ª, 3 tentativas passam livres — é o
      // que deixa o contador chegar até 8. A partir da 3ª tentativa, a
      // mensagem já avisa quantas faltam antes do próximo bloqueio.
      const tentativas = (camara.tentativasFalhas ?? 0) + 1;
      if (tentativas >= 8) {
        await ctx.db.patch(camara._id, { tentativasFalhas: tentativas, bloqueadoAte: agora + BLOQUEIO_8_MS });
        return { ok: false as const, mensagem: mensagemBloqueio(agora + BLOQUEIO_8_MS, agora) };
      }
      if (tentativas === 5) {
        await ctx.db.patch(camara._id, { tentativasFalhas: tentativas, bloqueadoAte: agora + BLOQUEIO_5_MS });
        return { ok: false as const, mensagem: mensagemBloqueio(agora + BLOQUEIO_5_MS, agora) };
      }
      await ctx.db.patch(camara._id, { tentativasFalhas: tentativas });
      if (tentativas >= 3) {
        const proximoPatamar = tentativas < 5 ? 5 : 8;
        const restantes = proximoPatamar - tentativas;
        return {
          ok: false as const,
          mensagem: `PIN incorreto. Mais ${restantes} tentativa${restantes === 1 ? "" : "s"} antes do bloqueio.`,
        };
      }
      return falha;
    }

    // Sucesso: zera o contador da câmara e do operador, cria a sessão — 20
    // minutos de inatividade ou a virada do dia em Cuiabá, o que vier antes.
    await ctx.db.patch(camara._id, { tentativasFalhas: 0, bloqueadoAte: undefined });
    await ctx.db.patch(encontrado._id, { tentativasFalhas: 0, bloqueadoAte: undefined });

    const token = crypto.randomUUID();
    await ctx.db.insert("sessoesOperador", {
      operadorId: encontrado._id,
      camaraId: camara._id,
      token,
      expiraEm: Math.min(agora + INATIVIDADE_MS, fimDoDiaCuiaba(agora)),
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
