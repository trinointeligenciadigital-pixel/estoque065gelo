import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, MessageCircle } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Botao, Cartao, LinhaMensagem, LinhaTabela, Modal, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { dataHora } from "../../lib/data.ts";
import { formatarPacotes, formatarPeso } from "../../lib/formato.ts";
import {
  linhasComprovante,
  linkWhatsappComprovante,
  textoComprovante,
  type DadosComprovante,
} from "../../lib/comprovante.ts";

/*
  Histórico (RF61, RF62). Somente leitura: nenhuma linha tem ação de editar ou
  excluir — nem existe endpoint para isso. Filtros por câmara, produto, tipo,
  período e autor.
*/
type Tipo = "producao" | "venda" | "patrocinio" | "retornoPatrocinio" | "perda" | "ajuste";
const rotuloTipo: Record<Tipo, string> = {
  producao: "Produção",
  venda: "Venda",
  patrocinio: "Patrocínio",
  retornoPatrocinio: "Retorno",
  perda: "Perda",
  ajuste: "Ajuste",
};

// Converte "AAAA-MM-DD" (input date) em ms; fim inclui o dia inteiro.
function inicioDoDia(s: string): number | undefined {
  return s ? new Date(`${s}T00:00:00`).getTime() : undefined;
}
function fimDoDia(s: string): number | undefined {
  return s ? new Date(`${s}T23:59:59.999`).getTime() : undefined;
}

export function HistoricoPage() {
  const opcoes = useQuery(api.admin.historico.opcoesFiltro);

  // Pré-carrega o período pela URL (ex.: clique num dia do gráfico do Painel abre
  // /historico?de=AAAA-MM-DD&ate=AAAA-MM-DD). Depois vira estado interno normal.
  const [params] = useSearchParams();

  const [camaraId, setCamaraId] = useState<Id<"camaras"> | "">("");
  const [produtoId, setProdutoId] = useState<Id<"produtos"> | "">("");
  const [tipo, setTipo] = useState<Tipo | "">("");
  const [operadorId, setOperadorId] = useState<Id<"operadores"> | "">("");
  const [autorTipo, setAutorTipo] = useState<"operador" | "admin" | "">("");
  const [de, setDe] = useState(() => params.get("de") ?? "");
  const [ate, setAte] = useState(() => params.get("ate") ?? "");
  const [comprovante, setComprovante] = useState<DadosComprovante | null>(null);

  const movs = useQuery(api.admin.historico.listar, {
    camaraId: camaraId || undefined,
    produtoId: produtoId || undefined,
    tipo: tipo || undefined,
    operadorId: operadorId || undefined,
    autorTipo: autorTipo || undefined,
    de: inicioDoDia(de),
    ate: fimDoDia(ate),
  });

  // Produtos filtrados pela câmara escolhida (se houver).
  const produtos = (opcoes?.produtos ?? []).filter((p) => !camaraId || p.camaraId === camaraId);

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
      formatoNome: x.formatoNome,
      quantidadeLabel: x.formatoPesoVariavel ? "" : formatarPacotes(x.quantidade),
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
      // Num carregamento, o protocolo é o do grupo (8 chars do carregamentoId).
      protocolo: m.carregamentoId != null ? m.carregamentoId.slice(0, 8).toUpperCase() : m.protocolo,
    };
  }

  return (
    <>
      <TituloPagina titulo="Histórico" subtitulo="Todas as movimentações. Somente leitura." />

      <Cartao className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Filtro label="Câmara">
            <select
              value={camaraId}
              onChange={(e) => { setCamaraId(e.target.value as Id<"camaras">); setProdutoId(""); }}
              className={inputCls}
            >
              <option value="">Todas</option>
              {(opcoes?.camaras ?? []).map((c) => <option key={c._id} value={c._id}>{c.nome}</option>)}
            </select>
          </Filtro>
          <Filtro label="Produto">
            <select value={produtoId} onChange={(e) => setProdutoId(e.target.value as Id<"produtos">)} className={inputCls}>
              <option value="">Todos</option>
              {produtos.map((p) => <option key={p._id} value={p._id}>{p.nome}</option>)}
            </select>
          </Filtro>
          <Filtro label="Tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={inputCls}>
              <option value="">Todos</option>
              {Object.entries(rotuloTipo).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
            </select>
          </Filtro>
          <Filtro label="Autor">
            <select
              value={operadorId ? `op:${operadorId}` : autorTipo === "admin" ? "admin" : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "admin") { setAutorTipo("admin"); setOperadorId(""); }
                else if (v.startsWith("op:")) { setOperadorId(v.slice(3) as Id<"operadores">); setAutorTipo(""); }
                else { setOperadorId(""); setAutorTipo(""); }
              }}
              className={inputCls}
            >
              <option value="">Todos</option>
              <option value="admin">Admin</option>
              {(opcoes?.operadores ?? []).map((o) => <option key={o._id} value={`op:${o._id}`}>{o.nome}</option>)}
            </select>
          </Filtro>
          <Filtro label="De">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={inputCls} />
          </Filtro>
          <Filtro label="Até">
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={inputCls} />
          </Filtro>
        </div>
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
          movs.map((m) => (
            <LinhaTabela key={m._id}>
              <td className="px-3 py-2.5 font-mono text-xs text-texto-suave">{dataHora(m.registradoEm)}</td>
              <td className="px-3 py-2.5">
                <span className={m.sinal > 0 ? "text-entrada" : "text-saida"}>
                  {m.sinal > 0 ? "+" : "−"} {rotuloTipo[m.tipo] ?? m.tipo}
                </span>
              </td>
              <td className="px-3 py-2.5 text-texto">{m.produtoNome} <span className="text-texto-suave">/ {m.formatoNome}</span></td>
              <td className="px-3 py-2.5 text-texto-suave">{m.camaraNome}</td>
              <td className="px-3 py-2.5 text-right font-mono text-texto">
                {m.formatoPesoVariavel ? "—" : formatarPacotes(m.quantidade)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-texto">{formatarPeso(m.pesoKg)}</td>
              <td className="px-3 py-2.5 text-texto-suave">
                {m.clienteNome ?? (m.motivoPerda ? `perda: ${m.motivoPerda}` : "—")}
                {m.observacao ? ` · ${m.observacao}` : ""}
              </td>
              <td className="px-3 py-2.5 text-texto-suave">{m.autor}</td>
              <td className="px-3 py-2.5 text-right">
                {m.tipo === "venda" || m.tipo === "patrocinio" ? (
                  <Botao variante="neutro" onClick={() => setComprovante(montarComprovante(m))}>
                    Comprovante
                  </Botao>
                ) : null}
              </td>
            </LinhaTabela>
          ))
        )}
      </Tabela>

      {comprovante ? (
        <ComprovanteModal dados={comprovante} onFechar={() => setComprovante(null)} />
      ) : null}
    </>
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
  const linhas = linhasComprovante(dados);

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
        <div className="overflow-hidden rounded-lg border border-borda">
          <div className="border-b border-borda px-3 py-2">
            <span className="text-sm font-semibold text-texto">{dados.rotulo}</span>{" "}
            <span className="font-mono text-xs text-texto-suave">{dataHora(dados.quandoMs)}</span>
          </div>
          <dl>
            {linhas.map((l, i) =>
              l.forte ? (
                <div
                  key={i}
                  className="flex items-baseline justify-between gap-3 border-y border-borda bg-superficie-fria/40 px-3 py-2"
                >
                  <dt className="text-sm font-medium text-texto">{l.rotulo}</dt>
                  <dd className="text-right font-mono text-xl font-semibold text-texto">{l.valor}</dd>
                </div>
              ) : (
                <div
                  key={i}
                  className="flex items-baseline justify-between gap-3 border-b border-borda/60 px-3 py-1.5 last:border-0"
                >
                  <dt className="min-w-0 flex-1 text-sm text-texto-suave">{l.rotulo}</dt>
                  <dd className={`shrink-0 text-right text-sm text-texto ${l.mono ? "font-mono" : ""}`}>{l.valor}</dd>
                </div>
              ),
            )}
          </dl>
          <div className="flex items-center justify-between border-t border-borda px-3 py-1.5">
            <span className="font-mono text-[10px] font-medium tracking-[0.1em] text-texto-fraco uppercase">
              Protocolo
            </span>
            <span className="font-mono text-sm text-texto">{dados.protocolo}</span>
          </div>
        </div>
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
