import { useEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { X } from "lucide-react";

/*
  Kit de UI do painel do Admin — denso (RNF12). Inter no texto; números em
  IBM Plex Mono via a prop `mono` nos campos. Sem gradiente, sem sombra
  exagerada, sem emoji: ferramenta de trabalho.
*/

export function Botao({
  children,
  variante = "primario",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "neutro" | "perigo";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:cursor-not-allowed disabled:opacity-50";
  const estilos = {
    primario: "bg-acento text-white hover:brightness-95",
    neutro: "border border-borda bg-superficie text-texto hover:bg-fundo",
    perigo: "border border-alerta text-alerta hover:bg-alerta/5",
  } as const;
  return (
    <button className={`${base} ${estilos[variante]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Campo({
  label,
  mono = false,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; mono?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-texto-suave">{label}</span>
      <input
        className={`rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-texto outline-none focus:border-acento ${
          mono ? "font-mono" : ""
        } ${className}`}
        {...props}
      />
    </label>
  );
}

export function Selecao({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-texto-suave">{label}</span>
      <select
        className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-texto outline-none focus:border-acento"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Marca({ label, marcado, onToggle }: { label: string; marcado: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-texto">
      <input type="checkbox" checked={marcado} onChange={onToggle} className="accent-acento" />
      {label}
    </label>
  );
}

// Toggle "Ativo" com rede de segurança: desativar (ação destrutiva — some para o
// colaborador) exige um segundo clique deliberado, com aviso do efeito. Reativar é
// direto. O checkbox só muda de estado depois de confirmado. A confirmação é inline
// (não um modal aninhado, que brigaria com o foco preso do Modal).
export function MarcaAtivo({
  label,
  avisoDesativar,
  marcado,
  onToggle,
}: {
  label: string;
  avisoDesativar: string;
  marcado: boolean;
  onToggle: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  function aoMudar() {
    if (marcado) {
      setConfirmando(true); // vai desativar → confirmar primeiro
    } else {
      onToggle(); // reativar não precisa confirmar
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-texto">
        <input type="checkbox" checked={marcado} onChange={aoMudar} className="accent-acento" />
        {label}
      </label>
      {confirmando ? (
        <div className="rounded border border-alerta bg-alerta/5 p-3">
          <p className="text-sm text-texto">{avisoDesativar}</p>
          <div className="mt-2.5 flex justify-end gap-2">
            <Botao variante="neutro" onClick={() => setConfirmando(false)}>
              Cancelar
            </Botao>
            <Botao
              variante="perigo"
              onClick={() => {
                setConfirmando(false);
                onToggle();
              }}
            >
              Desativar
            </Botao>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Etiqueta({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        ativo ? "bg-entrada/10 text-entrada" : "border border-borda-forte text-texto-fraco"
      }`}
    >
      {ativo ? "ativo" : "inativo"}
    </span>
  );
}

export function Cartao({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-borda bg-superficie ${className}`}>{children}</div>
  );
}

/*
  Kit de tabela do Admin — mesmo acabamento "instrumento" do Painel: cabeçalho
  em IBM Plex Mono maiúsculo (rótulo de mostrador), linhas com realce ao passar
  o mouse, estado vazio centralizado. `Tabela` já embrulha o Cartão e cuida da
  rolagem horizontal no desktop estreito. As colunas com número/ação usam
  `dir: true` para alinhar à direita.
*/
export type ColunaTabela = string | { rotulo: string; dir?: boolean };

export function Tabela({ colunas, children }: { colunas: ColunaTabela[]; children: ReactNode }) {
  return (
    <Cartao>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borda">
              {colunas.map((c, i) => {
                const col = typeof c === "string" ? { rotulo: c, dir: false } : c;
                return (
                  <th
                    key={i}
                    className={`px-3 pt-0.5 pb-2.5 font-mono text-xs font-semibold tracking-[0.05em] whitespace-nowrap text-texto-suave uppercase ${
                      col.dir ? "text-right" : "text-left"
                    }`}
                  >
                    {col.rotulo}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Cartao>
  );
}

export function LinhaTabela({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <tr className={`border-b border-borda/60 transition-colors last:border-0 hover:bg-superficie-fria ${className}`}>
      {children}
    </tr>
  );
}

export function LinhaMensagem({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-[13px] text-texto-suave">
        {children}
      </td>
    </tr>
  );
}

export function TituloPagina({ titulo, subtitulo, acao }: { titulo: string; subtitulo?: string; acao?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-titulo text-xl font-semibold tracking-[0.02em] text-texto uppercase">{titulo}</h1>
        {subtitulo ? <p className="text-sm text-texto-suave">{subtitulo}</p> : null}
      </div>
      {acao}
    </div>
  );
}

export function Aviso({ children, tom = "erro" }: { children: ReactNode; tom?: "erro" | "info" }) {
  return (
    <p className={`text-sm ${tom === "erro" ? "text-alerta" : "text-texto-suave"}`}>{children}</p>
  );
}

export function Modal({ titulo, children, onFechar }: { titulo: string; children: ReactNode; onFechar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;

  // Acessibilidade: ao abrir, joga o foco pra dentro; prende o Tab no modal;
  // Esc fecha; ao fechar, devolve o foco pro elemento que estava ativo antes.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const anterior = document.activeElement as HTMLElement | null;
    const focaveis = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
    (focaveis()[0] ?? node).focus();

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        fecharRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const itens = focaveis();
      if (itens.length === 0) {
        e.preventDefault();
        return;
      }
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    node.addEventListener("keydown", aoTeclar);
    return () => {
      node.removeEventListener("keydown", aoTeclar);
      anterior?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-texto/40 p-4" onClick={onFechar}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg border border-borda bg-superficie p-5 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-texto">{titulo}</h2>
          <button
            className="rounded text-texto-suave transition outline-none hover:text-texto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
            onClick={onFechar}
            aria-label="Fechar"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
