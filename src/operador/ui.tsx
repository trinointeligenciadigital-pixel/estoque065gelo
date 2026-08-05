import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { useVoltarHardware } from "./voltarHardware.ts";
import { formatarPacotes, formatarPeso } from "../lib/formato.ts";

/*
  Componentes das telas do colaborador — arejadas, para uso em pé, com uma mão,
  na porta da câmara. Alvo de toque mínimo de 56px (RNF07). Fonte grande.
*/

export type FormatoGrid = {
  _id: Id<"formatos">;
  nome: string;
  pesoKg: number;
  pesoVariavel: boolean;
};
// Saldo do produto pra lista (tarefa 3): `pacotes` só existe quando o produto
// tem UM formato ativo, não peso-variável — é a única situação em que "N
// pacotes" é uma unidade honesta. Em qualquer outro caso (vários formatos,
// ou peso variável) só o peso é mostrado. `null` = saldo escondido
// (contagem cega, tarefa 1) ou produto sem formato ativo.
export type SaldoProdutoGrid = { pacotes: number | null; pesoKg: number } | null;
export type ProdutoGrid = {
  _id: Id<"produtos">;
  nome: string;
  categoria: string;
  unidadeBase: string;
  formatos: FormatoGrid[];
  saldo: SaldoProdutoGrid;
};

// Peso em kg em tempo real (RF31). Peso fixo: quantidade × pesoKg. Peso
// variável: o próprio kg digitado.
export function kgDe(
  formato: FormatoGrid,
  quantidade: number,
  kgVariavel: number,
): number {
  return formato.pesoVariavel ? kgVariavel : quantidade * formato.pesoKg;
}

export function Tela({
  titulo,
  camaraNome,
  onVoltar,
  aoVoltarHardware,
  etapa,
  totalEtapas,
  children,
  rodape,
}: {
  titulo: string;
  camaraNome?: string;
  onVoltar?: () => void;
  // "Voltar" físico para telas sem seta visível (ex.: sucesso) — leva ao menu.
  aoVoltarHardware?: () => void;
  // Indicador de progresso "Passo X de N" (só nos fluxos de vários passos).
  etapa?: number;
  totalEtapas?: number;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  // O voltar físico do celular usa a seta da tela; se não houver seta, o handler
  // de tela terminal (menu). Sem nenhum, sai do app (comportamento no menu/PIN).
  useVoltarHardware(onVoltar ?? aoVoltarHardware);

  const temProgresso = etapa !== undefined && totalEtapas !== undefined;

  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <header className="border-b border-borda bg-superficie px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          {onVoltar ? (
            <button
              onClick={onVoltar}
              className="-ml-2 flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-texto-suave transition outline-none hover:bg-superficie-fria focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
              aria-label="Voltar"
            >
              <ChevronLeft size={26} aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate font-titulo text-lg font-semibold tracking-[0.02em] text-texto uppercase">{titulo}</h1>
            {camaraNome ? <p className="truncate text-sm text-texto-suave">{camaraNome}</p> : null}
          </div>
        </div>
        {temProgresso ? (
          <div className="mt-2.5 flex items-center gap-2.5" role="group" aria-label={`Passo ${etapa} de ${totalEtapas}`}>
            <span className="shrink-0 font-mono text-[10.5px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
              Passo {etapa} de {totalEtapas}
            </span>
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {Array.from({ length: totalEtapas! }).map((_, i) => (
                <div key={i} className={`h-1 flex-1 rounded-full ${i < etapa! ? "bg-acento" : "bg-borda"}`} />
              ))}
            </div>
          </div>
        ) : null}
      </header>
      <main className="flex-1 p-4">{children}</main>
      {rodape ? (
        <footer className="border-t border-borda bg-superficie px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {rodape}
        </footer>
      ) : null}
    </div>
  );
}

export function BotaoGrande({
  children,
  variante = "primario",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "neutro" | "entrada" | "saida";
}) {
  const cores = {
    primario: "bg-acento text-white",
    neutro: "border border-borda bg-superficie text-texto",
    entrada: "bg-entrada text-white",
    saida: "bg-saida text-white",
  } as const;
  return (
    <button
      className={`flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-medium transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:brightness-95 disabled:opacity-50 ${cores[variante]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// Item grande de escolha (produto, formato, tipo), com rótulo e detalhe.
export function OpcaoGrande({
  titulo,
  detalhe,
  selecionado,
  onClick,
}: {
  titulo: string;
  detalhe?: string;
  selecionado?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selecionado}
      className={`flex min-h-[56px] w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:brightness-95 ${
        selecionado ? "border-acento bg-acento/5" : "border-borda bg-superficie"
      }`}
    >
      <span className="text-base font-medium text-texto">{titulo}</span>
      {detalhe ? <span className="font-mono text-sm text-texto-suave">{detalhe}</span> : null}
    </button>
  );
}

export function AvisoOperador({ children, tom = "erro" }: { children: ReactNode; tom?: "erro" | "ok" }) {
  // role/aria-live: leitor de tela anuncia erro (assertivo) e sucesso (educado).
  return (
    <div
      role={tom === "erro" ? "alert" : "status"}
      aria-live={tom === "erro" ? "assertive" : "polite"}
      className={`rounded-xl px-4 py-3 text-base ${
        tom === "erro" ? "bg-alerta/10 text-alerta" : "bg-entrada/10 text-entrada"
      }`}
    >
      {children}
    </div>
  );
}

export function Kg({ valor }: { valor: number }) {
  return <span className="font-mono">{formatarPeso(valor)}</span>;
}

// Resumo de confirmação antes de gravar (rede de segurança do ledger append-only,
// RF34). Cada linha é rótulo à esquerda, valor à direita; números em mono.
export type LinhaResumo = { rotulo: string; valor: string; mono?: boolean };

// O destaque grande é o que o operador CONTOU com as próprias mãos — pacotes,
// não quilos derivados (tarefa 4 do sprint PWA: a tela existe pra pegar erro
// de digitação, e ninguém confere um número contra a realidade física
// olhando pro peso calculado). Peso variável não tem "pacotes": aí o peso
// digitado É a contagem, e continua sendo o destaque, como sempre foi.
export function ResumoLancamento({
  pesoKg,
  quantidadePacotes,
  linhas,
}: {
  pesoKg: number;
  quantidadePacotes?: number | null;
  linhas: LinhaResumo[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-superficie">
      <div className="flex flex-col gap-1 border-b border-borda px-4 py-3.5">
        {quantidadePacotes != null ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
                Quantidade
              </span>
              <span className="font-mono text-3xl leading-none font-semibold text-texto">
                {formatarPacotes(quantidadePacotes)}
              </span>
            </div>
            <div className="text-right font-mono text-sm text-texto-suave">= {formatarPeso(pesoKg)}</div>
          </>
        ) : (
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
              Peso
            </span>
            <span className="font-mono text-3xl leading-none font-semibold text-texto">
              {formatarPeso(pesoKg)}
            </span>
          </div>
        )}
      </div>
      <dl>
        {linhas.map((l, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-3 border-b border-borda/60 px-4 py-2.5 last:border-0"
          >
            <dt className="min-w-0 flex-1 text-base text-texto-suave">{l.rotulo}</dt>
            <dd className={`shrink-0 text-right text-base text-texto ${l.mono ? "font-mono" : ""}`}>{l.valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Entrada de quantidade (ou kg, se peso variável) com o peso em tempo real (RF31,
// RF32). O valor fica como string controlada pelo pai.
export function CampoQuantidade({
  formato,
  valor,
  onChange,
}: {
  formato: FormatoGrid;
  valor: string;
  onChange: (v: string) => void;
}) {
  const num = Number(valor) || 0;

  // Pacotes são inteiros pequenos e frequentes: além do teclado, +/− para lançar
  // com mãos frias, sem digitar. Peso variável (granel) fica só no teclado decimal.
  function ajustar(delta: number) {
    const novo = Math.max(0, Math.round(Number(valor) || 0) + delta);
    onChange(String(novo));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-base font-medium text-texto">
        {formato.pesoVariavel ? "Peso em kg" : "Quantidade (pacotes)"}
      </label>
      {formato.pesoVariavel ? (
        <input
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="min-h-[56px] w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-center font-mono text-3xl text-texto outline-none focus:border-acento"
        />
      ) : (
        <div className="flex items-stretch gap-2">
          <TeclaPasso onClick={() => ajustar(-1)} disabled={num <= 0} aria-label="Diminuir um pacote">
            −
          </TeclaPasso>
          <input
            inputMode="numeric"
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
            aria-label="Quantidade de pacotes"
            className="min-h-[56px] min-w-0 flex-1 rounded-xl border border-borda bg-superficie px-2 py-3 text-center font-mono text-3xl text-texto outline-none focus:border-acento"
          />
          <TeclaPasso onClick={() => ajustar(1)} aria-label="Aumentar um pacote">
            +
          </TeclaPasso>
        </div>
      )}
      {!formato.pesoVariavel ? (
        <p className="text-center text-lg text-texto">
          = <Kg valor={kgDe(formato, num, num)} />
        </p>
      ) : null}
    </div>
  );
}

function TeclaPasso({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="flex min-h-[56px] w-16 shrink-0 items-center justify-center rounded-xl border border-borda bg-superficie font-mono text-3xl leading-none text-texto transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:bg-fundo disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}
