import { useEffect, useState, type ReactNode } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { Authenticated, Unauthenticated, AuthLoading, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AdminShell } from "./AdminShell.tsx";

/*
  Casca do Admin. Fluxo de acesso (RF01, RF02):
    - carregando auth  -> tela neutra
    - não autenticado  -> login do Clerk
    - autenticado      -> garante o registro em `usuarios` e checa ativo:true;
                          só então abre o painel. Sem registro ativo = sem painel.
*/
export function AdminApp() {
  return (
    <>
      <AuthLoading>
        <TelaCentral>Carregando…</TelaCentral>
      </AuthLoading>

      <Unauthenticated>
        <TelaLogin />
      </Unauthenticated>

      <Authenticated>
        <PortaoAdmin />
      </Authenticated>
    </>
  );
}

function PortaoAdmin() {
  const garantirUsuario = useMutation(api.admin.usuarios.garantirUsuario);
  const usuario = useQuery(api.admin.usuarios.usuarioAtual);
  const [garantido, setGarantido] = useState(false);

  // No primeiro login, cria o registro em `usuarios` a partir do Clerk (RF02).
  useEffect(() => {
    let ativo = true;
    garantirUsuario().finally(() => {
      if (ativo) setGarantido(true);
    });
    return () => {
      ativo = false;
    };
  }, [garantirUsuario]);

  if (!garantido || usuario === undefined) {
    return <TelaCentral>Verificando acesso…</TelaCentral>;
  }

  if (usuario === null || !usuario.ativo) {
    return <TelaSemAcesso />;
  }

  return <AdminShell usuario={usuario} />;
}

function TelaLogin() {
  // Convite (RF02): o link do Clerk chega com `__clerk_ticket`. Aí mostramos o
  // cadastro (que consome o ticket e deixa a pessoa criar a senha), em vez do
  // login. É a exceção permitida ao Modo restrito — só entra quem foi convidado.
  const temTicket = new URLSearchParams(window.location.search).has("__clerk_ticket");
  return (
    <div className="flex min-h-full items-center justify-center bg-fundo p-6">
      {temTicket ? <SignUp routing="virtual" /> : <SignIn routing="virtual" />}
    </div>
  );
}

function TelaSemAcesso() {
  return (
    <TelaCentral>
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-texto">Sem acesso ao painel</h1>
        <p className="mt-2 text-sm text-texto-suave">
          Seu login foi reconhecido, mas esta conta ainda não está liberada como
          Admin. Peça a liberação a quem administra o Estoque 065.
        </p>
      </div>
    </TelaCentral>
  );
}

function TelaCentral({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-fundo p-6 text-sm text-texto-suave">
      {children}
    </div>
  );
}
