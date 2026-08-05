import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, LinhaMensagem, LinhaTabela, Modal, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";
import { dataHora } from "../../lib/data.ts";
import { formatarPacotes, formatarPeso, rotuloFormato } from "../../lib/formato.ts";

/*
  Contagens (RF51–RF56). O Admin vê as pendentes, confere a divergência item a
  item e decide: aprovar gera ajuste só onde há divergência; rejeitar não mexe no
  ledger. Quem abriu não decide (RF52) — os botões somem e a mutation revalida.
  O Admin também pode ABRIR e contar às cegas (RF46).
*/
function formatarQtd(n: number, pesoVariavel: boolean): string {
  return pesoVariavel ? formatarPeso(n) : formatarPacotes(n);
}
function dataHoraOuTraco(ms: number | null): string {
  return ms ? dataHora(ms) : "—";
}

type Retomar = { contagemId: Id<"contagens">; camaraId: Id<"camaras"> };
type Vista =
  | { tela: "lista" }
  | { tela: "detalhe"; id: Id<"contagens"> }
  | { tela: "nova" }
  | { tela: "retomar"; retomar: Retomar };

export function ContagensPage() {
  const pendentes = useQuery(api.admin.contagens.pendentes);
  const emAndamento = useQuery(api.admin.contagens.emAndamento);
  const historico = useQuery(api.admin.contagens.historico);
  // "Ver contagem" no grupo de ajustes do Histórico abre /contagens?ver=<id>
  // direto no detalhe (tarefa 5) — mesmo padrão de pré-carga por URL que o
  // Histórico já usa para período.
  const [params] = useSearchParams();
  const [vista, setVista] = useState<Vista>(() => {
    const ver = params.get("ver");
    return ver ? { tela: "detalhe", id: ver as Id<"contagens"> } : { tela: "lista" };
  });
  const [aba, setAba] = useState<"pendentes" | "historico">("pendentes");
  const voltar = () => setVista({ tela: "lista" });

  if (vista.tela === "detalhe") {
    return <Detalhe id={vista.id} onVoltar={voltar} />;
  }

  return (
    <>
      <TituloPagina
        titulo="Contagens"
        subtitulo="Confira a divergência e decida. Ajuste de estoque só nasce de uma contagem aprovada."
        acao={<Botao onClick={() => setVista({ tela: "nova" })}>Nova contagem</Botao>}
      />

      {/* Em andamento (aberta, não finalizada). Só aparece quando há alguma —
          normalmente vazio. É o que destrava uma câmara presa por uma contagem
          que alguém abriu e não terminou. */}
      {emAndamento && emAndamento.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-texto">Em andamento (não finalizadas)</h2>
          <Tabela colunas={["Câmara", "Aberta por", "Aberta em", { rotulo: "Ação", dir: true }]}>
            {emAndamento.map((c) => (
              <LinhaAndamento
                key={c._id}
                item={c}
                onRetomar={() => setVista({ tela: "retomar", retomar: { contagemId: c._id, camaraId: c.camaraId } })}
              />
            ))}
          </Tabela>
        </section>
      ) : null}

      <div className="mb-3 inline-flex rounded-lg border border-borda bg-superficie p-0.5">
        {(["pendentes", "historico"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            aria-pressed={aba === a}
            className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${
              aba === a ? "bg-superficie-fria-2 text-acento" : "text-texto-suave hover:text-texto"
            }`}
          >
            {a === "pendentes" ? "Aguardando decisão" : "Histórico"}
          </button>
        ))}
      </div>

      {aba === "pendentes" ? (
        <Tabela colunas={["Câmara", "Aberta por", "Fechada em", { rotulo: "Ação", dir: true }]}>
          {pendentes === undefined ? (
            <LinhaMensagem colSpan={4}>Carregando…</LinhaMensagem>
          ) : pendentes.length === 0 ? (
            <LinhaMensagem colSpan={4}>Nenhuma contagem aguardando decisão.</LinhaMensagem>
          ) : (
            pendentes.map((c) => (
              <LinhaTabela key={c._id}>
                <td className="px-3 py-2.5 font-medium text-texto">{c.camaraNome}</td>
                <td className="px-3 py-2.5 text-texto-suave">{c.abertaPorNome}</td>
                <td className="px-3 py-2.5 font-mono text-texto-suave">{dataHoraOuTraco(c.fechadaEm)}</td>
                <td className="px-3 py-2.5 text-right">
                  <Botao variante="neutro" onClick={() => setVista({ tela: "detalhe", id: c._id })}>Conferir</Botao>
                </td>
              </LinhaTabela>
            ))
          )}
        </Tabela>
      ) : (
        <Tabela colunas={["Câmara", "Status", "Decidida por", "Quando", { rotulo: "Divergência", dir: true }, { rotulo: "Ação", dir: true }]}>
          {historico === undefined ? (
            <LinhaMensagem colSpan={6}>Carregando…</LinhaMensagem>
          ) : historico.length === 0 ? (
            <LinhaMensagem colSpan={6}>Nenhuma contagem decidida ainda.</LinhaMensagem>
          ) : (
            historico.map((c) => (
              <LinhaTabela key={c._id}>
                <td className="px-3 py-2.5 font-medium text-texto">{c.camaraNome}</td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      c.status === "aprovada" ? "bg-entrada/10 text-entrada" : "bg-alerta/10 text-alerta"
                    }`}
                  >
                    {c.status === "aprovada" ? "aprovada" : "rejeitada"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-texto-suave">{c.decididaPorNome}</td>
                <td className="px-3 py-2.5 font-mono text-texto-suave">{dataHoraOuTraco(c.decididaEm)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-texto">{formatarPeso(c.divergenciaTotalKg)}</td>
                <td className="px-3 py-2.5 text-right">
                  <Botao variante="neutro" onClick={() => setVista({ tela: "detalhe", id: c._id })}>Ver</Botao>
                </td>
              </LinhaTabela>
            ))
          )}
        </Tabela>
      )}

      {vista.tela === "nova" ? <NovaContagem onFechar={voltar} /> : null}
      {vista.tela === "retomar" ? <NovaContagem retomar={vista.retomar} onFechar={voltar} /> : null}
    </>
  );
}

// Linha de uma contagem em andamento. Quem a abriu pode Retomar (continuar e
// finalizar); qualquer Admin pode Cancelar (descarta e libera a câmara — não
// mexe no estoque). Cancelar pede confirmação inline (um clique só descarta o
// trabalho de contagem de alguém).
function LinhaAndamento({
  item,
  onRetomar,
}: {
  item: {
    _id: Id<"contagens">;
    camaraNome: string;
    abertaPorNome: string;
    abertaEm: number;
    euAbri: boolean;
  };
  onRetomar: () => void;
}) {
  const cancelar = useMutation(api.admin.contagens.cancelar);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function confirmarCancelar() {
    setErro("");
    setOcupado(true);
    try {
      await cancelar({ contagemId: item._id });
      // A linha some sozinha quando a query `emAndamento` reagir.
    } catch (e) {
      setErro(mensagemErro(e));
      setOcupado(false);
      setConfirmando(false);
    }
  }

  return (
    <LinhaTabela>
      <td className="px-3 py-2.5 font-medium text-texto">{item.camaraNome}</td>
      <td className="px-3 py-2.5 text-texto-suave">{item.abertaPorNome}</td>
      <td className="px-3 py-2.5 font-mono text-texto-suave">{dataHora(item.abertaEm)}</td>
      <td className="px-3 py-2.5 text-right">
        {confirmando ? (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-texto-suave">Descartar esta contagem?</span>
            <Botao variante="perigo" onClick={confirmarCancelar} disabled={ocupado}>
              {ocupado ? "Cancelando…" : "Sim, cancelar"}
            </Botao>
            <Botao variante="neutro" onClick={() => setConfirmando(false)} disabled={ocupado}>
              Não
            </Botao>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {erro ? <span className="text-xs text-alerta">{erro}</span> : null}
            {item.euAbri ? (
              <Botao variante="neutro" onClick={onRetomar}>Retomar</Botao>
            ) : null}
            <Botao variante="perigo" onClick={() => setConfirmando(true)}>Cancelar</Botao>
          </div>
        )}
      </td>
    </LinhaTabela>
  );
}

function Detalhe({ id, onVoltar }: { id: Id<"contagens">; onVoltar: () => void }) {
  const contagem = useQuery(api.admin.contagens.detalhe, { contagemId: id });
  const aprovar = useMutation(api.admin.contagens.aprovar);
  const rejeitar = useMutation(api.admin.contagens.rejeitar);
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function decidir(acao: "aprovar" | "rejeitar") {
    setErro("");
    setEnviando(true);
    try {
      if (acao === "aprovar") await aprovar({ contagemId: id, observacao: observacao.trim() || undefined });
      else await rejeitar({ contagemId: id, observacao: observacao.trim() || undefined });
      onVoltar();
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  if (contagem === undefined) return <p className="text-sm text-texto-suave">Carregando…</p>;

  return (
    <>
      <div className="mb-2">
        <button onClick={onVoltar} className="text-sm text-acento">← Contagens</button>
      </div>
      <TituloPagina
        titulo={`Contagem — ${contagem.camaraNome}`}
        subtitulo={`Aberta por ${contagem.abertaPorNome} · fechada em ${dataHoraOuTraco(contagem.fechadaEm)}`}
      />

      <Tabela
        colunas={[
          "Produto",
          "Formato",
          { rotulo: "Contado", dir: true },
          { rotulo: "Sistema", dir: true },
          { rotulo: "Divergência", dir: true },
        ]}
      >
        {contagem.itens.map((it) => {
          const div = it.divergencia;
          return (
            <tr key={it._id} className={`border-b border-borda/60 last:border-0 ${div !== 0 ? "bg-alerta/5" : ""}`}>
              <td className="px-3 py-2.5 font-medium text-texto">{it.produtoNome}</td>
              <td className="px-3 py-2.5 text-texto-suave">
                {rotuloFormato({ nome: it.formatoNome, pesoKg: it.formatoPesoKg, pesoVariavel: it.pesoVariavel, unidadesPorPacote: it.formatoUnidadesPorPacote })}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-texto">{formatarQtd(it.saldoContado, it.pesoVariavel)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-texto">{formatarQtd(it.saldoSistema, it.pesoVariavel)}</td>
              <td className={`px-3 py-2.5 text-right font-mono ${div !== 0 ? "font-semibold text-alerta" : "text-texto-suave"}`}>
                {div > 0 ? "+" : ""}{formatarQtd(div, it.pesoVariavel)}
              </td>
            </tr>
          );
        })}
      </Tabela>

      {contagem.status !== "pendente" ? (
        <div className="mt-4 flex flex-col gap-3">
          <Aviso tom="info">
            {contagem.status === "aprovada" ? "Aprovada" : "Rejeitada"} em {dataHoraOuTraco(contagem.decididaEm)}.
            {contagem.observacaoDecisao ? ` "${contagem.observacaoDecisao}"` : ""}
          </Aviso>
          {contagem.status === "aprovada" ? (
            <Link to={`/historico?contagemId=${id}`} className="text-sm font-medium text-acento">
              Ver ajustes gerados no Histórico →
            </Link>
          ) : null}
        </div>
      ) : contagem.euAbri ? (
        <div className="mt-4">
          <Aviso tom="info">
            Você abriu esta contagem, então não pode decidi-la. Peça a outro Admin para conferir e aprovar/rejeitar.
          </Aviso>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-texto-suave">Observação (opcional)</span>
            <input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-texto outline-none focus:border-acento"
              placeholder="motivo da decisão, se quiser registrar"
            />
          </label>
          {erro ? <Aviso>{erro}</Aviso> : null}
          <div className="flex gap-2">
            <Botao onClick={() => decidir("aprovar")} disabled={enviando}>
              {enviando ? "Processando…" : "Aprovar (gera ajuste)"}
            </Botao>
            <Botao variante="perigo" onClick={() => decidir("rejeitar")} disabled={enviando}>
              Rejeitar (não mexe no estoque)
            </Botao>
          </div>
        </div>
      )}
    </>
  );
}

// Admin abre e conta às cegas (RF46). Escolhe a câmara, digita o contado por
// formato sem ver o saldo do sistema, e fecha — vira pendente para OUTRO Admin.
// Com `retomar`, continua uma contagem que já estava aberta (pula a escolha de
// câmara e vai direto ao grid).
function NovaContagem({ retomar, onFechar }: { retomar?: Retomar; onFechar: () => void }) {
  const camaras = useQuery(api.admin.camaras.listar);
  const abrir = useMutation(api.admin.contagens.abrir);
  const fechar = useMutation(api.admin.contagens.fechar);
  const cancelar = useMutation(api.admin.contagens.cancelar);

  const [camaraId, setCamaraId] = useState<Id<"camaras"> | "">(retomar?.camaraId ?? "");
  const [contagemId, setContagemId] = useState<Id<"contagens"> | null>(retomar?.contagemId ?? null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // Contagem que ABRIMOS aqui e ainda não finalizamos. Se o modal for fechado sem
  // finalizar, cancelamos essa contagem para não deixar a câmara travada por uma
  // contagem órfã (prevenção). Uma contagem RETOMADA não entra aqui: ela já está
  // na lista "em andamento" e continua recuperável se o modal fechar.
  const orfaRef = useRef<Id<"contagens"> | null>(null);

  const itens = useQuery(
    api.admin.contagens.itensParaContagem,
    camaraId && contagemId ? { camaraId } : "skip",
  );
  const [contado, setContado] = useState<Record<string, string>>({});

  // Fecha o modal e limpa a órfã (se houver). Passa por aqui todo caminho de
  // fechamento: botão Cancelar, X, Esc e clique no fundo (o Modal chama onFechar).
  function aoFechar() {
    const orfa = orfaRef.current;
    orfaRef.current = null;
    if (orfa) {
      void cancelar({
        contagemId: orfa,
        observacao: "cancelada automaticamente (aberta e não finalizada)",
      }).catch(() => {});
    }
    onFechar();
  }

  async function abrirContagem() {
    if (!camaraId) return;
    setErro("");
    setOcupado(true);
    try {
      const r = await abrir({ camaraId });
      setContagemId(r.contagemId);
      orfaRef.current = r.contagemId; // criada aqui; some ao finalizar
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function fecharContagem() {
    if (!contagemId || !itens) return;
    setErro("");
    setOcupado(true);
    try {
      const payload = itens.flatMap((p) =>
        p.formatos.map((f) => ({
          produtoId: p._id,
          formatoId: f._id,
          saldoContado: Number(contado[f._id]) || 0,
        })),
      );
      await fechar({ contagemId, itens: payload });
      orfaRef.current = null; // finalizada: não é mais órfã
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setOcupado(false);
    }
  }

  const ativas = (camaras ?? []).filter((c) => c.ativo);

  return (
    <Modal titulo={retomar ? "Retomar contagem (às cegas)" : "Nova contagem (às cegas)"} onFechar={aoFechar}>
      {contagemId === null ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-texto-suave">
            Você vai contar sem ver o saldo do sistema. Ao fechar, outro Admin confere a divergência.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-texto-suave">Câmara</span>
            <select
              value={camaraId}
              onChange={(e) => setCamaraId(e.target.value as Id<"camaras">)}
              className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-texto outline-none focus:border-acento"
            >
              <option value="">— escolha —</option>
              {ativas.map((c) => (
                <option key={c._id} value={c._id}>{c.nome}</option>
              ))}
            </select>
          </label>
          {erro ? <Aviso>{erro}</Aviso> : null}
          <div className="flex justify-end gap-2">
            <Botao variante="neutro" onClick={aoFechar}>Cancelar</Botao>
            <Botao onClick={abrirContagem} disabled={ocupado || !camaraId}>
              {ocupado ? "Abrindo…" : "Abrir e contar"}
            </Botao>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {itens === undefined ? (
            <p className="text-sm text-texto-suave">Carregando itens…</p>
          ) : itens.length === 0 ? (
            <p className="text-sm text-texto-suave">Nenhum produto ativo nesta câmara.</p>
          ) : (
            <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
              {itens.map((p) => (
                <div key={p._id}>
                  <h3 className="mb-1 text-sm font-semibold text-texto">{p.nome}</h3>
                  <div className="flex flex-col gap-1">
                    {p.formatos.map((f) => (
                      <label key={f._id} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-texto">
                          {rotuloFormato(f)} <span className="text-texto-suave">({f.pesoVariavel ? "kg" : "pacotes"})</span>
                        </span>
                        <input
                          inputMode="decimal"
                          value={contado[f._id] ?? ""}
                          onChange={(e) => setContado((c) => ({ ...c, [f._id]: e.target.value }))}
                          placeholder="0"
                          className="w-24 rounded border border-borda bg-superficie px-2 py-1.5 text-right font-mono text-sm text-texto outline-none focus:border-acento"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {erro ? <Aviso>{erro}</Aviso> : null}
          <div className="flex justify-end gap-2">
            <Botao onClick={fecharContagem} disabled={ocupado || itens === undefined}>
              {ocupado ? "Enviando…" : "Fechar contagem"}
            </Botao>
          </div>
        </div>
      )}
    </Modal>
  );
}
