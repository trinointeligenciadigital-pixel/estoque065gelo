import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PinScreen } from "./PinScreen.tsx";
import { SessaoOperador } from "./SessaoOperador.tsx";
import { instalarVoltarHardware } from "./voltarHardware.ts";
import { useOciosidade } from "./ociosidade.ts";
import { ConvitePwaIOS } from "./instalarPWA.tsx";

/*
  App do colaborador. A câmara vem do QR (:qrToken). A sessão fica no
  localStorage, presa a este QR — expira por 20 min de inatividade ou na
  virada do dia em Cuiabá, o que vier primeiro (sprint PWA, tarefa 6; era
  12h fixas). Enquanto não há sessão válida, mostra o PIN.
*/
export function OperadorApp() {
  const { qrToken } = useParams<{ qrToken: string }>();
  const chaveLocal = `sessao065:${qrToken}`;

  const camara = useQuery(api.operador.acesso.resolverCamara, qrToken ? { qrToken } : "skip");
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(chaveLocal));
  const sessao = useQuery(api.operador.acesso.sessaoAtual, token ? { token } : "skip");
  const sair = useMutation(api.operador.acesso.sair);

  // "Voltar" físico do celular navega dentro do app (um passo por vez), em vez de
  // sair do fluxo. Ativo enquanto o app do operador estiver montado.
  useEffect(() => instalarVoltarHardware(), []);

  // Token inválido/expirado: limpa e volta pro PIN.
  useEffect(() => {
    if (token && sessao === null) {
      localStorage.removeItem(chaveLocal);
      setToken(null);
    }
  }, [token, sessao, chaveLocal]);

  function aoEntrar(novoToken: string) {
    localStorage.setItem(chaveLocal, novoToken);
    setToken(novoToken);
  }

  function aoSair() {
    localStorage.removeItem(chaveLocal);
    setToken(null);
  }

  // Inatividade (tarefa 6): 20 min sem tocar a tela volta pro PIN. A garantia
  // de verdade é no servidor (expiraEm já não aceitaria a próxima ação); isto
  // só faz a UI perceber sozinha, sem esperar uma ação falhar.
  useOciosidade(token !== null && sessao != null, () => {
    if (token) void sair({ token }).catch(() => {});
    aoSair();
  });

  let conteudo: ReactNode;
  if (camara === undefined) {
    conteudo = <Centro>Carregando…</Centro>;
  } else if (camara === null) {
    conteudo = (
      <Centro>
        <div className="max-w-xs text-center">
          <h1 className="font-titulo text-xl font-semibold tracking-[0.02em] text-texto uppercase">Câmara não encontrada</h1>
          <p className="mt-2 text-base text-texto-suave">
            Este QR não corresponde a nenhuma câmara ativa. Fale com o Admin.
          </p>
        </div>
      </Centro>
    );
  } else if (!token) {
    // Sem token, ou token existente ainda validando/já inválido.
    conteudo = <PinScreen qrToken={qrToken!} camaraNome={camara.nome} aoEntrar={aoEntrar} />;
  } else if (sessao === undefined) {
    conteudo = <Centro>Carregando…</Centro>;
  } else if (sessao === null) {
    // Efeito acima vai limpar; enquanto isso, mostra o PIN.
    conteudo = <PinScreen qrToken={qrToken!} camaraNome={camara.nome} aoEntrar={aoEntrar} />;
  } else {
    conteudo = <SessaoOperador token={token} sessao={sessao} aoSair={aoSair} />;
  }

  // Convite de instalação (tarefa 7) fica por cima de qualquer tela — a
  // primeira visita ao app pode cair tanto no PIN quanto, se a sessão ainda
  // for válida, direto numa tela de trabalho.
  return (
    <>
      {conteudo}
      <ConvitePwaIOS />
    </>
  );
}

function Centro({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-fundo p-6 text-base text-texto-suave">
      {children}
    </div>
  );
}
