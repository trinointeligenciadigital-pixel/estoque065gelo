import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { Delete } from "lucide-react";
import { api } from "../../convex/_generated/api";

/*
  Tela de PIN (RF04, RF08). Teclado numérico grande; o nome da câmara fica
  visível o tempo todo (a pessoa precisa saber onde está antes de digitar). A
  mensagem de erro é única — não revela se o PIN errou ou se está bloqueado.
*/
const TAM_PIN = 6;

export function PinScreen({
  qrToken,
  camaraNome,
  aoEntrar,
}: {
  qrToken: string;
  camaraNome: string;
  aoEntrar: (token: string) => void;
}) {
  const entrar = useMutation(api.operador.acesso.entrar);
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState("");
  const [erros, setErros] = useState(0); // conta falhas p/ retrigar o tremor
  const [enviando, setEnviando] = useState(false);

  async function tentar(valor: string) {
    setEnviando(true);
    setErro("");
    try {
      const r = await entrar({ qrToken, pin: valor });
      if (r.ok) {
        aoEntrar(r.token);
        return;
      }
      setErro(r.mensagem);
      setErros((n) => n + 1);
      setPin("");
    } catch {
      setErro("Falha de conexão. Confira o sinal na porta da câmara e tente de novo.");
      setErros((n) => n + 1);
      setPin("");
    } finally {
      setEnviando(false);
    }
  }

  function digitar(d: string) {
    if (enviando || pin.length >= TAM_PIN) return;
    const novo = pin + d;
    setPin(novo);
    if (novo.length === TAM_PIN) void tentar(novo);
  }

  function apagar() {
    if (enviando) return;
    setErro("");
    setPin((p) => p.slice(0, -1));
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-fundo px-6 py-10"
      style={{ paddingTop: "calc(2.5rem + env(safe-area-inset-top))", paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="flex flex-col items-center text-center">
        <img
          src="/logo-065.png"
          alt="065 Gelo"
          className="h-16 w-16 rounded-full object-cover ring-1 ring-borda"
        />
        <p className="mt-3 font-mono text-[11px] font-medium tracking-[0.14em] text-texto-fraco uppercase">
          Estoque 065
        </p>
        <h1 className="mt-1 font-titulo text-2xl font-semibold tracking-[0.02em] text-texto uppercase">{camaraNome}</h1>
        <p className="mt-1 text-base text-texto-suave">Digite seu PIN</p>
      </div>

      <div key={erros} className={`flex gap-3 ${erros > 0 ? "animate-tremor" : ""}`}>
        {Array.from({ length: TAM_PIN }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full transition-colors ${i < pin.length ? "bg-acento" : "bg-borda"}`}
          />
        ))}
      </div>

      <div role="alert" className="h-6 text-center text-base text-alerta">{erro}</div>

      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <TeclaNum key={d} onClick={() => digitar(d)} disabled={enviando}>
            {d}
          </TeclaNum>
        ))}
        <div />
        <TeclaNum onClick={() => digitar("0")} disabled={enviando}>
          0
        </TeclaNum>
        <TeclaNum onClick={apagar} disabled={enviando} ariaLabel="Apagar">
          <Delete size={26} aria-hidden="true" />
        </TeclaNum>
      </div>

      {enviando ? <p className="text-sm text-texto-suave">Entrando…</p> : null}
    </div>
  );
}

function TeclaNum({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="flex h-16 items-center justify-center rounded-xl border border-borda bg-superficie font-mono text-2xl text-texto transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:bg-fundo disabled:opacity-50"
    >
      {children}
    </button>
  );
}
