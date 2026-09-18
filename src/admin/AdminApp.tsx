import { useEffect, useRef, useState, type ReactNode } from "react";
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
    <div className="animate-conteudo-entra relative isolate flex flex-col justify-between gap-6 bg-acento-escuro px-6 py-6 text-white sm:gap-8 sm:px-12 sm:py-14 lg:w-[42%] lg:shrink-0 lg:py-16">
      <VidroGelado />
      <div className="flex items-center gap-3">
        <img
          src="/logo-065.png"
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-white/30"
        />
        <div className="font-titulo text-lg font-semibold tracking-[0.02em]">Estoque 065</div>
      </div>

      {/* Empilhado (< lg), o painel é só uma faixa de identidade — o cartão do
          Clerk é a prioridade e não pode ficar abaixo da metade da tela num
          celular. O "hero" completo (frase + réguas) só aparece lado a lado
          com o formulário, no desktop, onde tem a altura toda pra respirar. */}
      <div className="hidden max-w-xs lg:block">
        <p className="font-titulo text-2xl leading-snug font-semibold tracking-[-0.01em] sm:text-[28px]">
          O livro-razão vivo do estoque da 065 Gelo.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Cada quilo, de cada câmara, rastreável até o lançamento que o originou —
          lido com a precisão de um instrumento.
        </p>
        <ReguasDecorativas />
      </div>

      <p className="hidden text-xs text-white/50 sm:block">065 Gelo · Cuiabá-MT</p>
    </div>
  );
}

// Três réguas de nível "respirando" ao carregar a tela — mesma linguagem
// visual do Painel do Admin, sem rótulo nem número: é textura de marca, não
// uma afirmação sobre o estoque real.
function ReguasDecorativas() {
  const alvos = [72, 45, 88];
  return (
    <div className="mt-8 flex flex-col gap-2.5" aria-hidden="true">
      {alvos.map((p, i) => (
        <ReguaMola key={i} alvo={p} atraso={150 * i} />
      ))}
    </div>
  );
}

// Cada régua sobe com física de mola de verdade (sobe, passa um pouco do
// alvo, assenta) em vez de um `transition` linear — é o mesmo instrumento
// "respirando", só que com peso físico real.
function ReguaMola({ alvo, atraso }: { alvo: number; atraso: number }) {
  const [largura, setLargura] = useState(0);
  const valor = useRef(0);
  const velocidade = useRef(0);

  useEffect(() => {
    const reduzMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduzMovimento) {
      setLargura(alvo);
      return;
    }

    const rigidez = 170;
    const amortecimento = 15;
    let raf = 0;
    let cancelado = false;

    const timer = setTimeout(() => {
      let ultimoTempo = performance.now();

      const passo = (agora: number) => {
        if (cancelado) return;
        const dt = Math.min((agora - ultimoTempo) / 1000, 0.032);
        ultimoTempo = agora;

        const forca = (alvo - valor.current) * rigidez;
        const freio = -velocidade.current * amortecimento;
        velocidade.current += (forca + freio) * dt;
        valor.current += velocidade.current * dt;
        setLargura(valor.current);

        if (Math.abs(alvo - valor.current) > 0.05 || Math.abs(velocidade.current) > 0.05) {
          raf = requestAnimationFrame(passo);
        } else {
          setLargura(alvo);
        }
      };

      raf = requestAnimationFrame(passo);
    }, atraso);

    return () => {
      cancelado = true;
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [alvo, atraso]);

  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
      <div className="h-full rounded-full bg-gelo" style={{ width: `${Math.max(0, largura)}%` }} />
    </div>
  );
}

// Vidro Gelado: frost crescendo das bordas do painel de marca para dentro,
// como o vidro de uma câmara fria embaçando — o North Star "gelo, não o
// interior escuro da câmara" como textura real, não decoração genérica.
// Fica atrás do conteúdo (-z-10) e nunca cobre o centro do painel.
type RamoFrost = {
  x: number;
  y: number;
  angulo: number;
  anguloBase: number;
  vida: number;
  espessura: number;
  cor: "branco" | "gelo";
};

function VidroGelado() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduzMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let ramos: RamoFrost[] = [];
    let quadro = 0;
    let largura = 0;
    let altura = 0;
    let raf = 0;
    let ativo = true;

    const passoComprimento = 2.1;

    function semear(w: number, h: number) {
      // Alcance proporcional ao painel: o gelo cresce das bordas até ~42%
      // da menor dimensão, nunca cobrindo o centro onde o texto vive.
      const alcanceMax = Math.min(w, h) * 0.42;
      const vidaBase = alcanceMax / passoComprimento;
      const corAoAcaso = (): "branco" | "gelo" => (Math.random() < 0.75 ? "branco" : "gelo");
      const vidaAoAcaso = () => vidaBase * (0.55 + Math.random() * 0.55);
      const bordas: Array<() => RamoFrost> = [
        () => {
          const angulo = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
          return { x: Math.random() * w, y: 0, angulo, anguloBase: angulo, vida: vidaAoAcaso(), espessura: 1.2, cor: corAoAcaso() };
        },
        () => {
          const angulo = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
          return { x: Math.random() * w, y: h, angulo, anguloBase: angulo, vida: vidaAoAcaso(), espessura: 1.2, cor: corAoAcaso() };
        },
        () => {
          const angulo = (Math.random() - 0.5) * 0.5;
          return { x: 0, y: Math.random() * h, angulo, anguloBase: angulo, vida: vidaAoAcaso(), espessura: 1.2, cor: corAoAcaso() };
        },
        () => {
          const angulo = Math.PI + (Math.random() - 0.5) * 0.5;
          return { x: w, y: Math.random() * h, angulo, anguloBase: angulo, vida: vidaAoAcaso(), espessura: 1.2, cor: corAoAcaso() };
        },
      ];
      const seeds: RamoFrost[] = [];
      for (let i = 0; i < 18; i++) seeds.push(bordas[i % 4]());
      return seeds;
    }

    function simulaPasso() {
      const proximos: RamoFrost[] = [];
      for (const r of ramos) {
        if (r.vida <= 0) continue;
        // O ângulo deriva um pouco a cada passo, mas nunca se afasta muito
        // do rumo original — é o que faz o ramo seguir "reto o suficiente"
        // para parecer cristal, em vez de um rabisco aleatório sem direção.
        let novoAngulo = r.angulo + (Math.random() - 0.5) * 0.16;
        const desvio = novoAngulo - r.anguloBase;
        if (desvio > 0.85) novoAngulo = r.anguloBase + 0.85;
        if (desvio < -0.85) novoAngulo = r.anguloBase - 0.85;

        const nx = r.x + Math.cos(novoAngulo) * passoComprimento;
        const ny = r.y + Math.sin(novoAngulo) * passoComprimento;
        if (nx < -10 || nx > largura + 10 || ny < -10 || ny > altura + 10) continue;

        const alpha = 0.06 + (r.espessura / 2.4) * 0.24;
        ctx!.strokeStyle = r.cor === "gelo" ? `rgba(84,183,210,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx!.lineWidth = Math.max(0.4, r.espessura);
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(r.x, r.y);
        ctx!.lineTo(nx, ny);
        ctx!.stroke();

        proximos.push({ ...r, x: nx, y: ny, angulo: novoAngulo, vida: r.vida - 1, espessura: r.espessura * 0.99 });

        if (Math.random() < 0.02 && r.vida > 18 && proximos.length < 140) {
          const anguloFilho = novoAngulo + (Math.random() < 0.5 ? 1 : -1) * (0.4 + Math.random() * 0.35);
          proximos.push({
            x: r.x,
            y: r.y,
            angulo: anguloFilho,
            anguloBase: anguloFilho,
            vida: r.vida * 0.6,
            espessura: r.espessura * 0.72,
            cor: r.cor,
          });
        }
      }
      ramos = proximos;
      quadro++;
    }

    function redimensionar() {
      const rect = canvas!.getBoundingClientRect();
      largura = rect.width;
      altura = rect.height;
      canvas!.width = largura * dpr;
      canvas!.height = altura * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, largura, altura);
      ramos = semear(largura, altura);
      quadro = 0;

      if (raf) cancelAnimationFrame(raf);

      if (reduzMovimento) {
        // Sem crescimento animado: desenha o resultado final de uma vez.
        for (let i = 0; i < 420 && ramos.length > 0; i++) simulaPasso();
        return;
      }

      const loop = () => {
        if (!ativo) return;
        simulaPasso();
        if (ramos.length > 0 && quadro < 420) {
          raf = requestAnimationFrame(loop);
        }
      };
      raf = requestAnimationFrame(loop);
    }

    redimensionar();
    const aoRedimensionar = () => redimensionar();
    window.addEventListener("resize", aoRedimensionar);

    return () => {
      ativo = false;
      window.removeEventListener("resize", aoRedimensionar);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full mix-blend-screen"
    />
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
