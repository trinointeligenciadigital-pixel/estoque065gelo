import { createContext, useContext, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ChevronLeft, type LucideIcon } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import { useVoltarHardware } from "./voltarHardware.ts";
import { artigoUnidade, formatarContagem, formatarPeso, nomeUnidade } from "../lib/formato.ts";

// Câmara real da sessão, disponível em toda tela sem precisar passar por
// prop — a prop `camaraNome` do `Tela` abaixo é reaproveitada como subtítulo
// genérico (produto, formato...) nos passos mais fundos de um fluxo, então
// não dá pra confiar nela pra sempre mostrar a câmara. Isto existe só pra
// isso: "em qual câmara estou logado", sempre certo, em toda tela.
const CamaraAtualContext = createContext<string | null>(null);
export function ProvedorCamaraAtual({ camaraNome, children }: { camaraNome: string; children: ReactNode }) {
  return <CamaraAtualContext.Provider value={camaraNome}>{children}</CamaraAtualContext.Provider>;
}

/*
  Componentes das telas do colaborador — arejadas, para uso em pé, com uma mão,
  na porta da câmara. Alvo de toque mínimo de 56px (RNF07). Fonte grande.
*/

export type FormatoGrid = {
  _id: Id<"formatos">;
  nome: string;
  pesoKg: number;
  pesoVariavel: boolean;
  unidadesPorPacote?: number | null;
  unidadeContagem?: "pacote" | "unidade" | null;
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

// "Renato Alves" → "Renato" (tarefa 6) — o crachá no cabeçalho usa só o
// primeiro nome, curto o bastante pra não brigar com o resto do header.
export function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? nomeCompleto;
}

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
  operadorNome,
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
  // Primeiro nome de quem está logado, sempre visível (tarefa 6) — é o que
  // faz a pessoa perceber que está lançando na conta de outro, se o celular
  // ficou esquecido logado. Fica à parte do `camaraNome`, que em muitas
  // telas mostra outra coisa (produto, formato) em vez da câmara.
  operadorNome?: string;
}) {
  // O voltar físico do celular usa a seta da tela; se não houver seta, o handler
  // de tela terminal (menu). Sem nenhum, sai do app (comportamento no menu/PIN).
  useVoltarHardware(onVoltar ?? aoVoltarHardware);

  const temProgresso = etapa !== undefined && totalEtapas !== undefined;
  // O selo (abaixo) é agora a ÚNICA forma de mostrar a câmara — presente desde
  // a tela inicial pós-login, em toda tela, sempre no mesmo canto. `camaraNome`
  // (subtítulo) ainda é reaproveitado pra produto/formato nos passos fundos de
  // um fluxo; quando ele só ia repetir a própria câmara (telas de topo), o
  // subtítulo some — o selo já carrega essa informação, e mostrar os dois ao
  // mesmo tempo lia como bug, não como reforço (testado e corrigido, 2026-09-18).
  const camaraAtual = useContext(CamaraAtualContext);
  const subtitulo = camaraNome && camaraNome !== camaraAtual ? camaraNome : null;

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
          <div className="min-w-0 flex-1">
            {/* Até 2 linhas em vez de cortar com "…": a coluna do crachá + selo
                come ~90px, e "PRODUÇÃO — PRODUTO" já não cabia em 390px. */}
            <h1 className="line-clamp-2 font-titulo text-lg leading-tight font-semibold tracking-[0.02em] text-balance text-texto uppercase">{titulo}</h1>
            {subtitulo ? <p className="truncate text-sm text-texto-suave">{subtitulo}</p> : null}
          </div>
          {operadorNome || camaraAtual ? (
            <div className="flex shrink-0 flex-col items-end gap-1">
              {operadorNome ? (
                <span className="rounded-full border border-borda px-2.5 py-1 font-mono text-[11px] font-medium text-texto-suave">
                  {operadorNome}
                </span>
              ) : null}
              {camaraAtual ? (
                // Tinta do acento (10% no fundo, sólida no texto) — mesma receita
                // já usada em toda etiqueta de estado do app (Etiqueta, AvisoOperador,
                // pills do Admin). Cabe na exceção "dado-chave" da Regra da Voz
                // Única: em qual câmara a pessoa está é o dado que evita lançar no
                // lugar errado, não decoração. `gelo` não serve aqui — falha
                // contraste AA como cor de texto (por isso o sistema só usa gelo em
                // preenchimento de régua, nunca em letra). Texto em acento-escuro:
                // o acento puro sobre o próprio tom a 10% dá 4,2:1 (abaixo de 4,5
                // para 10px); o escuro dá 5,9:1.
                <span className="max-w-32 truncate rounded-full bg-acento/10 px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.06em] text-acento-escuro uppercase">
                  {camaraAtual}
                </span>
              ) : null}
            </div>
          ) : null}
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
      {/* Sem rodapé, é o próprio `<main>` que fica colado no fim da tela — a
          barra do Safari cobre o último cartão sem essa folga (tarefa 7). Com
          rodapé, é ele quem já reserva o safe-area; aqui basta o padding normal. */}
      <main className={`flex-1 p-4 ${rodape ? "" : "pb-[calc(1.5rem+env(safe-area-inset-bottom))]"}`}>{children}</main>
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

// Azulejo do menu da câmara (Produção, Saída, Saldo, Contar) — ícone e rótulo
// alinhados à esquerda, não mais centralizados como ícone de app: lê como um
// cartão de ação, não um launcher. Profundidade vem de duas camadas de tom —
// o selo atrás do ícone, a borda inferior um tom mais escura nas variantes
// cheias — nunca de sombra (Regra do Sem-Sombra). O tremor de toque
// (active:scale) e a entrada escalonada (atraso por azulejo) são o movimento.
export function AzulejoAcao({
  rotulo,
  Icone,
  variante,
  largo = false,
  atraso = 0,
  onClick,
}: {
  rotulo: string;
  Icone: LucideIcon;
  variante: "entrada" | "primario" | "neutro";
  largo?: boolean;
  atraso?: number;
  onClick: () => void;
}) {
  const tileClasses = {
    entrada: "border-b-[3px] border-black/15 bg-entrada text-white",
    primario: "border-b-[3px] border-black/15 bg-acento text-white",
    neutro: "border border-borda bg-superficie text-texto",
  }[variante];
  const chipClasses = {
    entrada: "bg-white/20",
    primario: "bg-white/20",
    neutro: "bg-acento/10 text-acento",
  }[variante];

  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${atraso}ms` }}
      className={`animate-conteudo-entra flex min-h-[108px] flex-col justify-between gap-5 rounded-2xl p-4 text-left transition-all duration-150 outline-none hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:scale-[0.97] active:brightness-95 ${tileClasses} ${largo ? "col-span-2" : ""}`}
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${chipClasses}`}>
        <Icone size={22} aria-hidden="true" />
      </span>
      <span className="text-balance text-lg leading-tight font-semibold">{rotulo}</span>
    </button>
  );
}

// Item grande de escolha (produto, formato, tipo), com rótulo e detalhe.
// `disabled` (tarefa 7): opção existe mas não se aplica agora — ex. "Retorno de
// patrocínio" sem nada em aberto. O `detalhe` costuma carregar a legenda nesse caso.
export function OpcaoGrande({
  titulo,
  detalhe,
  selecionado,
  disabled,
  onClick,
}: {
  titulo: string;
  detalhe?: string;
  selecionado?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selecionado}
      className={`flex min-h-[56px] w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:brightness-95 disabled:opacity-50 disabled:active:brightness-100 ${
        selecionado ? "border-acento bg-acento/5" : "border-borda bg-superficie"
      }`}
    >
      <span className="text-base font-medium text-texto">{titulo}</span>
      {detalhe ? <span className="font-mono text-sm text-texto-suave">{detalhe}</span> : null}
    </button>
  );
}

// Estado vazio dentro de um wizard (tarefa 7): nunca prende o operador só na
// seta pequena do cabeçalho — todo "não há nada aqui" ganha um botão grande.
export function EstadoVazio({ mensagem, onVoltar }: { mensagem: string; onVoltar?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <p className="text-base text-texto-suave">{mensagem}</p>
      {onVoltar ? (
        <BotaoGrande variante="neutro" onClick={onVoltar} className="max-w-xs">
          Voltar ao início
        </BotaoGrande>
      ) : null}
    </div>
  );
}

export function AvisoOperador({ children, tom = "erro" }: { children: ReactNode; tom?: "erro" | "ok" | "aviso" }) {
  // role/aria-live: só o erro de verdade é assertivo — "aviso" (atenção sem
  // urgência: outra pessoa contando, quantidade fora do padrão) e "ok" são
  // educados, pra não soar alarme onde não é erro (DESIGN.md, tom âmbar).
  const estilos = {
    erro: "bg-alerta/10 text-alerta",
    aviso: "bg-aviso/10 text-aviso-texto",
    ok: "bg-entrada/10 text-entrada",
  } as const;
  return (
    <div
      role={tom === "erro" ? "alert" : "status"}
      aria-live={tom === "erro" ? "assertive" : "polite"}
      className={`rounded-xl px-4 py-3 text-base ${estilos[tom]}`}
    >
      {children}
    </div>
  );
}

export function Kg({ valor }: { valor: number }) {
  return <span className="font-numero">{formatarPeso(valor)}</span>;
}

// Resumo de confirmação antes de gravar (rede de segurança do ledger append-only,
// RF34). Cada linha é rótulo à esquerda, valor à direita; números em mono.
export type LinhaResumo = { rotulo: string; valor: string; mono?: boolean };

// Um item de carregamento (venda/patrocínio com vários produtos) — layout
// próprio de 2 colunas × 2 alturas (correção "pacote prevalece, quilo agrega",
// tarefa 5): nome do produto é a âncora da linha, formato é metadado; nunca
// vira uma string concatenada "produto · formato · quantidade".
export type ItemResumo = {
  produtoNome: string;
  formatoNome: string;
  quantidadePacotes: number | null; // null = peso variável, não tem contagem
  // Ausente/"pacote" = comportamento de sempre. Migração pacote→unidade do
  // gelo saborizado: um item pode vir contado em unidades.
  unidadeContagem?: "pacote" | "unidade" | null;
  pesoKg: number;
};

// O destaque grande é o que o operador CONTOU com as próprias mãos — pacotes,
// não quilos derivados (tarefa 4 do sprint PWA: a tela existe pra pegar erro
// de digitação, e ninguém confere um número contra a realidade física
// olhando pro peso calculado). Peso variável não tem "pacotes": aí o peso
// digitado É a contagem, e continua sendo o destaque, como sempre foi.
// `itens`, quando presente (carregamento de vários produtos), lista cada
// produto na linha de 2 alturas em vez de misturar tudo em `linhas`.
export function ResumoLancamento({
  pesoKg,
  quantidadePacotes,
  unidadeContagem,
  itens,
  linhas,
}: {
  pesoKg: number;
  quantidadePacotes?: number | null;
  unidadeContagem?: "pacote" | "unidade" | null;
  itens?: ItemResumo[];
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
              <span className="font-numero text-3xl leading-none font-semibold text-texto">
                {formatarContagem(quantidadePacotes, { pesoVariavel: false, unidadeContagem })}
              </span>
            </div>
            <div className="text-right font-numero text-sm text-texto-suave">= {formatarPeso(pesoKg)}</div>
          </>
        ) : (
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
              Peso
            </span>
            <span className="font-numero text-3xl leading-none font-semibold text-texto">
              {formatarPeso(pesoKg)}
            </span>
          </div>
        )}
      </div>
      {itens && itens.length > 0 ? (
        <div className="border-b border-borda">
          {itens.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-3 border-b border-borda/60 px-4 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-texto">{it.produtoNome}</p>
                <p className="truncate text-sm text-texto-suave">{it.formatoNome}</p>
              </div>
              <div className="shrink-0 text-right whitespace-nowrap">
                {it.quantidadePacotes !== null ? (
                  <>
                    <p className="font-numero text-base font-semibold text-texto">
                      {it.quantidadePacotes}
                      <span className="ml-1 font-sans text-sm font-normal text-texto-suave">
                        {nomeUnidade({ pesoVariavel: false, unidadeContagem: it.unidadeContagem }, it.quantidadePacotes)}
                      </span>
                    </p>
                    <p className="font-numero text-sm text-texto-suave">{formatarPeso(it.pesoKg)}</p>
                  </>
                ) : (
                  <p className="font-numero text-base font-semibold text-texto">{formatarPeso(it.pesoKg)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <dl>
        {linhas.map((l, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-3 border-b border-borda/60 px-4 py-2.5 last:border-0"
          >
            <dt className="min-w-0 flex-1 text-base text-texto-suave">{l.rotulo}</dt>
            <dd className={`shrink-0 text-right text-base text-texto ${l.mono ? "font-numero" : ""}`}>{l.valor}</dd>
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

  const unidade = nomeUnidade(formato, 2);
  const artigo = artigoUnidade(formato);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-base font-medium text-texto">
        {formato.pesoVariavel ? "Peso em kg" : `Quantidade (${unidade})`}
      </label>
      {formato.pesoVariavel ? (
        <input
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="min-h-[56px] w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-center font-numero text-3xl text-texto outline-none focus:border-acento"
        />
      ) : (
        <div className="flex items-stretch gap-2">
          <TeclaPasso onClick={() => ajustar(-1)} disabled={num <= 0} aria-label={`Diminuir ${artigo} ${nomeUnidade(formato, 1)}`}>
            −
          </TeclaPasso>
          <input
            inputMode="numeric"
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
            aria-label={`Quantidade de ${unidade}`}
            className="min-h-[56px] min-w-0 flex-1 rounded-xl border border-borda bg-superficie px-2 py-3 text-center font-numero text-3xl text-texto outline-none focus:border-acento"
          />
          <TeclaPasso onClick={() => ajustar(1)} aria-label={`Aumentar ${artigo} ${nomeUnidade(formato, 1)}`}>
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
      className="flex min-h-[56px] w-16 shrink-0 items-center justify-center rounded-xl border border-borda bg-superficie font-numero tabular-nums text-3xl leading-none text-texto transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:bg-fundo disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}
