import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PinScreen } from "./PinScreen.tsx";
import { SessaoOperador } from "./SessaoOperador.tsx";
import { instalarVoltarHardware } from "./voltarHardware.ts";

/*
  App do colaborador. A câmara vem do QR (:qrToken). A sessão (token de 12h) fica
  no localStorage, presa a este QR. Enquanto não há sessão válida, mostra o PIN.
*/
export function OperadorApp() {
  const { qrToken } = useParams<{ qrToken: string }>();
  const chaveLocal = `sessao065:${qrToken}`;

  const camara = useQuery(api.operador.acesso.resolverCamara, qrToken ? { qrToken } : "skip");
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(chaveLocal));
  const sessao = useQuery(api.operador.acesso.sessaoAtual, token ? { token } : "skip");

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

  if (camara === undefined) {
    return <Centro>Carregando…</Centro>;
  }
  if (camara === null) {
    return (
      <Centro>
        <div className="max-w-xs text-center">
          <h1 className="font-titulo text-xl font-semibold tracking-[0.02em] text-texto uppercase">Câmara não encontrada</h1>
          <p className="mt-2 text-base text-texto-suave">
            Este QR não corresponde a nenhuma câmara ativa. Fale com o Admin.
          </p>
        </div>
      </Centro>
    );
  }

  // Sem token, ou token existente ainda validando/já inválido.
  if (!token) {
    return <PinScreen qrToken={qrToken!} camaraNome={camara.nome} aoEntrar={aoEntrar} />;
  }
  if (sessao === undefined) {
    return <Centro>Carregando…</Centro>;
  }
  if (sessao === null) {
    // Efeito acima vai limpar; enquanto isso, mostra o PIN.
    return <PinScreen qrToken={qrToken!} camaraNome={camara.nome} aoEntrar={aoEntrar} />;
  }

  return <SessaoOperador token={token} sessao={sessao} aoSair={aoSair} />;
}

function Centro({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-fundo p-6 text-base text-texto-suave">
      {children}
    </div>
  );
}
