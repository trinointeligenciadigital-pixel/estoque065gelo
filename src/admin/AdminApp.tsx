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

// Reveste o widget do Clerk com as cores, fonte e cantos do design system —
// e, principalmente, tira a sombra padrão dele (Regra do Sem-Sombra: aqui
// profundidade é borda + tom, nunca box-shadow).
const apresentacaoClerk = {
  variables: {
    colorPrimary: "#0e7c9c",
    colorText: "#16232a",
    colorTextSecondary: "#55666d",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorInputText: "#16232a",
    colorDanger: "#b23a32",
    colorSuccess: "#2f7d52",
    borderRadius: "0.5rem",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    rootBox: "w-full",
    card: "w-full shadow-none border border-borda rounded-lg p-7 sm:p-9",
    header: "gap-1.5",
    headerTitle: "font-titulo text-xl font-semibold tracking-[0.02em] text-texto",
    headerSubtitle: "text-sm text-texto-suave",
    socialButtons: "gap-2.5",
    socialButtonsBlockButton: "rounded-md border border-borda py-2.5 transition-colors hover:bg-superficie-fria",
    socialButtonsBlockButtonText: "text-sm font-medium text-texto",
    dividerRow: "my-1",
    dividerLine: "bg-borda",
    dividerText: "text-[11px] font-medium tracking-[0.08em] text-texto-fraco uppercase",
    formFieldLabel: "text-xs font-medium text-texto-suave",
    formFieldInput: "rounded-md border border-borda px-3 py-2.5 text-sm text-texto focus:border-acento",
    formFieldAction: "text-xs font-medium text-acento hover:text-acento-escuro",
    formFieldErrorText: "text-xs text-alerta",
    formButtonPrimary: "rounded-md bg-acento py-2.5 text-sm font-medium normal-case transition-colors hover:bg-acento-escuro",
    footerActionText: "text-sm text-texto-suave",
    footerActionLink: "text-sm font-medium text-acento hover:text-acento-escuro",
    identityPreviewText: "text-sm text-texto",
    identityPreviewEditButton: "text-acento",
    otpCodeFieldInput: "border-borda text-texto",
    formResendCodeLink: "text-acento hover:text-acento-escuro",
    alertText: "text-sm text-alerta",
  },
};

function TelaLogin() {
  // Convite (RF02): o link do Clerk chega com `__clerk_ticket`. Aí mostramos o
  // cadastro (que consome o ticket e deixa a pessoa criar a senha), em vez do
  // login. É a exceção permitida ao Modo restrito — só entra quem foi convidado.
  const temTicket = new URLSearchParams(window.location.search).has("__clerk_ticket");
  return (
    <div className="flex min-h-dvh flex-col bg-fundo lg:flex-row">
      <PainelMarca />
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div key={temTicket ? "cadastro" : "login"} className="animate-conteudo-entra w-full max-w-sm">
          {temTicket ? (
            <SignUp routing="virtual" appearance={apresentacaoClerk} />
          ) : (
            <SignIn routing="virtual" appearance={apresentacaoClerk} />
          )}
        </div>
      </div>
    </div>
  );
}

// Painel de marca ao lado do formulário — no celular vira uma faixa no topo.
// É o que dá cara "comercial" à tela de login: identidade, a frase que resume
// o North Star do produto ("O livro-razão vivo") e a régua de nível — o
// componente-assinatura do sistema — como textura decorativa (sem números:
// é ambientação, não dado real).
function PainelMarca() {
  return (
    <div className="animate-conteudo-entra relative flex flex-col justify-between gap-8 bg-acento-escuro px-8 py-10 text-white sm:px-12 sm:py-14 lg:w-[42%] lg:shrink-0 lg:py-16">
      <div className="flex items-center gap-3">
        <img
          src="/logo-065.png"
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-white/30"
        />
        <div className="font-titulo text-lg font-semibold tracking-[0.02em]">Estoque 065</div>
      </div>

      <div className="max-w-xs">
        <p className="font-titulo text-2xl leading-snug font-semibold tracking-[-0.01em] sm:text-[28px]">
          O livro-razão vivo do estoque da 065 Gelo.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Cada quilo, de cada câmara, rastreável até o lançamento que o originou —
          lido com a precisão de um instrumento.
        </p>
        <ReguasDecorativas />
      </div>

      <p className="text-xs text-white/50">065 Gelo · Cuiabá-MT</p>
    </div>
  );
}

// Três réguas de nível "respirando" ao carregar a tela — mesma linguagem
// visual do Painel do Admin, sem rótulo nem número: é textura de marca, não
// uma afirmação sobre o estoque real.
function ReguasDecorativas() {
  const [prontas, setProntas] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setProntas(true), 60);
    return () => clearTimeout(t);
  }, []);
  const alvos = [72, 45, 88];
  return (
    <div className="mt-8 flex flex-col gap-2.5" aria-hidden="true">
      {alvos.map((p, i) => (
        <div key={i} className="h-1.5 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-gelo transition-[width] duration-700 ease-out"
            style={{ width: prontas ? `${p}%` : "0%", transitionDelay: `${150 * i}ms` }}
          />
        </div>
      ))}
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
