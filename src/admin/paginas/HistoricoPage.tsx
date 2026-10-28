import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Check, ChevronRight, Download, MessageCircle, Undo2, X } from "lucide-react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Cartao, LinhaCarregarMais, LinhaMensagem, LinhaTabela, Modal, SelecaoInline, Tabela, TituloPagina, Toast } from "../../shared/ui.tsx";
import { ComprovanteCartao, ComprovanteParaImagem } from "../../shared/ComprovanteCartao.tsx";
import { mensagemErro } from "../../lib/erros.ts";
import { useNumeroAnimado } from "../movimento.ts";
import { data, dataHora, diasDiferentes } from "../../lib/data.ts";
import { formatarContagem, formatarPeso, formatarQuantidade, rotuloFormato } from "../../lib/formato.ts";
import { nomesHomonimos, rotuloProduto } from "../../lib/produto.ts";
import { textoComprovante, totalContagemComprovante, type DadosComprovante } from "../../lib/comprovante.ts";
import { baixarImagem, enviarComprovante, nomeArquivoComprovante, useImagemComprovante } from "../../lib/imagemComprovante.ts";

/*
  Histórico (RF61, RF62). Somente leitura: nenhuma linha tem ação de editar ou
  excluir — nem existe endpoint para isso. Filtros por câmara, produto, tipo,
  período e autor.
*/
type Tipo =
  | "producao"
  | "venda"
  | "patrocinio"
  | "retornoPatrocinio"
  | "perda"
  | "ajuste"
  | "estorno"
  | "transferencia";
const rotuloTipo: Record<Tipo, string> = {
  producao: "Produção",
  venda: "Venda",
  patrocinio: "Patrocínio",
  retornoPatrocinio: "Retorno de patrocínio",
  perda: "Perda",
  ajuste: "Ajuste",
  estorno: "Estorno",
  transferencia: "Transferência",
};
const rotuloMotivoPerda: Record<string, string> = {
  derreteu: "Derreteu",
  danificado: "Danificado",
  descarte: "Descarte",
  outro: "Outro motivo",
};
const rotuloMotivoAjuste: Record<string, string> = {
  contagem: "Contagem",
  quebra: "Quebra",
  derretimento: "Derretimento",
  erro_lancamento: "Erro de lançamento",
  outro: "Outro",
};

// Uma linha do resultado de `historico.listar`.
type MovRow = {
  _id: Id<"movimentacoes">;
  tipo: Tipo;
  sinal: 1 | -1;
  produtoNome: string;
  formatoNome: string;
  formatoPesoKg: number;
  formatoPesoVariavel: boolean;
  formatoUnidadesPorPacote: number | null;
  formatoUnidadeContagem: "pacote" | "unidade";
  camaraNome: string;
  quantidade: number;
  pesoKg: number;
  clienteNome: string | null;
  veiculo: string | null;
  motorista: string | null;
  motivoPerda: "derreteu" | "danificado" | "descarte" | "outro" | null;
  observacao: string | null;
  motivoCategoria:
    | "contagem"
    | "quebra"
    | "derretimento"
    | "erro_lancamento"
    | "outro"
    | "nao_informado"
    | null;
  motivoTexto: string | null;
  autor: string;
  autorTipo: "operador" | "admin";
  registradoEm: number;
  dataMovimento: number; // RF65 — legado vem igual a registradoEm
  carregamentoId: string | null;
  loteId: string | null;
  loteInferido: boolean;
  contagemId: Id<"contagens"> | null;
  estornado: boolean;
  estornoDeProtocolo: string | null;
  protocolo: string;
  numeroComprovante: number | null;
};

type LinhaAgrupada =
  | { tipo: "individual"; mov: MovRow }
  | { tipo: "grupo"; loteId: string; itens: MovRow[] }
  | { tipo: "carregamento"; carregamentoId: string; itens: MovRow[] };

// Colapsa linhas com o mesmo loteId (ajustes de uma mesma aprovação de
// contagem, transferência) ou o mesmo carregamentoId (venda/patrocínio com
// vários produtos — um carregamento é um comprovante só) numa entrada de
// grupo; o resto segue individual. O ledger continua com uma movimentação por
// produto — isto só junta na LEITURA. Preserva a ordem de chegada (movs já vem
// ordenado por data, mais recente primeiro).
function agruparPorLote(movs: MovRow[]): LinhaAgrupada[] {
  const vistos = new Set<string>();
  const resultado: LinhaAgrupada[] = [];
  for (const m of movs) {
    if (m.loteId !== null) {
      const chave = `lote:${m.loteId}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      resultado.push({ tipo: "grupo", loteId: m.loteId, itens: movs.filter((x) => x.loteId === m.loteId) });
      continue;
    }
    if (m.carregamentoId !== null) {
      const chave = `carr:${m.carregamentoId}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const itens = movs.filter((x) => x.loteId === null && x.carregamentoId === m.carregamentoId);
      // Carregamento de um produto só não precisa de linha-resumo.
      resultado.push(itens.length > 1 ? { tipo: "carregamento", carregamentoId: m.carregamentoId, itens } : { tipo: "individual", mov: m });
      continue;
    }
    resultado.push({ tipo: "individual", mov: m });
  }
  return resultado;
}

// Converte "AAAA-MM-DD" (input date) em ms; fim inclui o dia inteiro.
function inicioDoDia(s: string): number | undefined {
  return s ? new Date(`${s}T00:00:00`).getTime() : undefined;
}
function fimDoDia(s: string): number | undefined {
  return s ? new Date(`${s}T23:59:59.999`).getTime() : undefined;
}

// "AAAA-MM-DD" de um instante, no fuso de Cuiabá (RNF15) — mesmo cálculo do
// link do gráfico do Painel (ver ymdCuiaba em PainelPage.tsx).
const CUIABA_OFFSET_MS = -4 * 60 * 60 * 1000;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
function ymdCuiaba(ms: number): string {
  const d = new Date(ms + CUIABA_OFFSET_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

// "AAAA-MM-DD" vindo do link; qualquer outra coisa é ignorada (um link
// cortado não pode virar uma data NaN na consulta).
function dataDaUrl(v: string | null): string | null {
  return v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Últimos 30 dias — o padrão de quem abre a página sem filtro nenhum.
function periodoPadrao(): { de: string; ate: string } {
  return { de: ymdCuiaba(Date.now() - 29 * UM_DIA_MS), ate: ymdCuiaba(Date.now()) };
}

// "01/10 – 27/10/2026" a partir dos campos De/Até ("AAAA-MM-DD").
function periodoLegivel(de: string, ate: string): string {
  const dm = (s: string) => s.split("-").reverse().slice(0, 2).join("/");
  const dma = (s: string) => s.split("-").reverse().join("/");
  if (de && ate) return de === ate ? dma(de) : `${dm(de)} – ${dma(ate)}`;
  if (de) return `desde ${dma(de)}`;
  if (ate) return `até ${dma(ate)}`;
  return "todo o período";
}

// Sinal de entrada/saída junto do número (Regra do Sinal Junto da Cor). O
// menos é o sinal tipográfico (U+2212), da mesma largura do mais.
const MENOS = "−";
function comSinal(texto: string, n: number): string {
  return `${n > 0 ? "+" : n < 0 ? MENOS : ""}${texto}`;
}

type Resumo = FunctionReturnType<typeof api.admin.historico.resumo>;

/*
  Faixa "Entradas · Saídas · Líquido" — a soma do recorte inteiro, calculada no
  servidor (historico.resumo). É o que faz desta página um livro-razão: o
  número e, logo abaixo, as linhas que o explicam. Ao trocar o filtro, o valor
  anterior fica na tela (esmaecido) e corre até o novo; nunca pisca para vazio.

  Com produto + formato (o recorte de saldoDoFormato) ela vira extrato: saldo
  antes do período → entradas → saídas → saldo no fim. É a resposta direta a
  "como esse número chegou aqui", sem conta de cabeça.
*/
function ResumoRecorte({ resumo, recorte, de, ate }: { resumo: Resumo | undefined; recorte: string; de: string; ate: string }) {
  const ultimo = useRef<Resumo | undefined>(undefined);
  if (resumo !== undefined) ultimo.current = resumo;
  const r = resumo ?? ultimo.current;
  const carregando = resumo === undefined;
  const q = r?.quantidade ?? null;
  const ex = r?.extrato ?? null;
  const qtd = (n: number) => (q ? formatarContagem(Math.abs(n), { pesoVariavel: false, unidadeContagem: q.unidadeContagem }) : "");
  const qtdSaldo = (n: number | null) =>
    q && n !== null ? `${n < 0 ? MENOS : ""}${qtd(n)}` : null;
  const dm = (s: string) => s.split("-").reverse().slice(0, 2).join("/");

  return (
    <section aria-label="Soma do recorte" aria-busy={carregando} className="mb-4 overflow-hidden rounded-lg border border-borda bg-superficie">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-borda px-4 py-2.5">
        <p className="text-[13px] text-texto">{recorte}</p>
        <p className="font-numero text-[13px] tabular-nums text-texto-suave">
          {r === undefined
            ? "somando…"
            : r.incompleto
              ? "soma interrompida"
              : `${r.movimentacoes.toLocaleString("pt-BR")} ${r.movimentacoes === 1 ? "movimentação" : "movimentações"}`}
        </p>
      </div>
      {r?.incompleto ? (
        <p className="px-4 py-3 text-[13px] text-aviso-texto">
          {r.podeEstreitar
            ? "O recorte passa de 5.000 movimentações, então a soma não foi feita para não mostrar um total errado. Encurte o período ou escolha uma câmara ou um produto."
            : "Este produto passa de 5.000 movimentações no recorte, então a soma não foi feita para não mostrar um total errado. Encurte o período."}
        </p>
      ) : (
        // gap-px sobre o fundo de borda desenha os filetes entre as leituras,
        // em qualquer número de colunas.
        <dl
          className={`grid gap-px bg-borda transition-opacity duration-150 ${ex ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"} ${carregando && r ? "opacity-60" : ""}`}
        >
          {ex ? (
            <Leitura rotulo={de ? `Saldo antes de ${dm(de)}` : "Saldo inicial"} kg={ex.antesKg} semSinal qtd={qtdSaldo(ex.antesQtd)} />
          ) : null}
          <Leitura rotulo="Entradas" kg={r?.entradasKg} sinal={1} cor="text-entrada-texto" qtd={q ? comSinal(qtd(q.entradas), 1) : null} />
          <Leitura rotulo="Saídas" kg={r?.saidasKg} sinal={-1} cor="text-saida" qtd={q ? comSinal(qtd(q.saidas), -1) : null} />
          {ex ? (
            <Leitura rotulo={ate ? `Saldo em ${dm(ate)}` : "Saldo hoje"} kg={ex.depoisKg} semSinal destaque qtd={qtdSaldo(ex.depoisQtd)} />
          ) : (
            <Leitura rotulo="Líquido" kg={r?.liquidoKg} destaque qtd={q ? comSinal(qtd(q.liquido), q.liquido) : null} />
          )}
        </dl>
      )}
    </section>
  );
}

function Leitura({
  rotulo,
  kg,
  sinal,
  semSinal = false,
  cor = "text-texto",
  destaque = false,
  qtd,
}: {
  rotulo: string;
  kg: number | undefined;
  // Entradas/Saídas levam o sinal fixo; o líquido leva o sinal do próprio
  // valor; saldo não leva sinal (só o menos, se negativo).
  sinal?: 1 | -1;
  semSinal?: boolean;
  cor?: string;
  destaque?: boolean;
  qtd: string | null;
}) {
  const exibido = useNumeroAnimado(kg, { duracao: 500 });
  const formatar = (v: number) => {
    const [n, un] = formatarPeso(Math.abs(v)).split(" ");
    const zero = Math.abs(v) < 0.0005;
    const s = semSinal ? (v < 0 && !zero ? -1 : 0) : (sinal ?? (zero ? 0 : v));
    return { n: comSinal(n, s), un };
  };
  const visto = formatar(exibido);
  return (
    <div className={`px-4 py-3.5 ${destaque ? "bg-fundo" : "bg-superficie"}`}>
      <dt className="font-mono text-[11px] font-medium tracking-[0.11em] text-texto-fraco uppercase">{rotulo}</dt>
      <dd className={`mt-2 font-numero leading-none font-semibold tabular-nums ${destaque ? "text-3xl" : "text-2xl"} ${cor}`}>
        {kg === undefined ? (
          <span className="text-texto-fraco">—</span>
        ) : (
          <>
            <span aria-hidden="true">
              {visto.n}
              <span className="ml-1 font-sans text-xs font-medium text-texto-fraco">{visto.un}</span>
            </span>
            <span className="sr-only">{`${formatar(kg).n} ${formatar(kg).un}`}</span>
          </>
        )}
      </dd>
      {qtd ? <dd className="mt-1.5 font-numero text-[13px] tabular-nums text-texto-suave">{qtd}</dd> : null}
    </div>
  );
}

export function HistoricoPage() {
  return (
    <LimiteErro>
      <Historico />
    </LimiteErro>
  );
}

// Se uma consulta do Histórico lançar (falha real — rede momentânea o Convex
// retenta sozinho), mostra o que fazer no lugar de uma tela branca.
class LimiteErro extends Component<{ children: ReactNode }, { erro: boolean }> {
  state = { erro: false };
  static getDerivedStateFromError() {
    return { erro: true };
  }
  componentDidCatch(erro: unknown) {
    console.error("Histórico — falha ao carregar:", erro);
  }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <>
        <TituloPagina titulo="Histórico" subtitulo="Tudo que entrou e saiu. Nada se apaga: correção é por estorno." />
        <Cartao className="p-8">
          <div className="mx-auto max-w-sm text-center">
            <p className="font-titulo text-base font-semibold text-texto">Não foi possível carregar o histórico</p>
            <p className="mt-1.5 text-[13px] text-texto-suave">
              Pode ser um link antigo com um filtro que não vale mais, ou uma falha de conexão. Recarregue sem filtros; se
              continuar, avise o suporte.
            </p>
            <button
              type="button"
              // Volta para /historico sem nada no endereço: últimos 30 dias, sem filtro.
              onClick={() => window.location.assign(window.location.pathname)}
              className="mt-4 inline-flex items-center justify-center rounded-sm bg-acento px-4 py-2 text-sm font-medium text-white transition outline-none hover:bg-acento-escuro focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
            >
              Limpar filtros e recarregar
            </button>
          </div>
        </Cartao>
      </>
    );
  }
}

function Historico() {
  const opcoes = useQuery(api.admin.historico.opcoesFiltro);
  // Cabeçalho do comprovante (tarefa 7) — mesma leitura pública usada pelo operador.
  const empresa = useQuery(api.empresaPublica.dadosComprovante);

  // Pré-carrega todo o estado do filtro pela URL — ex.: clique num dia do
  // gráfico do Painel abre /historico?de=AAAA-MM-DD&ate=AAAA-MM-DD, "Ver
  // ajustes gerados" em Contagens abre /historico?contagemId=<id>, e um link
  // compartilhado com qualquer combinação de filtros chega com o mesmo
  // recorte já aplicado. Depois vira estado interno normal, e um efeito
  // abaixo escreve de volta na URL a cada mudança.
  const [params, setSearchParams] = useSearchParams();

  const [camaraId, setCamaraId] = useState<Id<"camaras"> | "">(() => (params.get("camaraId") as Id<"camaras">) || "");
  const [produtoId, setProdutoId] = useState<Id<"produtos"> | "">(() => (params.get("produtoId") as Id<"produtos">) || "");
  const [formatoId, setFormatoId] = useState<Id<"formatos"> | "">(() => (params.get("formatoId") as Id<"formatos">) || "");
  const [tipo, setTipo] = useState<Tipo | "">(() => {
    const t = params.get("tipo");
    return t && Object.hasOwn(rotuloTipo, t) ? (t as Tipo) : "";
  });
  const [operadorId, setOperadorId] = useState<Id<"operadores"> | "">(() => (params.get("operadorId") as Id<"operadores">) || "");
  const [autorClerkId, setAutorClerkId] = useState<string>(() => params.get("autorClerkId") ?? "");
  // Sem NENHUM filtro na URL (visita direta à página, não um link vindo de
  // outra tela) — o padrão é os últimos 30 dias. Sem isso, a consulta varria
  // o histórico inteiro da fábrica desde o primeiro lançamento (parecia uma
  // lista infinita pro Admin). Um link com contagemId ("Ver ajustes gerados"
  // em Contagens) ou com de/ate explícitos (gráfico do Painel) já chega com
  // algo na URL, então nunca cai nesse padrão.
  const semNenhumFiltroNaUrl = params.toString() === "";
  const [de, setDe] = useState(() => dataDaUrl(params.get("de")) ?? (semNenhumFiltroNaUrl ? periodoPadrao().de : ""));
  const [ate, setAte] = useState(() => dataDaUrl(params.get("ate")) ?? (semNenhumFiltroNaUrl ? periodoPadrao().ate : ""));
  const [contagemId, setContagemId] = useState<Id<"contagens"> | "">(() => (params.get("contagemId") as Id<"contagens">) || "");
  // Busca por protocolo (tarefa 4 do adendo) — localiza qualquer lançamento,
  // inclusive ajuste e estorno, sem precisar saber câmara/produto/tipo.
  const [protocolo, setProtocolo] = useState(() => params.get("protocolo") ?? "");
  // O que está no campo; `protocolo` (o que vai para a busca) só muda com o
  // código completo, no Enter ou ao sair do campo — antes, cada letra
  // disparava a busca e a tabela dizia "nenhum lançamento" no meio da digitação.
  const [protocoloDigitado, setProtocoloDigitado] = useState(protocolo);
  function limparProtocolo() {
    setProtocolo("");
    setProtocoloDigitado("");
  }
  const [comprovanteDe, setComprovanteDe] = useState<MovRow | null>(null);
  const [toast, setToast] = useState("");
  const [estornando, setEstornando] = useState<MovRow | null>(null);
  const [estornandoTransferLote, setEstornandoTransferLote] = useState<string | null>(null);
  // Protocolo/Produto/Autor começam escondidos atrás de "Mais filtros" (só 4
  // decisões visíveis de cara: De, Até, Câmara, Tipo) — mas se o admin chegou
  // aqui por um link que já tinha um desses preenchido, mostra aberto.
  const [maisFiltros, setMaisFiltros] = useState(
    () =>
      Boolean(
        params.get("protocolo") || params.get("produtoId") || params.get("formatoId") || params.get("operadorId") || params.get("autorClerkId"),
      ),
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (camaraId) next.set("camaraId", camaraId);
    if (produtoId) next.set("produtoId", produtoId);
    if (formatoId) next.set("formatoId", formatoId);
    if (tipo) next.set("tipo", tipo);
    if (operadorId) next.set("operadorId", operadorId);
    if (autorClerkId) next.set("autorClerkId", autorClerkId);
    if (protocolo.trim()) next.set("protocolo", protocolo.trim());
    if (de) next.set("de", de);
    if (ate) next.set("ate", ate);
    if (contagemId) next.set("contagemId", contagemId);
    setSearchParams(next, { replace: true });
  }, [camaraId, produtoId, formatoId, tipo, operadorId, autorClerkId, protocolo, de, ate, contagemId, setSearchParams]);

  // Paginação real (RF61 — convex/admin/historico.ts não faz mais um
  // .collect() com limite fixo). Cada mudança de filtro reinicia a paginação
  // (o Convex detecta pelos args); "Carregar mais" busca a próxima página do
  // mesmo índice usado no servidor.
  // O servidor procura o protocolo no histórico inteiro, sem olhar o período.
  const buscaPorProtocolo = protocolo.trim() !== "";

  // Filtros vindos de um link são conferidos contra o que existe de verdade
  // antes de chegar ao servidor: um link antigo (produto removido) ou cortado
  // levava um id inválido ao validador e derrubava a página inteira. Até as
  // opções chegarem, a consulta espera; o que não existir é retirado, com aviso.
  const camaraOk = opcoes?.camaras.some((c) => c._id === camaraId) ? camaraId : "";
  const produtoOk = opcoes?.produtos.some((p) => p._id === produtoId) ? produtoId : "";
  const formatoOk = opcoes?.formatos.some((f) => f._id === formatoId && f.produtoId === produtoOk) ? formatoId : "";
  const operadorOk = opcoes?.operadores.some((o) => o._id === operadorId) ? operadorId : "";
  const autorOk = opcoes?.admins.some((a) => a.clerkId === autorClerkId) ? autorClerkId : "";
  const [linkCorrigido, setLinkCorrigido] = useState(false);
  useEffect(() => {
    if (!opcoes) return;
    let retirou = false;
    if (camaraId !== camaraOk) { setCamaraId(""); retirou = true; }
    if (produtoId !== produtoOk) { setProdutoId(""); retirou = true; }
    if (formatoId !== formatoOk) { setFormatoId(""); retirou = true; }
    if (operadorId !== operadorOk) { setOperadorId(""); retirou = true; }
    if (autorClerkId !== autorOk) { setAutorClerkId(""); retirou = true; }
    if (retirou) setLinkCorrigido(true);
  }, [opcoes, camaraId, camaraOk, produtoId, produtoOk, formatoId, formatoOk, operadorId, operadorOk, autorClerkId, autorOk]);

  const filtros = {
    camaraId: camaraOk || undefined,
    produtoId: produtoOk || undefined,
    formatoId: formatoOk || undefined,
    tipo: tipo || undefined,
    operadorId: operadorOk || undefined,
    autorClerkId: autorOk || undefined,
    contagemId: contagemId || undefined,
    protocolo: protocolo.trim() || undefined,
    de: inicioDoDia(de),
    ate: fimDoDia(ate),
  };
  const {
    results: movs,
    status: statusMovs,
    loadMore,
  } = usePaginatedQuery(api.admin.historico.listar, opcoes ? filtros : "skip", { initialNumItems: 100 });
  // Soma do recorte inteiro (não só das páginas carregadas) — mesmos filtros.
  const resumo = useQuery(api.admin.historico.resumo, opcoes ? filtros : "skip");

  // Com produto ou contagem específicos já filtrados, mostrar as linhas
  // individuais (o Admin está procurando algo pontual). Sem esses filtros,
  // ajustes da mesma aprovação de contagem colapsam numa linha-resumo.
  const semAgrupar = produtoId !== "" || contagemId !== "";
  const linhas: LinhaAgrupada[] = semAgrupar
    ? movs.map((mov) => ({ tipo: "individual" as const, mov }))
    : agruparPorLote(movs);

  const filtrosAvancadosAtivos = [protocolo.trim() !== "", produtoId !== "", formatoId !== "", operadorId !== "" || autorClerkId !== ""].filter(
    Boolean,
  ).length;

  // Produtos filtrados pela câmara escolhida (se houver).
  const produtos = (opcoes?.produtos ?? []).filter((p) => !camaraId || p.camaraId === camaraId);

  // Com uma câmara escolhida não há homônimo possível (nome repetido só existe
  // entre câmaras diferentes), então o nome puro basta. Em "Todas", só os nomes
  // que de fato se repetem em outra câmara levam o sufixo — calculado sobre
  // TODOS os produtos, não só os filtrados. Sem agrupamento por câmara: o
  // cabeçalho do grupo + o sufixo mostravam a câmara duas vezes.
  const nomeCamara = new Map((opcoes?.camaras ?? []).map((c) => [c._id, c.nome]));
  const homonimos = nomesHomonimos(opcoes?.produtos ?? []);
  const rotuloDoProduto = (p: { nome: string; camaraId: Id<"camaras"> }) =>
    rotuloProduto(p.nome, nomeCamara.get(p.camaraId) ?? "—", !camaraId && homonimos.has(p.nome.trim().toLowerCase()));
  // Formatos do produto escolhido (inclui inativos: têm lançamentos antigos).
  const formatos = (opcoes?.formatos ?? []).filter((f) => f.produtoId === produtoId);

  // "De quê" é esta soma — escrito ao lado dela, nunca um número sem recorte.
  const produtoEscolhido = (opcoes?.produtos ?? []).find((p) => p._id === produtoId);
  const formatoEscolhido = formatos.find((f) => f._id === formatoId);
  const recorte = [
    camaraId ? nomeCamara.get(camaraId) ?? "—" : "Todas as câmaras",
    produtoEscolhido ? rotuloDoProduto(produtoEscolhido) : null,
    formatoEscolhido ? rotuloFormato(formatoEscolhido) : null,
    tipo ? rotuloTipo[tipo] : null,
    contagemId ? "ajustes de uma contagem" : null,
    protocolo.trim() ? `protocolo ${protocolo.trim().toUpperCase()}` : periodoLegivel(de, ate),
  ]
    .filter(Boolean)
    .join(" · ");

  // Etiquetas dos filtros ligados (além do período, que está nos campos De/Até
  // logo acima): cada uma diz o que está filtrando e sai com um clique. Inclui
  // o filtro que só chega por link ("Ver ajustes gerados", em Contagens), que
  // não tem campo próprio — sem a etiqueta, ele ficava invisível e preso.
  const autorNome = operadorId
    ? opcoes?.operadores.find((o) => o._id === operadorId)?.nome
    : autorClerkId
      ? opcoes?.admins.find((a) => a.clerkId === autorClerkId)?.nome
      : undefined;
  const etiquetas: { chave: string; texto: string; remover: () => void }[] = [
    ...(camaraId ? [{ chave: "camara", texto: `Câmara: ${nomeCamara.get(camaraId) ?? "—"}`, remover: () => { setCamaraId(""); setProdutoId(""); setFormatoId(""); } }] : []),
    ...(tipo ? [{ chave: "tipo", texto: `Tipo: ${rotuloTipo[tipo]}`, remover: () => setTipo("") }] : []),
    ...(produtoEscolhido ? [{ chave: "produto", texto: `Produto: ${rotuloDoProduto(produtoEscolhido)}`, remover: () => { setProdutoId(""); setFormatoId(""); } }] : []),
    ...(formatoEscolhido ? [{ chave: "formato", texto: `Formato: ${rotuloFormato(formatoEscolhido)}`, remover: () => setFormatoId("") }] : []),
    ...(operadorId || autorClerkId ? [{ chave: "autor", texto: `Autor: ${autorNome ?? "—"}`, remover: () => { setOperadorId(""); setAutorClerkId(""); } }] : []),
    ...(protocolo.trim() ? [{ chave: "protocolo", texto: `Protocolo: ${protocolo.trim().toUpperCase()}`, remover: limparProtocolo }] : []),
    ...(contagemId ? [{ chave: "contagem", texto: "Ajustes de uma contagem", remover: () => setContagemId("") }] : []),
  ];
  const padrao = periodoPadrao();
  const filtrado = etiquetas.length > 0 || de !== padrao.de || ate !== padrao.ate;
  function limparFiltros() {
    setCamaraId("");
    setProdutoId("");
    setFormatoId("");
    setTipo("");
    setOperadorId("");
    setAutorClerkId("");
    limparProtocolo();
    setContagemId("");
    setDe(padrao.de);
    setAte(padrao.ate);
  }

  // Monta o comprovante a partir de uma linha de saída (venda/patrocínio) e das
  // linhas do mesmo carregamento — lidas inteiras do servidor (ver
  // ComprovanteDoCarregamento), nunca só as que a página já carregou. Linha
  // avulsa vira comprovante de 1 item.
  function montarComprovante(m: MovRow, irmas: MovRow[]): DadosComprovante {
    const itens = irmas.map((x) => ({
      produtoNome: x.produtoNome,
      formatoNome: rotuloFormato({
        nome: x.formatoNome,
        pesoKg: x.formatoPesoKg,
        pesoVariavel: x.formatoPesoVariavel,
        unidadesPorPacote: x.formatoUnidadesPorPacote,
      }),
      quantidadePacotes: x.formatoPesoVariavel ? null : x.quantidade,
      unidadeContagem: x.formatoUnidadeContagem,
      pesoKg: x.pesoKg,
    }));
    return {
      rotulo: m.tipo === "venda" ? "Venda" : "Patrocínio",
      quandoMs: m.registradoEm,
      dataMovimentoMs: m.dataMovimento,
      cliente: m.clienteNome ?? "",
      itens,
      pesoTotalKg: itens.reduce((acc, it) => acc + it.pesoKg, 0),
      veiculoLabel: m.veiculo ?? "sem veículo",
      motorista: m.motorista ?? "",
      camaraNome: m.camaraNome,
      operadorNome: m.autor,
      // Todas as linhas do mesmo carregamento já saem do servidor com o
      // mesmo protocolo (protocoloDe do carregamentoId) — não precisa recalcular aqui.
      protocolo: m.protocolo,
      numeroComprovante: m.numeroComprovante,
      empresa: empresa ?? null,
    };
  }

  return (
    <>
      <TituloPagina titulo="Histórico" subtitulo="Tudo que entrou e saiu. Nada se apaga: correção é por estorno." />

      <Cartao className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Filtro label="De">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} disabled={buscaPorProtocolo} className={inputCls} />
          </Filtro>
          <Filtro label="Até">
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} disabled={buscaPorProtocolo} className={inputCls} />
          </Filtro>
          <Filtro label="Câmara">
            <SelecaoInline
              value={camaraId}
              onChange={(e) => { setCamaraId(e.target.value as Id<"camaras">); setProdutoId(""); setFormatoId(""); }}
              className={inputCls}
            >
              <option value="">Todas</option>
              {(opcoes?.camaras ?? []).map((c) => <option key={c._id} value={c._id}>{c.nome}</option>)}
            </SelecaoInline>
          </Filtro>
          <Filtro label="Tipo">
            <SelecaoInline value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={inputCls}>
              <option value="">Todos</option>
              {Object.entries(rotuloTipo).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
            </SelecaoInline>
          </Filtro>
        </div>

        <button
          type="button"
          onClick={() => setMaisFiltros((v) => !v)}
          aria-expanded={maisFiltros}
          aria-controls="filtros-avancados"
          className="mt-3 text-xs font-medium text-acento hover:underline outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
        >
          {maisFiltros
            ? "Menos filtros"
            : filtrosAvancadosAtivos > 0
              ? `Mais filtros (${filtrosAvancadosAtivos})`
              : "Mais filtros"}
        </button>

        {maisFiltros ? (
          <div id="filtros-avancados" className="mt-3 grid grid-cols-2 gap-3 border-t border-borda pt-3 md:grid-cols-4">
            <Filtro label="Protocolo">
              <input
                type="text"
                value={protocoloDigitado}
                onChange={(e) => {
                  const v = e.target.value;
                  setProtocoloDigitado(v);
                  if (v.trim().length >= 8 || v.trim() === "") setProtocolo(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setProtocolo(protocoloDigitado);
                }}
                onBlur={() => setProtocolo(protocoloDigitado)}
                maxLength={12}
                placeholder="8 caracteres, ex.: 42423F99"
                className={`${inputCls} font-mono uppercase`}
              />
            </Filtro>
            <Filtro label="Produto">
              <SelecaoInline
                value={produtoId}
                onChange={(e) => { setProdutoId(e.target.value as Id<"produtos">); setFormatoId(""); }}
                className={inputCls}
              >
                <option value="">Todos</option>
                {produtos.map((p) => (
                  <option key={p._id} value={p._id}>{rotuloDoProduto(p)}</option>
                ))}
              </SelecaoInline>
            </Filtro>
            <Filtro label="Formato">
              <SelecaoInline
                value={formatoId}
                onChange={(e) => setFormatoId(e.target.value as Id<"formatos">)}
                disabled={!produtoId}
                className={inputCls}
              >
                <option value="">{produtoId ? "Todos" : "Escolha um produto"}</option>
                {formatos.map((f) => (
                  <option key={f._id} value={f._id}>
                    {`${rotuloFormato(f)}${f.ativo ? "" : " (inativo)"}`}
                  </option>
                ))}
              </SelecaoInline>
            </Filtro>
            <Filtro label="Autor">
              <SelecaoInline
                value={operadorId ? `op:${operadorId}` : autorClerkId ? `admin:${autorClerkId}` : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("admin:")) { setAutorClerkId(v.slice(6)); setOperadorId(""); }
                  else if (v.startsWith("op:")) { setOperadorId(v.slice(3) as Id<"operadores">); setAutorClerkId(""); }
                  else { setOperadorId(""); setAutorClerkId(""); }
                }}
                className={inputCls}
              >
                <option value="">Todos</option>
                <optgroup label="Admin">
                  {(opcoes?.admins ?? []).map((a) => (
                    <option key={a.clerkId} value={`admin:${a.clerkId}`}>{a.nome}</option>
                  ))}
                </optgroup>
                <optgroup label="Colaborador">
                  {(opcoes?.operadores ?? []).map((o) => (
                    <option key={o._id} value={`op:${o._id}`}>{o.nome}</option>
                  ))}
                </optgroup>
              </SelecaoInline>
            </Filtro>
          </div>
        ) : null}

        {buscaPorProtocolo ? (
          <p className="mt-2 text-xs text-texto-suave">A busca por protocolo procura em todo o histórico; o período fica de fora.</p>
        ) : null}

        {filtrado ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-borda pt-3">
            {etiquetas.map((e) => (
              <span
                key={e.chave}
                className="inline-flex items-center gap-1 rounded-full border border-borda-forte bg-superficie-fria py-0.5 pr-1 pl-2.5 text-xs text-texto"
              >
                {e.texto}
                <button
                  type="button"
                  onClick={e.remover}
                  aria-label={`Tirar o filtro ${e.texto}`}
                  className="grid size-5 place-items-center rounded-full text-texto-suave outline-none hover:bg-superficie-fria-2 hover:text-texto focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={limparFiltros}
              className="text-xs font-medium text-acento hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
            >
              Limpar filtros
            </button>
          </div>
        ) : null}
      </Cartao>

      {linkCorrigido ? (
        <div className="mb-3">
          <Aviso tom="aviso">
            O link trazia um filtro que não existe mais (câmara, produto, formato ou pessoa removidos) e ele foi retirado.
          </Aviso>
        </div>
      ) : null}

      <ResumoRecorte resumo={resumo} recorte={recorte} de={buscaPorProtocolo ? "" : de} ate={buscaPorProtocolo ? "" : ate} />

      <Tabela
        colunas={[
          "Quando",
          "Tipo",
          "Produto / formato",
          "Câmara",
          { rotulo: "Qtd", dir: true },
          { rotulo: "Peso", dir: true },
          "Detalhe",
          "Autor",
          { rotulo: "Ações", dir: true },
        ]}
      >
        {statusMovs === "LoadingFirstPage" ? (
          <LinhaMensagem colSpan={9}>Carregando…</LinhaMensagem>
        ) : movs.length === 0 ? (
          <LinhaMensagem colSpan={9}>
            {buscaPorProtocolo
              ? `Nenhum lançamento com o protocolo ${protocolo.trim().toUpperCase()}. Confira os 8 caracteres do comprovante.`
              : `Nenhuma movimentação neste recorte (${recorte}).`}
            {filtrado ? (
              <>
                {" "}
                <button type="button" onClick={limparFiltros} className="font-medium text-acento hover:underline outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  Limpar filtros
                </button>
              </>
            ) : null}
          </LinhaMensagem>
        ) : (
          <>
            {linhas.map((l, idx) =>
              l.tipo === "individual" ? (
                <LinhaMov
                  key={l.mov._id}
                  m={l.mov}
                  onComprovante={() => setComprovanteDe(l.mov)}
                  onEstornar={() => setEstornando(l.mov)}
                />
              ) : l.tipo === "carregamento" ? (
                <LinhaGrupoCarregamento
                  key={l.carregamentoId}
                  itens={l.itens}
                  onComprovante={() => setComprovanteDe(l.itens[0])}
                  onEstornar={(m) => setEstornando(m)}
                  parcial={statusMovs === "CanLoadMore" && idx === linhas.length - 1}
                />
              ) : (
                <LinhaGrupo
                  key={l.loteId}
                  itens={l.itens}
                  onComprovante={(m) => setComprovanteDe(m)}
                  onEstornar={(m) => setEstornando(m)}
                  onEstornarTransferencia={(loteId) => setEstornandoTransferLote(loteId)}
                  // O último grupo da página pode ter mais itens na próxima.
                  parcial={statusMovs === "CanLoadMore" && idx === linhas.length - 1}
                />
              ),
            )}
            {statusMovs === "CanLoadMore" || statusMovs === "LoadingMore" ? (
              <LinhaCarregarMais
                colSpan={9}
                carregando={statusMovs === "LoadingMore"}
                resumo={`${movs.length} ${movs.length === 1 ? "movimentação carregada" : "movimentações carregadas"} · há mais no período`}
                onClick={() => loadMore(100)}
              />
            ) : (
              <tr>
                <td colSpan={9} className="px-3 py-2.5 text-center text-xs text-texto-fraco">
                  {movs.length} {movs.length === 1 ? "movimentação" : "movimentações"} · fim da lista
                </td>
              </tr>
            )}
          </>
        )}
      </Tabela>

      {comprovanteDe ? (
        comprovanteDe.carregamentoId !== null ? (
          <ComprovanteDoCarregamento
            m={comprovanteDe}
            carregamentoId={comprovanteDe.carregamentoId}
            montar={montarComprovante}
            onFechar={() => setComprovanteDe(null)}
          />
        ) : (
          <ComprovanteModal dados={montarComprovante(comprovanteDe, [comprovanteDe])} onFechar={() => setComprovanteDe(null)} />
        )
      ) : null}
      {estornando ? (
        <ModalEstorno
          m={estornando}
          onFechar={() => setEstornando(null)}
          onEstornado={() => setToast(`Estorno registrado · ${estornando.protocolo} desfeito`)}
        />
      ) : null}
      {estornandoTransferLote ? (
        <ModalEstornoTransferencia
          loteId={estornandoTransferLote}
          onFechar={() => setEstornandoTransferLote(null)}
          onEstornado={() => setToast("Transferência desfeita: as duas câmaras voltaram ao que eram")}
        />
      ) : null}
      {toast ? <Toast texto={toast} onFechar={() => setToast("")} /> : null}
    </>
  );
}

// Uma linha de movimentação — usada tanto solta quanto dentro de um grupo
// expandido (`indentado` dá o recuo visual que mostra que ela pertence a um
// lote).
// Estornável: não é ajuste (a correção de ajuste é rejeitar a contagem), não é
// um estorno (não se estorna um estorno) e ainda não foi estornado. O servidor
// revalida tudo de novo (inclusive o bloqueio de contagem já reconciliada, que
// a UI não checa aqui) — isto só decide se o botão aparece.
// Transferência não estorna por linha — as duas pernas juntas, pelo botão da
// linha agrupada (ver LinhaGrupo). motivoBloqueio no servidor bloqueia de
// qualquer forma; isto só evita mostrar um botão que ia dar erro na certa.
// Coluna "Quando" (RF65): a data do MOVIMENTO. Lançado no mesmo dia → data e
// hora do registro, como sempre. Lançado depois → o dia do movimento (sem
// hora — ninguém informou a hora) e, embaixo, quando foi de fato registrado.
function Quando({ m }: { m: Pick<MovRow, "dataMovimento" | "registradoEm"> }) {
  if (!diasDiferentes(m.dataMovimento, m.registradoEm)) return <>{dataHora(m.registradoEm)}</>;
  return (
    <>
      <span className="font-semibold text-aviso-texto">{data(m.dataMovimento)}</span>
      <span className="block text-texto-fraco">registrado {dataHora(m.registradoEm)}</span>
    </>
  );
}

// Linha estornada: os números ficam riscados (continua legível, contraste
// cheio) e o selo "estornado" diz o porquê — o lançamento segue no ledger.
const ESTORNADO = "[&_td.num]:line-through [&_td.num]:decoration-texto-fraco";

// Selo só para o Admin: o normal é o colaborador lançar; lançamento feito
// pelo escritório é a exceção que a auditoria quer enxergar.
function SeloAdmin() {
  return (
    <span className="ml-1.5 rounded-full border border-borda-forte px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
      Admin
    </span>
  );
}

function podeEstornar(m: MovRow): boolean {
  return m.tipo !== "ajuste" && m.tipo !== "estorno" && m.tipo !== "transferencia" && !m.estornado;
}

function LinhaMov({
  m,
  onComprovante,
  onEstornar,
  indentado = false,
}: {
  m: MovRow;
  // Ausente = sem botão Comprovante (item dentro de um carregamento agrupado:
  // o comprovante é do carregamento inteiro, na linha-resumo).
  onComprovante?: () => void;
  onEstornar: () => void;
  indentado?: boolean;
}) {
  return (
    <LinhaTabela className={`${indentado ? "bg-superficie-fria/40" : ""} ${m.estornado ? ESTORNADO : ""}`}>
      <td className="px-3 py-2.5 font-numero tabular-nums text-xs text-texto-suave">
        {indentado ? <span aria-hidden="true" className="mr-1 text-texto-fraco">↳</span> : null}
        <Quando m={m} />
        <span className="block font-mono text-texto-fraco">{m.protocolo}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className={m.sinal > 0 ? "text-entrada" : "text-saida"}>
          {m.sinal > 0 ? "+" : "−"} {rotuloTipo[m.tipo] ?? m.tipo}
        </span>
        {m.estornado ? (
          <span className="ml-1.5 rounded-full border border-borda-forte px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
            estornado
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-texto">{m.produtoNome} <span className="text-texto-suave">/ {rotuloFormato({ nome: m.formatoNome, pesoKg: m.formatoPesoKg, pesoVariavel: m.formatoPesoVariavel, unidadesPorPacote: m.formatoUnidadesPorPacote })}</span></td>
      <td className="px-3 py-2.5 text-texto-suave">{m.camaraNome}</td>
      <td className="num px-3 py-2.5 text-right font-numero tabular-nums font-semibold whitespace-nowrap text-texto">
        {m.formatoPesoVariavel
          ? "—"
          : comSinal(formatarQuantidade(m.quantidade, { pesoVariavel: false, unidadeContagem: m.formatoUnidadeContagem }), m.sinal)}
      </td>
      <td className="num px-3 py-2.5 text-right font-numero tabular-nums font-semibold whitespace-nowrap text-texto">
        {comSinal(formatarPeso(m.pesoKg), m.sinal)}
      </td>
      <td className="px-3 py-2.5 text-texto-suave">
        {m.tipo === "ajuste" ? (
          m.motivoCategoria === null || m.motivoCategoria === "nao_informado" ? (
            <span className="text-texto-fraco italic">Sem motivo registrado</span>
          ) : (
            <>
              {rotuloMotivoAjuste[m.motivoCategoria] ?? m.motivoCategoria}
              {m.motivoCategoria === "outro" && m.motivoTexto ? ` · ${m.motivoTexto}` : ""}
            </>
          )
        ) : m.tipo === "estorno" ? (
          <>
            {m.estornoDeProtocolo ? `Estorno de ${m.estornoDeProtocolo}` : "Estorno"}
            {m.motivoTexto ? ` · ${m.motivoTexto}` : ""}
          </>
        ) : m.tipo === "transferencia" ? (
          <>
            {m.sinal > 0 ? "Entrada por transferência" : "Saída por transferência"}
            {m.observacao ? ` · ${m.observacao}` : ""}
          </>
        ) : (
          <>
            {m.clienteNome ?? (m.motivoPerda ? `Perda: ${rotuloMotivoPerda[m.motivoPerda] ?? m.motivoPerda}` : "—")}
            {m.observacao ? ` · ${m.observacao}` : ""}
          </>
        )}
      </td>
      <td className="px-3 py-2.5">
        {/* Ênfase por peso, não por cor nova (DESIGN.md §3) — quem fez o
            lançamento é o dado que a auditoria mais procura nesta tabela. */}
        <span className="font-medium text-texto">{m.autor}</span>
        {m.autorTipo === "admin" ? <SeloAdmin /> : null}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex justify-end gap-2">
          {onComprovante && (m.tipo === "venda" || m.tipo === "patrocinio") ? (
            <Botao variante="neutro" onClick={onComprovante}>Comprovante</Botao>
          ) : null}
          {podeEstornar(m) ? (
            <Botao variante="neutro" onClick={onEstornar}>
              <Undo2 size={14} aria-hidden="true" /> Estornar
            </Botao>
          ) : null}
        </div>
      </td>
    </LinhaTabela>
  );
}

// Abre/fecha as linhas de um grupo (carregamento, ajuste, transferência).
function BotaoExpandir({ aberto, onClick, children }: { aberto: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={aberto}
      className="flex items-center gap-1.5 text-left text-texto outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
    >
      <ChevronRight
        size={14}
        className={`shrink-0 text-texto-suave transition-transform motion-reduce:transition-none ${aberto ? "rotate-90" : ""}`}
        aria-hidden="true"
      />
      <span>{children}</span>
    </button>
  );
}

// Linha-resumo de um carregamento (venda/patrocínio com vários produtos): uma
// linha só, com o total e o comprovante do carregamento inteiro — expansível
// para os produtos. O estorno continua por produto (cada linha expandida tem o
// seu), igual ao servidor (admin/estorno.ts estorna um lançamento por vez).
function LinhaGrupoCarregamento({
  itens,
  onComprovante,
  onEstornar,
  parcial = false,
}: {
  itens: MovRow[];
  onComprovante: () => void;
  onEstornar: (m: MovRow) => void;
  parcial?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const primeiro = itens[0];
  const pesoTotal = itens.reduce((acc, it) => acc + it.pesoKg, 0);
  // Mesma regra do total do comprovante: não soma pacote com unidade.
  const contagem = totalContagemComprovante({
    itens: itens.map((it) => ({
      produtoNome: it.produtoNome,
      formatoNome: it.formatoNome,
      quantidadePacotes: it.formatoPesoVariavel ? null : it.quantidade,
      unidadeContagem: it.formatoUnidadeContagem,
      pesoKg: it.pesoKg,
    })),
  } as DadosComprovante);
  const estornados = itens.filter((it) => it.estornado).length;
  const camaras = [...new Set(itens.map((it) => it.camaraNome))].join(", ");

  return (
    <>
      <LinhaTabela className={estornados === itens.length ? ESTORNADO : ""}>
        <td className="px-3 py-2.5 font-numero tabular-nums text-xs text-texto-suave">
          <Quando m={primeiro} />
          <span className="block font-mono text-texto-fraco">{primeiro.protocolo}</span>
        </td>
        <td className="px-3 py-2.5">
          <span className="text-saida">− {rotuloTipo[primeiro.tipo] ?? primeiro.tipo}</span>
          {estornados > 0 ? (
            <span className="ml-1.5 rounded-full border border-borda-forte px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
              {estornados === itens.length ? "estornado" : `${estornados} de ${itens.length} estornado${estornados > 1 ? "s" : ""}`}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2.5">
          <BotaoExpandir aberto={aberto} onClick={() => setAberto((v) => !v)}>
            {itens.length} produtos
            {parcial ? <span className="text-texto-suave"> até aqui (há mais na próxima página)</span> : null}
          </BotaoExpandir>
        </td>
        <td className="px-3 py-2.5 text-texto-suave">{camaras}</td>
        <td className="num px-3 py-2.5 text-right font-numero tabular-nums font-semibold whitespace-nowrap text-texto">
          {contagem !== null ? comSinal(formatarContagem(contagem.total, { pesoVariavel: false, unidadeContagem: contagem.modo }), -1) : "—"}
        </td>
        <td className="num px-3 py-2.5 text-right font-numero tabular-nums font-semibold whitespace-nowrap text-texto">
          {comSinal(formatarPeso(pesoTotal), -1)}
        </td>
        <td className="px-3 py-2.5 text-texto-suave">
          {primeiro.clienteNome ?? "—"}
          {primeiro.observacao ? ` · ${primeiro.observacao}` : ""}
        </td>
        <td className="px-3 py-2.5">
          <span className="font-medium text-texto">{primeiro.autor}</span>
          {primeiro.autorTipo === "admin" ? <SeloAdmin /> : null}
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex justify-end gap-2">
            <Botao variante="neutro" onClick={onComprovante}>Comprovante</Botao>
          </div>
        </td>
      </LinhaTabela>
      {aberto ? itens.map((m) => <LinhaMov key={m._id} m={m} onEstornar={() => onEstornar(m)} indentado />) : null}
    </>
  );
}

// Linha-resumo de um lote (tarefa 5 do P0: ajustes de contagem; tarefa 5 desta
// correção: transferência entre câmaras) — expansível para ver as linhas
// individuais. Lotes de ajuste reconstruídos por migração (loteInferido) não
// linkam para contagem nenhuma — não dá pra provar qual contagem gerou aquele
// lote antigo.
function LinhaGrupo({
  itens,
  onComprovante,
  onEstornar,
  onEstornarTransferencia,
  parcial = false,
}: {
  itens: MovRow[];
  onComprovante: (m: MovRow) => void;
  onEstornar: (m: MovRow) => void;
  onEstornarTransferencia: (loteId: string) => void;
  parcial?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const primeiro = itens[0];

  if (primeiro.tipo === "transferencia") {
    return (
      <LinhaGrupoTransferencia
        itens={itens}
        aberto={aberto}
        onToggle={() => setAberto((v) => !v)}
        onComprovante={onComprovante}
        onEstornar={onEstornar}
        onEstornarTransferencia={onEstornarTransferencia}
      />
    );
  }

  const pesoLiquido = itens.reduce((acc, it) => acc + it.sinal * it.pesoKg, 0);
  // Quantidade líquida só quando o lote inteiro é de um formato de peso fixo
  // (regra 6: nunca soma pacote de formatos diferentes).
  const umFormato = itens.every((it) => it.formatoNome === primeiro.formatoNome && it.produtoNome === primeiro.produtoNome);
  const qtdLiquida = itens.reduce((acc, it) => acc + it.sinal * it.quantidade, 0);
  const rotulo = primeiro.loteInferido ? "Ajuste antigo (sem contagem vinculada)" : "Ajuste de contagem";

  return (
    <>
      <LinhaTabela>
        <td className="px-3 py-2.5 font-numero tabular-nums text-xs text-texto-suave">
          <Quando m={primeiro} />
        </td>
        <td className="px-3 py-2.5">
          <span className={pesoLiquido >= 0 ? "text-entrada" : "text-saida"}>
            {pesoLiquido >= 0 ? "+" : MENOS} {rotuloTipo.ajuste}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <BotaoExpandir aberto={aberto} onClick={() => setAberto((v) => !v)}>
            {itens.length} {itens.length === 1 ? "item" : "itens"}
            {parcial ? <span className="text-texto-suave"> até aqui (há mais na próxima página)</span> : null}
          </BotaoExpandir>
        </td>
        <td className="px-3 py-2.5 text-texto-suave">{primeiro.camaraNome}</td>
        <td className="num px-3 py-2.5 text-right font-numero tabular-nums font-semibold whitespace-nowrap text-texto">
          {umFormato && !primeiro.formatoPesoVariavel
            ? comSinal(formatarContagem(Math.abs(qtdLiquida), { pesoVariavel: false, unidadeContagem: primeiro.formatoUnidadeContagem }), qtdLiquida)
            : "—"}
        </td>
        <td className="num px-3 py-2.5 text-right font-numero tabular-nums font-semibold whitespace-nowrap text-texto">
          {comSinal(formatarPeso(Math.abs(pesoLiquido)), pesoLiquido)}
        </td>
        <td className="px-3 py-2.5 text-texto-suave">{rotulo}</td>
        <td className="px-3 py-2.5">
          <span className="font-medium text-texto">{primeiro.autor}</span>
        </td>
        <td className="px-3 py-2.5 text-right">
          {!primeiro.loteInferido && primeiro.contagemId ? (
            <Link to={`/contagens?ver=${primeiro.contagemId}`} className="text-xs font-medium text-acento hover:underline outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
              Ver contagem →
            </Link>
          ) : null}
        </td>
      </LinhaTabela>
      {aberto
        ? itens.map((m) => (
            <LinhaMov
              key={m._id}
              m={m}
              onComprovante={() => onComprovante(m)}
              onEstornar={() => onEstornar(m)}
              indentado
            />
          ))
        : null}
    </>
  );
}

// Linha-resumo de uma transferência (tarefa 5): "Transferência · Cubo/Escama →
// Conteiner · 120 pacotes · 240,0 kg", expansível para as duas pernas. O
// estorno é da transferência inteira (as duas pernas juntas), nunca de uma
// perna isolada — por isso o botão vive aqui, não em LinhaMov.
function LinhaGrupoTransferencia({
  itens,
  aberto,
  onToggle,
  onComprovante,
  onEstornar,
  onEstornarTransferencia,
}: {
  itens: MovRow[];
  aberto: boolean;
  onToggle: () => void;
  onComprovante: (m: MovRow) => void;
  onEstornar: (m: MovRow) => void;
  onEstornarTransferencia: (loteId: string) => void;
}) {
  // Só uma perna carregada (filtro de Câmara mostra só o lado daquela câmara,
  // ou a página de 100 linhas cortou o par no meio): não dá pra montar
  // "origem → destino" — mostra a perna como linha comum, em vez de quebrar a
  // tela tentando ler uma perna que não veio.
  if (itens.length < 2) {
    return (
      <>
        {itens.map((m) => (
          <LinhaMov key={m._id} m={m} onComprovante={() => onComprovante(m)} onEstornar={() => onEstornar(m)} />
        ))}
      </>
    );
  }

  const origem = itens.find((it) => it.sinal < 0) ?? itens[0];
  const destino = itens.find((it) => it.sinal > 0) ?? itens[1];
  const estornado = itens.some((it) => it.estornado);
  const loteId = origem.loteId ?? destino.loteId;

  return (
    <>
      <LinhaTabela className={estornado ? ESTORNADO : ""}>
        <td className="px-3 py-2.5 font-numero tabular-nums text-xs text-texto-suave">
          <Quando m={origem} />
          <span className="block font-mono text-texto-fraco">{origem.protocolo}</span>
        </td>
        <td className="px-3 py-2.5">
          {/* Sem sinal: as duas pernas se anulam no total da fábrica. */}
          <span className="inline-flex items-center gap-1 text-texto">
            <ArrowLeftRight size={13} aria-hidden="true" className="text-texto-suave" /> {rotuloTipo.transferencia}
          </span>
          {estornado ? (
            <span className="ml-1.5 rounded-full border border-borda-forte px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em] text-texto-fraco uppercase">
              estornado
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2.5">
          <BotaoExpandir aberto={aberto} onClick={onToggle}>
            {origem.produtoNome}{" "}
            <span className="text-texto-suave">
              / {rotuloFormato({ nome: origem.formatoNome, pesoKg: origem.formatoPesoKg, pesoVariavel: origem.formatoPesoVariavel, unidadesPorPacote: origem.formatoUnidadesPorPacote })}
            </span>
          </BotaoExpandir>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap text-texto-suave">
          {origem.camaraNome} → {destino.camaraNome}
        </td>
        <td className="num px-3 py-2.5 text-right font-numero tabular-nums font-semibold whitespace-nowrap text-texto">
          {origem.formatoPesoVariavel
            ? "—"
            : formatarQuantidade(origem.quantidade, { pesoVariavel: false, unidadeContagem: origem.formatoUnidadeContagem })}
        </td>
        <td className="num px-3 py-2.5 text-right font-numero tabular-nums font-semibold whitespace-nowrap text-texto">
          {formatarPeso(origem.pesoKg)}
        </td>
        <td className="px-3 py-2.5 text-texto-suave">{origem.observacao ?? "—"}</td>
        <td className="px-3 py-2.5">
          <span className="font-medium text-texto">{origem.autor}</span>
        </td>
        <td className="px-3 py-2.5 text-right">
          {!estornado && loteId ? (
            <Botao variante="neutro" onClick={() => onEstornarTransferencia(loteId)}>
              <Undo2 size={14} aria-hidden="true" /> Estornar
            </Botao>
          ) : null}
        </td>
      </LinhaTabela>
      {aberto
        ? itens.map((m) => (
            <LinhaMov key={m._id} m={m} onComprovante={() => onComprovante(m)} onEstornar={() => onEstornar(m)} indentado />
          ))
        : null}
    </>
  );
}

// Modal de estorno (tarefa 6): mostra o impacto ANTES de confirmar — o
// servidor revalida tudo de novo (bloqueios, mínimo de 5 caracteres), este
// preview só evita o Admin descobrir um bloqueio depois de digitar o motivo.
function ModalEstorno({ m, onFechar, onEstornado }: { m: MovRow; onFechar: () => void; onEstornado: () => void }) {
  const preview = useQuery(api.admin.estorno.preview, { lancamentoId: m._id });
  const estornar = useMutation(api.admin.estorno.estornar);
  const [motivoTexto, setMotivoTexto] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro("");
    setEnviando(true);
    try {
      await estornar({ lancamentoId: m._id, motivoTexto });
      onEstornado();
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  const motivoValido = motivoTexto.trim().length >= 5;

  return (
    <Modal titulo="Estornar lançamento" onFechar={onFechar} fecharDesabilitado={enviando}>
      <div className="flex flex-col gap-3">
        {preview === undefined ? (
          <p className="text-sm text-texto-suave">Carregando…</p>
        ) : (
          <>
            <div className="rounded-lg border border-borda bg-superficie-fria/40 p-3">
              <p className="text-sm text-texto">
                {preview.produtoNome} <span className="text-texto-suave">/ {rotuloFormato({ nome: preview.formatoNome, pesoKg: preview.formatoPesoKg, pesoVariavel: preview.pesoVariavel, unidadesPorPacote: preview.formatoUnidadesPorPacote })}</span>
                <span className="text-texto-suave"> · {preview.camaraNome}</span>
              </p>
              <p className="mt-1 font-numero tabular-nums text-sm text-texto">
                {!preview.pesoVariavel ? (
                  <>{formatarQuantidade(preview.impactoQuantidade, { pesoVariavel: false, unidadeContagem: preview.formatoUnidadeContagem })} · </>
                ) : null}
                {formatarPeso(preview.impactoPesoKg)}
              </p>
              <p className="mt-2 text-xs text-texto-suave">
                Saldo depois do estorno:{" "}
                <span className="font-numero tabular-nums font-medium text-texto">
                  {formatarQuantidade(preview.saldoDepois, { pesoVariavel: preview.pesoVariavel, unidadeContagem: preview.formatoUnidadeContagem })}
                </span>
              </p>
            </div>

            {preview.bloqueio ? (
              <Aviso>{preview.bloqueio}</Aviso>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-texto-suave">Motivo do estorno (obrigatório)</span>
                <textarea
                  value={motivoTexto}
                  onChange={(e) => setMotivoTexto(e.target.value)}
                  rows={3}
                  className="rounded border border-borda bg-superficie px-2 py-1.5 text-base sm:text-sm text-texto outline-none focus:border-acento"
                  placeholder="ex.: digitei 1.130 pacotes em vez de 113"
                />
              </label>
            )}
            {erro ? <Aviso>{erro}</Aviso> : null}
            <div className="flex justify-end gap-2">
              <Botao variante="neutro" onClick={onFechar} disabled={enviando}>Cancelar</Botao>
              {!preview.bloqueio ? (
                <Botao variante="perigo" onClick={confirmar} disabled={!motivoValido || enviando}>
                  {enviando ? "Estornando…" : "Confirmar estorno"}
                </Botao>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// Modal de estorno de uma transferência inteira (tarefa 5): mostra as DUAS
// pernas (o que sai da origem, o que entra no destino) antes de confirmar —
// estornar desfaz as duas juntas, nunca uma sozinha.
function ModalEstornoTransferencia({
  loteId,
  onFechar,
  onEstornado,
}: {
  loteId: string;
  onFechar: () => void;
  onEstornado: () => void;
}) {
  const preview = useQuery(api.admin.estorno.previewTransferencia, { loteId });
  const estornar = useMutation(api.admin.estorno.estornarTransferencia);
  const [motivoTexto, setMotivoTexto] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro("");
    setEnviando(true);
    try {
      await estornar({ loteId, motivoTexto });
      onEstornado();
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  const motivoValido = motivoTexto.trim().length >= 5;

  return (
    <Modal titulo="Estornar transferência" onFechar={onFechar} fecharDesabilitado={enviando}>
      <div className="flex flex-col gap-3">
        {preview === undefined ? (
          <p className="text-sm text-texto-suave">Carregando…</p>
        ) : (
          <>
            <div className="flex flex-col gap-2 rounded-lg border border-borda bg-superficie-fria/40 p-3">
              {preview.pernas.map((p, i) => (
                <p key={i} className="text-sm text-texto">
                  <span className="text-texto-suave">{p.sentido === "origem" ? "Saiu de" : "Entrou em"} {p.camaraNome} · </span>
                  {p.produtoNome}{" "}
                  <span className="text-texto-suave">
                    / {rotuloFormato({ nome: p.formatoNome, pesoKg: p.formatoPesoKg, pesoVariavel: p.formatoPesoVariavel, unidadesPorPacote: p.formatoUnidadesPorPacote })}
                  </span>
                  <span className="ml-2 font-numero tabular-nums font-medium">
                    {p.formatoPesoVariavel
                      ? formatarPeso(p.pesoKg)
                      : `${formatarQuantidade(p.quantidade, { pesoVariavel: false, unidadeContagem: p.formatoUnidadeContagem })} · ${formatarPeso(p.pesoKg)}`}
                  </span>
                </p>
              ))}
            </div>

            {preview.bloqueio ? (
              <Aviso>{preview.bloqueio}</Aviso>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-texto-suave">Motivo do estorno (obrigatório)</span>
                <textarea
                  value={motivoTexto}
                  onChange={(e) => setMotivoTexto(e.target.value)}
                  rows={3}
                  className="rounded border border-borda bg-superficie px-2 py-1.5 text-base sm:text-sm text-texto outline-none focus:border-acento"
                  placeholder="ex.: transferi pro lugar errado"
                />
              </label>
            )}
            {erro ? <Aviso>{erro}</Aviso> : null}
            <div className="flex justify-end gap-2">
              <Botao variante="neutro" onClick={onFechar} disabled={enviando}>Cancelar</Botao>
              {!preview.bloqueio ? (
                <Botao variante="perigo" onClick={confirmar} disabled={!motivoValido || enviando}>
                  {enviando ? "Estornando…" : "Desfazer a transferência inteira"}
                </Botao>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const inputCls =
  "rounded border border-borda bg-superficie px-2 py-1.5 text-base sm:text-sm text-texto outline-none focus:border-acento disabled:cursor-not-allowed disabled:bg-fundo disabled:text-texto-suave";

function Filtro({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-texto-suave">{label}</span>
      {children}
    </label>
  );
}

// Comprovante de uma saída, para reenviar depois. Mesmo cartão do operador
// (ComprovanteCartao); aqui no kit denso do Admin. Enviar manda a IMAGEM do
// cartão pelo menu de compartilhar (src/lib/imagemComprovante.ts); "Copiar
// texto" continua copiando o texto.
// O carregamento inteiro, lido do servidor: a lista é paginada e um
// carregamento pode estar cortado entre duas páginas — o comprovante enviado
// ao cliente nunca sai faltando produto nem com o peso total errado.
function ComprovanteDoCarregamento({
  m,
  carregamentoId,
  montar,
  onFechar,
}: {
  m: MovRow;
  carregamentoId: string;
  montar: (m: MovRow, irmas: MovRow[]) => DadosComprovante;
  onFechar: () => void;
}) {
  const irmas = useQuery(api.admin.historico.carregamento, { carregamentoId });
  if (irmas === undefined) {
    return (
      <Modal titulo="Comprovante de saída" onFechar={onFechar}>
        <p role="status" className="py-6 text-center text-[13px] text-texto-suave">Lendo o carregamento inteiro…</p>
      </Modal>
    );
  }
  return <ComprovanteModal dados={montar(m, irmas)} onFechar={onFechar} />;
}

function ComprovanteModal({ dados, onFechar }: { dados: DadosComprovante; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const [aviso, setAviso] = useState("");
  const texto = textoComprovante(dados);
  const modeloImagem = useRef<HTMLDivElement>(null);
  const { imagem, gerando } = useImagemComprovante(modeloImagem, dados);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  async function enviar() {
    setAviso("");
    const r = await enviarComprovante(dados, imagem);
    if (r === "baixado") setAviso("Imagem salva no computador — anexe na conversa do WhatsApp.");
  }

  return (
    <Modal titulo="Comprovante de saída" onFechar={onFechar}>
      <div className="flex flex-col gap-4">
        <ComprovanteCartao dados={dados} denso />
        <ComprovanteParaImagem ref={modeloImagem} dados={dados} />
        {aviso ? <p className="text-xs text-texto-suave" role="status">{aviso}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Botao variante="neutro" onClick={copiar}>
            {copiado ? <><Check size={15} aria-hidden="true" /> Copiado</> : "Copiar texto"}
          </Botao>
          <Botao variante="neutro" onClick={() => imagem && baixarImagem(imagem, nomeArquivoComprovante(dados))} disabled={!imagem}>
            <Download size={15} aria-hidden="true" /> Baixar imagem
          </Botao>
          <Botao onClick={enviar} disabled={gerando}>
            <MessageCircle size={15} aria-hidden="true" /> {gerando ? "Preparando…" : "Enviar no WhatsApp"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
