import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Campo, Etiqueta, LinhaMensagem, LinhaTabela, Marca, MarcaAtivo, Modal, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";
import { formatarPacotes, formatarPeso } from "../../lib/formato.ts";

type Formato = {
  _id: Id<"formatos">;
  nome: string;
  pesoKg: number;
  pesoVariavel: boolean;
  estoqueMinimo?: number;
  ativo: boolean;
};

export function FormatosPage() {
  const { produtoId } = useParams<{ produtoId: string }>();
  const id = produtoId as Id<"produtos">;
  const produtos = useQuery(api.admin.produtos.listar);
  const formatos = useQuery(api.admin.formatos.listarPorProduto, { produtoId: id });
  const [editando, setEditando] = useState<Formato | "novo" | null>(null);

  const produto = produtos?.find((p) => p._id === id);

  return (
    <>
      <div className="mb-2">
        <Link to="/produtos" className="text-sm text-acento">← Produtos</Link>
      </div>
      <TituloPagina
        titulo={produto ? `Formatos — ${produto.nome}` : "Formatos"}
        subtitulo="Cada formato tem seu peso e seu estoque mínimo (por tamanho de pacote)."
        acao={<Botao onClick={() => setEditando("novo")}>Novo formato</Botao>}
      />

      <Tabela
        colunas={[
          "Nome",
          { rotulo: "Peso (kg)", dir: true },
          { rotulo: "Est. mín.", dir: true },
          "Status",
          { rotulo: "Ações", dir: true },
        ]}
      >
        {formatos === undefined ? (
          <LinhaMensagem colSpan={5}>Carregando…</LinhaMensagem>
        ) : formatos.length === 0 ? (
          <LinhaMensagem colSpan={5}>Nenhum formato cadastrado ainda. Use “Novo formato”, no topo, para adicionar o primeiro.</LinhaMensagem>
        ) : (
          formatos.map((f) => (
            <LinhaTabela key={f._id}>
              <td className="px-3 py-2.5 font-medium text-texto">{f.nome}</td>
              <td className="px-3 py-2.5 text-right font-mono text-texto">
                {f.pesoVariavel ? <span className="text-texto-suave">variável</span> : formatarPeso(f.pesoKg)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-texto-suave">
                {f.estoqueMinimo
                  ? f.pesoVariavel
                    ? formatarPeso(f.estoqueMinimo)
                    : formatarPacotes(f.estoqueMinimo)
                  : "—"}
              </td>
              <td className="px-3 py-2.5"><Etiqueta ativo={f.ativo} /></td>
              <td className="px-3 py-2.5 text-right">
                <Botao variante="neutro" onClick={() => setEditando(f)}>Editar</Botao>
              </td>
            </LinhaTabela>
          ))
        )}
      </Tabela>

      {editando !== null ? (
        <FormFormato
          produtoId={id}
          inicial={editando === "novo" ? null : editando}
          onFechar={() => setEditando(null)}
        />
      ) : null}
    </>
  );
}

function FormFormato({
  produtoId,
  inicial,
  onFechar,
}: {
  produtoId: Id<"produtos">;
  inicial: Formato | null;
  onFechar: () => void;
}) {
  const criar = useMutation(api.admin.formatos.criar);
  const atualizar = useMutation(api.admin.formatos.atualizar);
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [pesoKg, setPesoKg] = useState(String(inicial?.pesoKg ?? ""));
  const [pesoVariavel, setPesoVariavel] = useState(inicial?.pesoVariavel ?? false);
  const [estoqueMinimo, setEstoqueMinimo] = useState(String(inicial?.estoqueMinimo ?? 0));
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const novo = inicial === null;

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      const peso = pesoVariavel ? 0 : Number(pesoKg);
      const minimo = Number(estoqueMinimo) || 0;
      if (novo) {
        await criar({ produtoId, nome, pesoKg: peso, pesoVariavel, estoqueMinimo: minimo });
      } else {
        await atualizar({ id: inicial._id, nome, pesoKg: peso, pesoVariavel, estoqueMinimo: minimo, ativo });
      }
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={novo ? "Novo formato" : "Editar formato"} onFechar={onFechar}>
      <div className="flex flex-col gap-3">
        <Campo label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Saco 2kg" />
        <Campo
          label="Peso em kg"
          type="number"
          min={0}
          step="0.01"
          mono
          value={pesoVariavel ? "" : pesoKg}
          onChange={(e) => setPesoKg(e.target.value)}
          disabled={pesoVariavel}
          placeholder={pesoVariavel ? "digitado no lançamento" : "2"}
        />
        <Marca label="Peso variável (granel — kg digitado no lançamento)" marcado={pesoVariavel} onToggle={() => setPesoVariavel(!pesoVariavel)} />
        <Campo
          label={`Estoque mínimo em ${pesoVariavel ? "kg" : "pacotes"} (0 = sem alerta)`}
          type="number"
          min={0}
          step={pesoVariavel ? "0.01" : "1"}
          mono
          value={estoqueMinimo}
          onChange={(e) => setEstoqueMinimo(e.target.value)}
        />
        {!novo ? (
          <MarcaAtivo
            label="Ativo"
            avisoDesativar="Desativar este formato: ele deixa de aparecer para o colaborador nos lançamentos e contagens deste produto. O histórico é preservado."
            marcado={ativo}
            onToggle={() => setAtivo(!ativo)}
          />
        ) : null}
        {erro ? <Aviso>{erro}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Botao variante="neutro" onClick={onFechar}>Cancelar</Botao>
          <Botao onClick={salvar} disabled={salvando || nome.trim() === "" || (!pesoVariavel && Number(pesoKg) <= 0)}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
