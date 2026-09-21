import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

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
        className={`rounded border border-borda bg-superficie px-2 py-1.5 text-base sm:text-sm text-texto outline-none focus:border-acento ${
          mono ? "font-numero tabular-nums" : ""
        } ${className}`}
        {...props}
      />
    </label>
  );
}

// Filtro de texto acima de uma lista/tabela que já carregou por inteiro
// (client-side — os cadastros do Admin não têm volume que justifique busca
// no servidor). Não é o <Campo label=...>: aqui o rótulo é o ícone de lupa,
// pra caber como uma faixa fina acima da tabela em vez de mais um campo com
// rótulo formal.
export function CampoBusca({
  value,
  onChange,
  placeholder = "Buscar…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-texto-fraco" aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded border border-borda bg-superficie py-1.5 pr-2 pl-8 text-base sm:text-sm text-texto outline-none focus:border-acento"
      />
    </div>
  );
}

/*
  Caixa de seleção — dropdown próprio (não o <select> nativo do sistema
  operacional), pra ter movimento: painel que surge com transição, seta que
  gira, item marcado com check. O <select> nativo não dá nenhum controle
  sobre a abertura — é por isso que precisa ser um componente à parte.

  A API imita a de um <select> de propósito: `children` continuam sendo
  <option>/<optgroup> de verdade (o componente só os lê, nunca renderiza),
  e `onChange` recebe um objeto no formato `{ target: { value } }` — todo
  código que já fazia `onChange={(e) => set(e.target.value)}` continua
  funcionando sem mudar uma linha.

  Só o Admin usa isto (RNF12, densidade). As telas do colaborador mantêm o
  <select> nativo de propósito — no celular ele abre o seletor do sistema,
  que é mais rápido de operar com uma mão fria do que qualquer painel customizado.
*/
type OpcaoItem = { tipo: "opcao"; value: string; label: string; disabled?: boolean };
type GrupoItem = { tipo: "grupo"; label: string; opcoes: OpcaoItem[] };
type ItemLista = OpcaoItem | GrupoItem;

function analisarOpcoes(children: ReactNode): ItemLista[] {
  return Children.toArray(children).flatMap((child): ItemLista[] => {
    if (!isValidElement(child)) return [];
    if (child.type === "option") {
      const props = child.props as { value?: string; children?: ReactNode; disabled?: boolean };
      return [{ tipo: "opcao", value: String(props.value ?? ""), label: String(props.children ?? ""), disabled: props.disabled }];
    }
    if (child.type === "optgroup") {
      const props = child.props as { label?: string; children?: ReactNode };
      const opcoes = Children.toArray(props.children).flatMap((sub): OpcaoItem[] => {
        if (!isValidElement(sub) || sub.type !== "option") return [];
        const p = sub.props as { value?: string; children?: ReactNode; disabled?: boolean };
        return [{ tipo: "opcao", value: String(p.value ?? ""), label: String(p.children ?? ""), disabled: p.disabled }];
      });
      return [{ tipo: "grupo", label: props.label ?? "", opcoes }];
    }
    return [];
  });
}

function opcoesPlanas(itens: ItemLista[]): OpcaoItem[] {
  return itens.flatMap((i) => (i.tipo === "opcao" ? [i] : i.opcoes));
}

type ChangeShim = { target: { value: string } };

function SelectBase({
  value,
  onChange,
  disabled,
  className = "",
  children,
}: {
  value?: string;
  onChange?: (e: ChangeShim) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const idBase = useId();

  const itens = useMemo(() => analisarOpcoes(children), [children]);
  const planas = useMemo(() => opcoesPlanas(itens), [itens]);
  const atual = planas.find((o) => o.value === (value ?? ""));
  const buscavel = planas.length > 6;

  useEffect(() => {
    if (!aberto) {
      setBusca("");
      return;
    }
    const t = setTimeout(() => buscaRef.current?.focus(), 0);
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", aoClicarFora);
    };
  }, [aberto]);

  function fechar(devolverFoco: boolean) {
    setAberto(false);
    if (devolverFoco) gatilhoRef.current?.focus();
  }

  function escolher(v: string) {
    onChange?.({ target: { value: v } });
    fechar(true);
  }

  const buscaNorm = busca.trim().toLowerCase();
  const filtrados: ItemLista[] =
    buscaNorm === ""
      ? itens
      : itens
          .map((i): ItemLista | null =>
            i.tipo === "opcao"
              ? i.label.toLowerCase().includes(buscaNorm)
                ? i
                : null
              : { ...i, opcoes: i.opcoes.filter((o) => o.label.toLowerCase().includes(buscaNorm)) },
          )
          .filter((i): i is ItemLista => i !== null && (i.tipo === "opcao" || i.opcoes.length > 0));

  // Navegação por teclado: lista achatada na mesma ordem em que aparece no
  // painel, pra Setas/Home/End moverem o destaque e Enter escolher — o
  // dropdown substitui o <select> nativo, então precisa repor o que ele dava
  // de graça (ver comentário da Caixa de seleção acima).
  const visiveis = useMemo(() => opcoesPlanas(filtrados), [filtrados]);
  useEffect(() => {
    if (!aberto) return;
    const idxAtual = visiveis.findIndex((o) => o.value === (value ?? "") && !o.disabled);
    const idxPrimeiraHabilitada = visiveis.findIndex((o) => !o.disabled);
    setIndiceAtivo(idxAtual >= 0 ? idxAtual : Math.max(idxPrimeiraHabilitada, 0));
  }, [aberto, busca]);

  function moverDestaque(direcao: 1 | -1) {
    if (visiveis.length === 0) return;
    let i = indiceAtivo;
    for (let passos = 0; passos < visiveis.length; passos++) {
      i = (i + direcao + visiveis.length) % visiveis.length;
      if (!visiveis[i].disabled) {
        setIndiceAtivo(i);
        return;
      }
    }
  }

  function aoTeclar(e: ReactKeyboardEvent) {
    if (!aberto) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setAberto(true);
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        fechar(true);
        break;
      case "ArrowDown":
        e.preventDefault();
        moverDestaque(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moverDestaque(-1);
        break;
      case "Home":
        e.preventDefault();
        setIndiceAtivo(visiveis.findIndex((o) => !o.disabled));
        break;
      case "End": {
        e.preventDefault();
        const ultima = [...visiveis].reverse().findIndex((o) => !o.disabled);
        if (ultima >= 0) setIndiceAtivo(visiveis.length - 1 - ultima);
        break;
      }
      case "Enter": {
        const opcao = visiveis[indiceAtivo];
        if (opcao && !opcao.disabled) {
          e.preventDefault();
          escolher(opcao.value);
        }
        break;
      }
      default:
        break;
    }
  }

  const opcaoAtivaId = visiveis[indiceAtivo] ? `${idBase}-opt-${visiveis[indiceAtivo].value}` : undefined;

  return (
    <div ref={containerRef} className="relative" onKeyDown={aoTeclar}>
      <button
        ref={gatilhoRef}
        type="button"
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-activedescendant={opcaoAtivaId}
        className={`flex w-full items-center justify-between gap-2 rounded border border-borda bg-superficie px-2 py-1.5 text-left text-sm text-texto outline-none transition-colors hover:border-borda-forte focus-visible:border-acento disabled:cursor-not-allowed disabled:bg-fundo disabled:text-texto-fraco ${className}`}
      >
        <span className={`truncate ${!atual ? "text-texto-fraco" : ""}`}>{atual?.label ?? "—"}</span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-texto-fraco transition-transform duration-150 ${aberto ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {aberto ? (
        <div
          role="listbox"
          aria-activedescendant={opcaoAtivaId}
          className="animate-menu-entra absolute z-50 mt-1 max-h-72 w-full min-w-[180px] overflow-auto rounded-md border border-borda bg-superficie p-1 shadow-none"
        >
          {buscavel ? (
            <div className="sticky top-0 -mx-1 -mt-1 mb-1 bg-superficie p-1">
              <input
                ref={buscaRef}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-activedescendant={opcaoAtivaId}
                placeholder="Buscar…"
                className="w-full rounded border border-borda bg-fundo px-2 py-1 text-base sm:text-xs text-texto outline-none focus:border-acento"
              />
            </div>
          ) : null}
          {filtrados.length === 0 ? (
            <div className="px-2 py-2 text-center text-xs text-texto-fraco">Nada encontrado.</div>
          ) : (
            filtrados.map((item, i) =>
              item.tipo === "grupo" ? (
                <div key={i}>
                  <div className="px-2 pt-1.5 pb-0.5 font-mono text-[10px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
                    {item.label}
                  </div>
                  {item.opcoes.map((o) => (
                    <OpcaoListbox
                      key={o.value}
                      id={`${idBase}-opt-${o.value}`}
                      opcao={o}
                      selecionado={o.value === (value ?? "")}
                      destacado={visiveis[indiceAtivo]?.value === o.value}
                      onEscolher={escolher}
                    />
                  ))}
                </div>
              ) : (
                <OpcaoListbox
                  key={item.value}
                  id={`${idBase}-opt-${item.value}`}
                  opcao={item}
                  selecionado={item.value === (value ?? "")}
                  destacado={visiveis[indiceAtivo]?.value === item.value}
                  onEscolher={escolher}
                />
              ),
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

function OpcaoListbox({
  id,
  opcao,
  selecionado,
  destacado,
  onEscolher,
}: {
  id: string;
  opcao: OpcaoItem;
  selecionado: boolean;
  destacado: boolean;
  onEscolher: (v: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (destacado) ref.current?.scrollIntoView({ block: "nearest" });
  }, [destacado]);
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="option"
      aria-selected={selecionado}
      disabled={opcao.disabled}
      onClick={() => onEscolher(opcao.value)}
      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:text-texto-fraco disabled:opacity-60 ${
        selecionado ? "bg-superficie-fria-2 font-medium text-acento" : "text-texto hover:bg-superficie-fria"
      } ${destacado ? "outline outline-2 outline-offset-[-2px] outline-acento" : ""}`}
    >
      <span className="truncate">{opcao.label}</span>
      {selecionado ? <Check size={14} className="shrink-0" aria-hidden="true" /> : null}
    </button>
  );
}

export function Selecao({
  label,
  children,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  children: ReactNode;
  value?: string;
  onChange?: (e: ChangeShim) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-texto-suave">{label}</span>
      <SelectBase value={value} onChange={onChange} disabled={disabled} className={className}>
        {children}
      </SelectBase>
    </label>
  );
}

// Mesma caixa, sem rótulo — pra filtros densos (Histórico, Contagens) que já
// têm o próprio rótulo por fora.
export function SelecaoInline({
  children,
  value,
  onChange,
  disabled,
  className,
}: {
  children: ReactNode;
  value?: string;
  onChange?: (e: ChangeShim) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SelectBase value={value} onChange={onChange} disabled={disabled} className={className}>
      {children}
    </SelectBase>
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
        ativo ? "bg-entrada/10 text-entrada-texto" : "border border-borda-forte text-texto-fraco"
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

// Confirmação passageira, não bloqueante (ex.: "convite reenviado") — ao
// contrário de um alerta, não exige clique pra sumir: fecha sozinha. Quem
// chama guarda só a mensagem em estado; o componente cuida do timer.
export function Toast({ texto, onFechar }: { texto: string; onFechar: () => void }) {
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  useEffect(() => {
    const t = setTimeout(() => fecharRef.current(), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto rounded-lg border border-borda-forte bg-texto px-4 py-2.5 text-sm font-medium text-fundo"
      >
        {texto}
      </div>
    </div>
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

// Janela de exibição para listas que crescem com o tempo (Patrocínios,
// Contagens decididas): desenha só os primeiros `passo` e libera mais sob
// demanda, em vez de montar milhares de linhas de uma vez. A lista completa
// continua em memória — a busca de Patrocínios precisa enxergar tudo. A janela
// volta ao início quando `reiniciarCom` muda (ex.: o texto da busca).
export function useJanela<T>(lista: T[], passo = 50, reiniciarCom?: unknown) {
  const [limite, setLimite] = useState(passo);
  useEffect(() => {
    setLimite(passo);
  }, [reiniciarCom, passo]);
  return {
    visiveis: lista.slice(0, limite),
    restantes: Math.max(0, lista.length - limite),
    mostrarMais: () => setLimite((l) => l + passo),
  };
}

export function LinhaMostrarMais({
  colSpan,
  restantes,
  passo = 50,
  onClick,
}: {
  colSpan: number;
  restantes: number;
  passo?: number;
  onClick: () => void;
}) {
  if (restantes <= 0) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-3 text-center">
        <Botao variante="neutro" onClick={onClick}>
          Mostrar mais {Math.min(passo, restantes)} · restam {restantes}
        </Botao>
      </td>
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
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="font-titulo text-xl font-semibold tracking-[0.02em] text-texto uppercase">{titulo}</h1>
        {subtitulo ? <p className="text-sm text-texto-suave">{subtitulo}</p> : null}
      </div>
      {acao}
    </div>
  );
}

// "ok" e "aviso" existiam antes só do lado do colaborador (AvisoOperador em
// src/operador/ui.tsx) — sucesso e atenção não-bloqueante do Admin caíam os
// dois em "info" (cinza neutro), sem diferença visual entre "deu certo" e
// "só um lembrete". Mesma paleta semântica dos dois lados agora.
export function Aviso({ children, tom = "erro" }: { children: ReactNode; tom?: "erro" | "aviso" | "ok" | "info" }) {
  const cores = {
    erro: "text-alerta",
    aviso: "text-aviso-texto",
    ok: "text-entrada",
    info: "text-texto-suave",
  } as const;
  return <p className={`text-sm ${cores[tom]}`}>{children}</p>;
}

export function Modal({
  titulo,
  children,
  onFechar,
  fecharDesabilitado = false,
}: {
  titulo: string;
  children: ReactNode;
  onFechar: () => void;
  // Trava X/Esc/clique-fora enquanto uma escrita está em voo — evita que o
  // admin feche no meio de uma mutação (ex.: cancelar às cegas uma contagem
  // que está sendo fechada ao mesmo tempo). O formulário decide quando travar;
  // o Modal só obedece.
  fecharDesabilitado?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  // Em ref, não estado: `salvando` vira true/false várias vezes com o modal
  // aberto, e isso não pode reiniciar o efeito de foco abaixo (senão o foco
  // pula de volta pro primeiro campo bem no meio do clique em Salvar).
  const fecharDesabilitadoRef = useRef(fecharDesabilitado);
  fecharDesabilitadoRef.current = fecharDesabilitado;

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
        if (fecharDesabilitadoRef.current) return;
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
    // O véu rola (overflow-y-auto) e o miolo centraliza com min-h-full: conteúdo
    // mais alto que a tela (celular deitado, comprovante com vários itens)
    // rola em vez de ser cortado com os botões inalcançáveis.
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-texto/40"
      onClick={fecharDesabilitado ? undefined : onFechar}
    >
      <div className="flex min-h-full items-center justify-center p-4">
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
              className="rounded text-texto-suave transition outline-none hover:text-texto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onFechar}
              disabled={fecharDesabilitado}
              aria-label="Fechar"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
