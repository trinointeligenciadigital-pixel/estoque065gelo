import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Campo, Etiqueta, LinhaMensagem, LinhaTabela, MarcaAtivo, Modal, Selecao, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";

type Categoria = "saborizado" | "cubo" | "escamado";
type Unidade = "pacote" | "kg";
type Camara = { _id: Id<"camaras">; nome: string; ativo: boolean };
type Produto = {
  _id: Id<"produtos">;
  nome: string;
  categoria: Categoria;
  camaraId: Id<"camaras">;
  unidadeBase: Unidade;
  ativo: boolean;
};

// Pré-seleção de câmara por categoria (RF21) — sugestão de UI baseada no nome da
// câmara, já que o schema não marca categoria na câmara. Editável; se não casar,
// devolve undefined e o admin escolhe manualmente.
function sugerirCamara(categoria: Categoria, camaras: Camara[]): Id<"camaras"> | undefined {
  const ativas = camaras.filter((c) => c.ativo);
  const alvo =
    categoria === "saborizado"
      ? ativas.find((c) => /sabor/i.test(c.nome))
      : ativas.find((c) => /cubo|escam/i.test(c.nome));
  return alvo?._id;
}

export function ProdutosPage() {
  const produtos = useQuery(api.admin.produtos.listar);
  const camaras = useQuery(api.admin.camaras.listar);
  const [editando, setEditando] = useState<Produto | "novo" | null>(null);

  const nomeCamara = useMemo(() => {
    const m = new Map<string, string>();
    (camaras ?? []).forEach((c) => m.set(c._id, c.nome));
    return m;
  }, [camaras]);

  const carregando = produtos === undefined || camaras === undefined;

  return (
    <>
      <TituloPagina
        titulo="Produtos"
        subtitulo="A câmara é definida na criação e não muda depois."
        acao={<Botao onClick={() => setEditando("novo")}>Novo produto</Botao>}
      />

      <Tabela colunas={["Nome", "Categoria", "Câmara", "Un.", "Status", { rotulo: "Ações", dir: true }]}>
        {carregando ? (
          <LinhaMensagem colSpan={6}>Carregando…</LinhaMensagem>
        ) : produtos.length === 0 ? (
          <LinhaMensagem colSpan={6}>Nenhum produto cadastrado ainda. Use “Novo produto”, no topo, para adicionar o primeiro.</LinhaMensagem>
        ) : (
          produtos.map((p) => (
            <LinhaTabela key={p._id}>
              <td className="px-3 py-2.5 font-medium text-texto">{p.nome}</td>
              <td className="px-3 py-2.5 text-texto-suave">{p.categoria}</td>
              <td className="px-3 py-2.5 text-texto-suave">{nomeCamara.get(p.camaraId) ?? "—"}</td>
              <td className="px-3 py-2.5 text-texto-suave">{p.unidadeBase}</td>
              <td className="px-3 py-2.5"><Etiqueta ativo={p.ativo} /></td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex justify-end gap-2">
                  <Link to={`/produtos/${p._id}/formatos`}><Botao variante="neutro">Formatos</Botao></Link>
                  <Botao variante="neutro" onClick={() => setEditando(p)}>Editar</Botao>
                </div>
              </td>
            </LinhaTabela>
          ))
        )}
      </Tabela>

      {editando !== null && camaras !== undefined ? (
        <FormProduto
          inicial={editando === "novo" ? null : editando}
          camaras={camaras}
          nomeCamara={nomeCamara}
          onFechar={() => setEditando(null)}
        />
      ) : null}
    </>
  );
}

function FormProduto({
  inicial,
  camaras,
  nomeCamara,
  onFechar,
}: {
  inicial: Produto | null;
  camaras: Camara[];
  nomeCamara: Map<string, string>;
  onFechar: () => void;
}) {
  const criar = useMutation(api.admin.produtos.criar);
  const atualizar = useMutation(api.admin.produtos.atualizar);
  const ativas = camaras.filter((c) => c.ativo);

  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [categoria, setCategoria] = useState<Categoria>(inicial?.categoria ?? "saborizado");
  const [camaraId, setCamaraId] = useState<Id<"camaras"> | "">(
    inicial?.camaraId ?? sugerirCamara("saborizado", camaras) ?? "",
  );
  const [unidadeBase, setUnidadeBase] = useState<Unidade>(inicial?.unidadeBase ?? "pacote");
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const novo = inicial === null;

  function trocarCategoria(nova: Categoria) {
    setCategoria(nova);
    // Só re-sugere a câmara na criação (na edição a câmara é imutável).
    if (novo) {
      const sugerida = sugerirCamara(nova, camaras);
      if (sugerida) setCamaraId(sugerida);
    }
  }

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      if (novo) {
        if (camaraId === "") throw new Error();
        await criar({
          nome,
          categoria,
          camaraId,
          unidadeBase,
        });
      } else {
        await atualizar({
          id: inicial._id,
          nome,
          unidadeBase,
          ativo,
        });
      }
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={novo ? "Novo produto" : "Editar produto"} onFechar={onFechar}>
      <div className="flex flex-col gap-3">
        <Campo label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Morango" />

        <Selecao label="Categoria" value={categoria} onChange={(e) => trocarCategoria(e.target.value as Categoria)} disabled={!novo}>
          <option value="saborizado">Saborizado</option>
          <option value="cubo">Cubo</option>
          <option value="escamado">Escamado</option>
        </Selecao>

        {novo ? (
          <Selecao label="Câmara (definida agora, não muda depois)" value={camaraId} onChange={(e) => setCamaraId(e.target.value as Id<"camaras">)}>
            <option value="" disabled>Selecione…</option>
            {ativas.map((c) => (
              <option key={c._id} value={c._id}>{c.nome}</option>
            ))}
          </Selecao>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-texto-suave">Câmara (fixa)</span>
            <div className="rounded border border-borda bg-fundo px-2 py-1.5 text-sm text-texto-suave">
              {nomeCamara.get(inicial.camaraId) ?? "—"}
            </div>
          </div>
        )}

        <Selecao label="Unidade base" value={unidadeBase} onChange={(e) => setUnidadeBase(e.target.value as Unidade)}>
          <option value="pacote">Pacote</option>
          <option value="kg">Kg</option>
        </Selecao>

        <p className="text-xs text-texto-suave">
          O estoque mínimo é definido em cada formato (por tamanho de pacote), na tela de Formatos.
        </p>

        {!novo ? (
          <MarcaAtivo
            label="Ativo"
            avisoDesativar="Desativar este produto: ele deixa de aparecer para o colaborador nos lançamentos e contagens. O histórico e o estoque já registrados são preservados."
            marcado={ativo}
            onToggle={() => setAtivo(!ativo)}
          />
        ) : null}
        {erro ? <Aviso>{erro}</Aviso> : null}

        <div className="flex justify-end gap-2">
          <Botao variante="neutro" onClick={onFechar}>Cancelar</Botao>
          <Botao onClick={salvar} disabled={salvando || nome.trim() === "" || (novo && camaraId === "")}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
