import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Aviso, Botao, Campo, Cartao, Etiqueta, LinhaMensagem, LinhaTabela, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";
import { data } from "../../lib/data.ts";

/*
  Administradores — o cliente gerencia quem acessa o painel sem depender do Clerk.
  Convidar cria o convite no Clerk (a pessoa cria a senha e vira Admin no 1º login).
  A lista de quem já entrou é reativa; os convites pendentes vêm de uma action (não
  reativa), recarregada após cada convite/revogação.
*/
type Pendente = { id: string; email: string; criadoEm: number };

export function AdministradoresPage() {
  const admins = useQuery(api.admin.administradores.listar);
  const definirAtivo = useMutation(api.admin.administradores.definirAtivo);
  const convidarAction = useAction(api.admin.administradores.convidar);
  const listarPendentesAction = useAction(api.admin.administradores.listarPendentes);
  const revogarAction = useAction(api.admin.administradores.revogarConvite);

  // Convite
  const [email, setEmail] = useState("");
  const [convidando, setConvidando] = useState(false);
  const [msgConvite, setMsgConvite] = useState<{ ok: boolean; texto: string } | null>(null);

  // Pendentes
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [pendMsg, setPendMsg] = useState("");

  // Ativar/desativar
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const recarregarPendentes = useCallback(async () => {
    setPendMsg("");
    try {
      const r = await listarPendentesAction();
      if (r.ok) setPendentes(r.convites);
      else setPendMsg(r.mensagem ?? "Não foi possível carregar os convites pendentes.");
    } catch (e) {
      setPendMsg(mensagemErro(e));
    }
  }, [listarPendentesAction]);

  useEffect(() => {
    void recarregarPendentes();
  }, [recarregarPendentes]);

  async function convidar() {
    setConvidando(true);
    setMsgConvite(null);
    try {
      const r = await convidarAction({ email });
      if (r.ok) {
        setMsgConvite({ ok: true, texto: `Convite enviado para ${email.trim()}.` });
        setEmail("");
        void recarregarPendentes();
      } else {
        setMsgConvite({ ok: false, texto: r.mensagem ?? "Não foi possível convidar." });
      }
    } catch (e) {
      setMsgConvite({ ok: false, texto: mensagemErro(e) });
    } finally {
      setConvidando(false);
    }
  }

  async function alterar(alvoEmail: string, ativo: boolean) {
    setErro("");
    try {
      await definirAtivo({ email: alvoEmail, ativo });
      setConfirmando(null);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function revogar(id: string) {
    setPendMsg("");
    try {
      const r = await revogarAction({ id });
      if (r.ok) void recarregarPendentes();
      else setPendMsg(r.mensagem ?? "Não foi possível revogar o convite.");
    } catch (e) {
      setPendMsg(mensagemErro(e));
    }
  }

  const emailValido = email.trim().includes("@");

  return (
    <>
      <TituloPagina
        titulo="Administradores"
        subtitulo="Quem acessa o painel. Convide por e-mail; o acesso pode ser ligado ou desligado aqui. Todo admin tem acesso total."
      />

      {/* Convidar */}
      <Cartao className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Campo
              label="Convidar novo administrador (e-mail)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@empresa.com"
              onKeyDown={(e) => {
                if (e.key === "Enter" && emailValido && !convidando) void convidar();
              }}
            />
          </div>
          <Botao onClick={() => void convidar()} disabled={convidando || !emailValido}>
            {convidando ? "Enviando…" : "Enviar convite"}
          </Botao>
        </div>
        {msgConvite ? (
          <p className={`mt-2.5 text-sm ${msgConvite.ok ? "text-entrada" : "text-alerta"}`}>{msgConvite.texto}</p>
        ) : (
          <p className="mt-2.5 text-xs text-texto-suave">
            A pessoa recebe um e-mail, cria a senha e vira Admin no primeiro acesso.
          </p>
        )}
      </Cartao>

      {/* Convites pendentes */}
      {pendentes.length > 0 || pendMsg ? (
        <Cartao className="mb-4 p-4">
          <h2 className="mb-2.5 font-titulo text-[15px] font-semibold tracking-[0.02em] text-texto uppercase">
            Convites pendentes
          </h2>
          {pendMsg ? <Aviso>{pendMsg}</Aviso> : null}
          <div className="flex flex-col gap-2">
            {pendentes.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded border border-borda bg-fundo px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-texto">{p.email}</div>
                  <div className="text-xs text-texto-fraco">Aguardando primeiro acesso · convidado em {data(p.criadoEm)}</div>
                </div>
                <Botao variante="perigo" onClick={() => void revogar(p.id)}>Revogar</Botao>
              </div>
            ))}
          </div>
        </Cartao>
      ) : null}

      {/* Quem já entrou */}
      {erro ? <div className="mb-3"><Aviso>{erro}</Aviso></div> : null}
      <Tabela colunas={["Nome", "E-mail", "Status", { rotulo: "Ações", dir: true }]}>
        {admins === undefined ? (
          <LinhaMensagem colSpan={4}>Carregando…</LinhaMensagem>
        ) : admins.length === 0 ? (
          <LinhaMensagem colSpan={4}>Nenhum administrador ainda.</LinhaMensagem>
        ) : (
          admins.map((a) => (
            <LinhaTabela key={a.email || a.nome}>
              <td className="px-3 py-2.5 font-medium text-texto">
                {a.nome}
                {a.souEu ? <span className="ml-2 text-xs font-normal text-texto-fraco">(você)</span> : null}
              </td>
              <td className="px-3 py-2.5 text-texto-suave">{a.email || "—"}</td>
              <td className="px-3 py-2.5"><Etiqueta ativo={a.ativo} /></td>
              <td className="px-3 py-2.5 text-right">
                {a.souEu ? (
                  <span className="text-xs text-texto-fraco">—</span>
                ) : a.ativo ? (
                  confirmando === a.email ? (
                    <span className="inline-flex items-center justify-end gap-2">
                      <span className="text-xs text-texto-suave">Desativar?</span>
                      <Botao variante="neutro" onClick={() => setConfirmando(null)}>Cancelar</Botao>
                      <Botao variante="perigo" onClick={() => void alterar(a.email, false)}>Desativar</Botao>
                    </span>
                  ) : (
                    <Botao variante="perigo" onClick={() => { setErro(""); setConfirmando(a.email); }}>
                      Desativar
                    </Botao>
                  )
                ) : (
                  <Botao variante="neutro" onClick={() => void alterar(a.email, true)}>Reativar</Botao>
                )}
              </td>
            </LinhaTabela>
          ))
        )}
      </Tabela>
    </>
  );
}
