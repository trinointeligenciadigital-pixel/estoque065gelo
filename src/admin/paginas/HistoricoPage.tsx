import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, ChevronRight, MessageCircle, Undo2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Cartao, LinhaMensagem, LinhaTabela, Modal, SelecaoInline, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { ComprovanteCartao } from "../../shared/ComprovanteCartao.tsx";
import { mensagemErro } from "../../lib/erros.ts";
import { dataHora } from "../../lib/data.ts";
import { formatarPacotes, formatarPeso, rotuloFormato } from "../../lib/formato.ts";
import { rotuloProduto } from "../../lib/produto.ts";
import { linkWhatsappComprovante, textoComprovante, type DadosComprovante } from "../../lib/comprovante.ts";

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
  retornoPatrocinio: "Retorno",
  perda: "Perda",
  ajuste: "Ajuste",
  estorno: "Estorno",
  transferencia: "Transferência",
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
  | { tipo: "grupo"; loteId: string; itens: MovRow[] };

// Colapsa linhas com o mesmo loteId (ajustes de uma mesma aprovação de
// contagem) numa entrada de grupo; o resto segue individual. Preserva a
// ordem de chegada (movs já vem ordenado por data, mais recente primeiro).
function agruparPorLote(movs: MovRow[]): LinhaAgrupada[] {
  const vistos = new Set<string>();
  const resultado: LinhaAgrupada[] = [];
  for (const m of movs) {
    if (m.loteId === null) {
      resultado.push({ tipo: "individual", mov: m });
      continue;
    }
    if (vistos.has(m.loteId)) continue;
    vistos.add(m.loteId);
    resultado.push({ tipo: "grupo", loteId: m.loteId, itens: movs.filter((x) => x.loteId === m.loteId) });
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

export function HistoricoPage() {
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
  const [tipo, setTipo] = useState<Tipo | "">(() => (params.get("tipo") as Tipo) || "");
  const [operadorId, setOperadorId] = useState<Id<"operadores"> | "">(() => (params.get("operadorId") as Id<"operadores">) || "");
  const [autorClerkId, setAutorClerkId] = useState<string>(() => params.get("autorClerkId") ?? "");
  const [de, setDe] = useState(() => params.get("de") ?? "");
  const [ate, setAte] = useState(() => params.get("ate") ?? "");
  const [contagemId] = useState<Id<"contagens"> | "">(() => (params.get("contagemId") as Id<"contagens">) || "");
  // Busca por protocolo (tarefa 4 do adendo) — localiza qualquer lançamento,
  // inclusive ajuste e estorno, sem precisar saber câmara/produto/tipo.
  const [protocolo, setProtocolo] = useState(() => params.get("protocolo") ?? "");
  const [comprovante, setComprovante] = useState<DadosComprovante | null>(null);
  const [estornando, setEstornando] = useState<MovRow | null>(null);
  const [estornandoTransferLote, setEstornandoTransferLote] = useState<string | null>(null);
  // Protocolo/Produto/Autor começam escondidos atrás de "Mais filtros" (só 4
  // decisões visíveis de cara: De, Até, Câmara, Tipo) — mas se o admin chegou
  // aqui por um link que já tinha um desses preenchido, mostra aberto.
  const [maisFiltros, setMaisFiltros] = useState(
    () => Boolean(params.get("protocolo") || params.get("produtoId") || params.get("operadorId") || params.get("autorClerkId")),
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (camaraId) next.set("camaraId", camaraId);
    if (produtoId) next.set("produtoId", produtoId);
    if (tipo) next.set("tipo", tipo);
    if (operadorId) next.set("operadorId", operadorId);
    if (autorClerkId) next.set("autorClerkId", autorClerkId);
    if (protocolo.trim()) next.set("protocolo", protocolo.trim());
    if (de) next.set("de", de);
    if (ate) next.set("ate", ate);
    if (contagemId) next.set("contagemId", contagemId);
    setSearchParams(next, { replace: true });
  }, [camaraId, produtoId, tipo, operadorId, autorClerkId, protocolo, de, ate, contagemId, setSearchParams]);

  const movs = useQuery(api.admin.historico.listar, {
    camaraId: camaraId || undefined,
    produtoId: produtoId || undefined,
    tipo: tipo || undefined,
    operadorId: operadorId || undefined,
    autorClerkId: autorClerkId || undefined,
    contagemId: contagemId || undefined,
    protocolo: protocolo.trim() || undefined,
    de: inicioDoDia(de),
    ate: fimDoDia(ate),
  });

  // Com produto ou contagem específicos já filtrados, mostrar as linhas
  // individuais (o Admin está procurando algo pontual). Sem esses filtros,
  // ajustes da mesma aprovação de contagem colapsam numa linha-resumo.
  const semAgrupar = produtoId !== "" || contagemId !== "";
  const linhas: LinhaAgrupada[] = semAgrupar
    ? (movs ?? []).map((mov) => ({ tipo: "individual" as const, mov }))
    : agruparPorLote(movs ?? []);

  const filtrosAvancadosAtivos = [protocolo.trim() !== "", produtoId !== "", operadorId !== "" || autorClerkId !== ""].filter(
    Boolean,
  ).length;

  // Produtos filtrados pela câmara escolhida (se houver).
  const produtos = (opcoes?.produtos ?? []).filter((p) => !camaraId || p.camaraId === camaraId);

  // Mapa de câmara para o rótulo "nome · câmara" (dois produtos podem ter o
  // mesmo nome em câmaras diferentes — o filtro tem que distingui-los).
  const nomeCamara = new Map((opcoes?.camaras ?? []).map((c) => [c._id, c.nome]));
  const produtosPorCamara = new Map<string, typeof produtos>();
  for (const p of produtos) {
    const camaraNome = nomeCamara.get(p.camaraId) ?? "—";
    const lista = produtosPorCamara.get(camaraNome) ?? [];
    lista.push(p);
    produtosPorCamara.set(camaraNome, lista);
  }

  // Monta o comprovante a partir de uma linha de saída (venda/patrocínio). Se a
  // linha faz parte de um carregamento (carregamentoId), agrupa TODAS as linhas
  // do mesmo carregamento presentes no resultado carregado — um comprovante só,
  // com todos os produtos e o peso total. Linha avulsa vira comprovante de 1 item.
  function montarComprovante(m: NonNullable<typeof movs>[number]): DadosComprovante {
    const irmas =
      m.carregamentoId != null
        ? (movs ?? []).filter((x) => x.carregamentoId === m.carregamentoId)
        : [m];
    const itens = irmas.map((x) => ({
      produtoNome: x.produtoNome,
      formatoNome: rotuloFormato({
        nome: x.formatoNome,
        pesoKg: x.formatoPesoKg,
        pesoVariavel: x.formatoPesoVariavel,
        unidadesPorPacote: x.formatoUnidadesPorPacote,
      }),
      quantidadePacotes: x.formatoPesoVariavel ? null : x.quantidade,
      pesoKg: x.pesoKg,
    }));
    return {
      rotulo: m.tipo === "venda" ? "Venda" : "Patrocínio",
      quandoMs: m.registradoEm,
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
      <TituloPagina titulo="Histórico" subtitulo="Todas as movimentações. Somente leitura." />

      <Cartao className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Filtro label="De">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={inputCls} />
          </Filtro>
          <Filtro label="Até">
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={inputCls} />
          </Filtro>
          <Filtro label="Câmara">
            <SelecaoInline
              value={camaraId}
              onChange={(e) => { setCamaraId(e.target.value as Id<"camaras">); setProdutoId(""); }}
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
          className="mt-3 text-xs font-medium text-acento hover:underline"
        >
          {maisFiltros
            ? "Menos filtros"
            : filtrosAvancadosAtivos > 0
              ? `Mais filtros (${filtrosAvancadosAtivos})`
              : "Mais filtros"}
        </button>

        {maisFiltros ? (
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-borda pt-3 md:grid-cols-3">
            <Filtro label="Protocolo">
              <input
                type="text"
                value={protocolo}
                onChange={(e) => setProtocolo(e.target.value)}
                placeholder="ex.: 42423F99"
                className={`${inputCls} font-mono uppercase`}
              />
            </Filtro>
            <Filtro label="Produto">
              <SelecaoInline value={produtoId} onChange={(e) => setProdutoId(e.target.value as Id<"produtos">)} className={inputCls}>
                <option value="">Todos</option>
                {[...produtosPorCamara.entries()].map(([camaraNome, lista]) => (
                  <optgroup key={camaraNome} label={camaraNome}>
                    {lista.map((p) => (
                      <option key={p._id} value={p._id}>{rotuloProduto(p.nome, camaraNome)}</option>
                    ))}
                  </optgroup>
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
      </Cartao>

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
          { rotulo: "Comprovante", dir: true },
        ]}
      >
        {movs === undefined ? (
          <LinhaMensagem colSpan={9}>Carregando…</LinhaMensagem>
        ) : movs.length === 0 ? (
          <LinhaMensagem colSpan={9}>Nenhuma movimentação com esses filtros.</LinhaMensagem>
        ) : (
          linhas.map((l) =>
            l.tipo === "individual" ? (
              <LinhaMov
                key={l.mov._id}
                m={l.mov}
                onComprovante={() => setComprovante(montarComprovante(l.mov))}
                onEstornar={() => setEstornando(l.mov)}
              />
            ) : (
              <LinhaGrupo
                key={l.loteId}
                itens={l.itens}
                onComprovante={(m) => setComprovante(montarComprovante(m))}
                onEstornar={(m) => setEstornando(m)}
                onEstornarTransferencia={(loteId) => setEstornandoTransferLote(loteId)}
              />
            ),
          )
        )}
      </Tabela>

      {comprovante ? (
        <ComprovanteModal dados={comprovante} onFechar={() => setComprovante(null)} />
      ) : null}
      {estornando ? (
        <ModalEstorno m={estornando} onFechar={() => setEstornando(null)} />
      ) : null}
      {estornandoTransferLote ? (
        <ModalEstornoTransferencia loteId={estornandoTransferLote} onFechar={() => setEstornandoTransferLote(null)} />
      ) : null}
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
  onComprovante: () => void;
  onEstornar: () => void;
  indentado?: boolean;
}) {
  return (
    <LinhaTabela className={`${indentado ? "bg-superficie-fria/40" : ""} ${m.estornado ? "opacity-60" : ""}`}>
      <td className="px-3 py-2.5 font-mono text-xs text-texto-suave">
        {indentado ? <span className="mr-1 text-texto-fraco">↳</span> : null}
        {dataHora(m.registradoEm)}
        <span className="block text-texto-fraco">{m.protocolo}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className={m.sinal > 0 ? "text-entrada" : "text-saida"}>
          {m.sinal > 0 ? "+" : "−"} {rotuloTipo[m.tipo] ?? m.tipo}
        </span>
        {m.estornado ? (
          <span className="ml-1.5 rounded-full border border-borda-forte px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-texto-fraco uppercase">
            estornado
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-texto">{m.produtoNome} <span className="text-texto-suave">/ {rotuloFormato({ nome: m.formatoNome, pesoKg: m.formatoPesoKg, pesoVariavel: m.formatoPesoVariavel, unidadesPorPacote: m.formatoUnidadesPorPacote })}</span></td>
      <td className="px-3 py-2.5 text-texto-suave">{m.camaraNome}</td>
      <td className="px-3 py-2.5 text-right font-mono font-semibold text-texto">
        {m.formatoPesoVariavel ? "—" : formatarPacotes(m.quantidade)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs text-texto-suave">{formatarPeso(m.pesoKg)}</td>
      <td className="px-3 py-2.5 text-texto-suave">
        {m.tipo === "ajuste" ? (
          m.motivoCategoria === null || m.motivoCategoria === "nao_informado" ? (
            <span className="text-texto-fraco italic">— anterior à exigência de motivo</span>
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
            {m.clienteNome ?? (m.motivoPerda ? `perda: ${m.motivoPerda}` : "—")}
            {m.observacao ? ` · ${m.observacao}` : ""}
          </>
        )}
      </td>
      <td className="px-3 py-2.5 text-texto-suave">
        {m.autor}{" "}
        <span className="rounded-full border border-borda-forte px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-texto-fraco uppercase">
          {m.autorTipo === "admin" ? "Admin" : "Colaborador"}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex justify-end gap-2">
          {m.tipo === "venda" || m.tipo === "patrocinio" ? (
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
}: {
  itens: MovRow[];
  onComprovante: (m: MovRow) => void;
  onEstornar: (m: MovRow) => void;
  onEstornarTransferencia: (loteId: string) => void;
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

  const pesoTotal = itens.reduce((acc, it) => acc + it.sinal * it.pesoKg, 0);
  const rotulo = primeiro.loteInferido ? "Ajuste em lote (agrupamento inferido)" : "Ajuste de contagem";

  return (
    <>
      <tr className="border-b border-borda/60 transition-colors last:border-0 hover:bg-superficie-fria">
        <td className="px-3 py-2.5 font-mono text-xs text-texto-suave">{dataHora(primeiro.registradoEm)}</td>
        <td colSpan={6} className="px-3 py-2.5">
          <button
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            className="flex w-full items-center gap-1.5 text-left text-texto outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
          >
            <ChevronRight
              size={14}
              className={`shrink-0 text-texto-suave transition-transform ${aberto ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
            <span>
              {rotulo} · {primeiro.camaraNome} · {itens.length} {itens.length === 1 ? "item" : "itens"} ·{" "}
              <span className="font-mono font-medium">{formatarPeso(pesoTotal)}</span> · {primeiro.autor}
            </span>
          </button>
        </td>
        <td className="px-3 py-2.5 text-right" colSpan={2}>
          {!primeiro.loteInferido && primeiro.contagemId ? (
            <Link to={`/contagens?ver=${primeiro.contagemId}`} className="text-xs font-medium text-acento">
              Ver contagem →
            </Link>
          ) : null}
        </td>
      </tr>
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
  const origem = itens.find((it) => it.sinal < 0) ?? itens[0];
  const destino = itens.find((it) => it.sinal > 0) ?? itens[1];
  const estornado = itens.some((it) => it.estornado);
  const loteId = origem.loteId ?? destino.loteId;

  return (
    <>
      <tr className={`border-b border-borda/60 transition-colors last:border-0 hover:bg-superficie-fria ${estornado ? "opacity-60" : ""}`}>
        <td className="px-3 py-2.5 font-mono text-xs text-texto-suave">{dataHora(origem.registradoEm)}</td>
        <td colSpan={6} className="px-3 py-2.5">
          <button
            onClick={onToggle}
            aria-expanded={aberto}
            className="flex w-full items-center gap-1.5 text-left text-texto outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
          >
            <ChevronRight
              size={14}
              className={`shrink-0 text-texto-suave transition-transform ${aberto ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
            <span>
              Transferência · {origem.camaraNome} → {destino.camaraNome} ·{" "}
              <span className="font-mono font-medium">
                {origem.formatoPesoVariavel
                  ? formatarPeso(origem.pesoKg)
                  : `${formatarPacotes(origem.quantidade)} · ${formatarPeso(origem.pesoKg)}`}
              </span>{" "}
              · {origem.autor}
            </span>
            {estornado ? (
              <span className="ml-1.5 rounded-full border border-borda-forte px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-texto-fraco uppercase">
                estornado
              </span>
            ) : null}
          </button>
        </td>
        <td className="px-3 py-2.5 text-right" colSpan={2}>
          {!estornado && loteId ? (
            <Botao variante="neutro" onClick={() => onEstornarTransferencia(loteId)}>
              <Undo2 size={14} aria-hidden="true" /> Estornar
            </Botao>
          ) : null}
        </td>
      </tr>
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
function ModalEstorno({ m, onFechar }: { m: MovRow; onFechar: () => void }) {
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
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  const motivoValido = motivoTexto.trim().length >= 5;

  return (
    <Modal titulo="Estornar lançamento" onFechar={onFechar}>
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
              <p className="mt-1 font-mono text-sm text-texto">
                {!preview.pesoVariavel ? <>{formatarPacotes(preview.impactoQuantidade)} · </> : null}
                {formatarPeso(preview.impactoPesoKg)}
              </p>
              <p className="mt-2 text-xs text-texto-suave">
                Saldo depois do estorno:{" "}
                <span className="font-mono font-medium text-texto">
                  {preview.pesoVariavel ? formatarPeso(preview.saldoDepois) : formatarPacotes(preview.saldoDepois)}
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
                  className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-texto outline-none focus:border-acento"
                  placeholder="ex.: digitei 1.130 pacotes em vez de 113"
                />
              </label>
            )}
            {erro ? <Aviso>{erro}</Aviso> : null}
            <div className="flex justify-end gap-2">
              <Botao variante="neutro" onClick={onFechar}>Cancelar</Botao>
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
function ModalEstornoTransferencia({ loteId, onFechar }: { loteId: string; onFechar: () => void }) {
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
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  const motivoValido = motivoTexto.trim().length >= 5;

  return (
    <Modal titulo="Estornar transferência" onFechar={onFechar}>
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
                  <span className="ml-2 font-mono font-medium">
                    {p.formatoPesoVariavel ? formatarPeso(p.pesoKg) : `${formatarPacotes(p.quantidade)} · ${formatarPeso(p.pesoKg)}`}
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
                  className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-texto outline-none focus:border-acento"
                  placeholder="ex.: transferi pro lugar errado"
                />
              </label>
            )}
            {erro ? <Aviso>{erro}</Aviso> : null}
            <div className="flex justify-end gap-2">
              <Botao variante="neutro" onClick={onFechar}>Cancelar</Botao>
              {!preview.bloqueio ? (
                <Botao variante="perigo" onClick={confirmar} disabled={!motivoValido || enviando}>
                  {enviando ? "Estornando…" : "Confirmar estorno das duas pernas"}
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
  "rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-texto outline-none focus:border-acento";

function Filtro({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-texto-suave">{label}</span>
      {children}
    </label>
  );
}

// Comprovante de uma saída, para reenviar depois. Mesmo texto do operador
// (src/lib/comprovante.ts); aqui no kit denso do Admin.
function ComprovanteModal({ dados, onFechar }: { dados: DadosComprovante; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const texto = textoComprovante(dados);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <Modal titulo="Comprovante de saída" onFechar={onFechar}>
      <div className="flex flex-col gap-4">
        <ComprovanteCartao dados={dados} denso />
        <div className="flex justify-end gap-2">
          <Botao variante="neutro" onClick={copiar}>
            {copiado ? <><Check size={15} aria-hidden="true" /> Copiado</> : "Copiar"}
          </Botao>
          <Botao onClick={() => window.open(linkWhatsappComprovante(dados), "_blank", "noopener")}>
            <MessageCircle size={15} aria-hidden="true" /> Enviar no WhatsApp
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
