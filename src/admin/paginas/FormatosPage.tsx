import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Campo, CampoBusca, Etiqueta, LinhaMensagem, LinhaTabela, Marca, MarcaAtivo, Modal, Selecao, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";
import { formatarContagem, formatarPeso, nomeUnidade, rotuloFormato } from "../../lib/formato.ts";

type Formato = {
  _id: Id<"formatos">;
  nome: string;
  pesoKg: number;
  pesoVariavel: boolean;
  unidadesPorPacote?: number;
  unidadeContagem?: "pacote" | "unidade";
  estoqueMinimo?: number;
  ativo: boolean;
};

export function FormatosPage() {
  const { produtoId } = useParams<{ produtoId: string }>();
  const id = produtoId as Id<"produtos">;
  const produtos = useQuery(api.admin.produtos.listar);
  const formatos = useQuery(api.admin.formatos.listarPorProduto, { produtoId: id });
  const [editando, setEditando] = useState<Formato | "novo" | null>(null);
  const [busca, setBusca] = useState("");

  const produto = produtos?.find((p) => p._id === id);
  const buscaNorm = busca.trim().toLowerCase();
  const filtrados = (formatos ?? []).filter((f) => rotuloFormato(f).toLowerCase().includes(buscaNorm));

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

      {formatos !== undefined && formatos.length > 6 ? (
        <CampoBusca value={busca} onChange={setBusca} placeholder="Buscar por formato…" className="mb-3 max-w-xs" />
      ) : null}

      <Tabela
        colunas={[
          "Formato",
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
        ) : filtrados.length === 0 ? (
          <LinhaMensagem colSpan={5}>Nada encontrado para "{busca}".</LinhaMensagem>
        ) : (
          filtrados.map((f) => (
            <LinhaTabela key={f._id}>
              {/* Rótulo canônico (tarefa 2 do adendo) — o mesmo texto que o
                  colaborador vê no PWA e o cliente vê no comprovante. */}
              <td className="px-3 py-2.5 font-medium text-texto">{rotuloFormato(f)}</td>
              <td className="px-3 py-2.5 text-right font-numero tabular-nums text-texto">
                {f.pesoVariavel ? <span className="text-texto-suave">variável</span> : formatarPeso(f.pesoKg)}
              </td>
              <td className="px-3 py-2.5 text-right font-numero tabular-nums text-texto-suave">
                {f.estoqueMinimo
                  ? f.pesoVariavel
                    ? formatarPeso(f.estoqueMinimo)
                    : formatarContagem(f.estoqueMinimo, f)
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
  const [unidadeContagem, setUnidadeContagem] = useState<"pacote" | "unidade">(inicial?.unidadeContagem ?? "pacote");
  const [unidadesPorPacote, setUnidadesPorPacote] = useState(String(inicial?.unidadesPorPacote ?? ""));
  const [estoqueMinimo, setEstoqueMinimo] = useState(String(inicial?.estoqueMinimo ?? 0));
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const novo = inicial === null;
  const ehUnidade = unidadeContagem === "unidade";

  // Pré-visualização do rótulo canônico (tarefa 2) — o admin vê, ao digitar,
  // exatamente o texto que vai aparecer pro colaborador e no comprovante.
  const previa = rotuloFormato({
    nome: nome.trim() || "—",
    pesoKg: Number(pesoKg) || 0,
    pesoVariavel,
    unidadesPorPacote: ehUnidade ? undefined : Number(unidadesPorPacote) || undefined,
  });

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      const peso = pesoVariavel ? 0 : Number(pesoKg);
      const minimo = Number(estoqueMinimo) || 0;
      const unidades = pesoVariavel || ehUnidade || unidadesPorPacote.trim() === "" ? undefined : Number(unidadesPorPacote);
      if (novo) {
        // unidadeContagem é fixada na criação e nunca muda depois — não existe
        // no atualizar de propósito (ver comentário em convex/schema.ts). Peso
        // variável não tem "unidade de contagem" (quantidade é sempre 1).
        await criar({
          produtoId,
          nome,
          pesoKg: peso,
          pesoVariavel,
          unidadesPorPacote: unidades,
          unidadeContagem: pesoVariavel ? undefined : unidadeContagem,
          estoqueMinimo: minimo,
        });
      } else {
        await atualizar({ id: inicial._id, nome, pesoKg: peso, pesoVariavel, unidadesPorPacote: unidades, estoqueMinimo: minimo, ativo });
      }
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={novo ? "Novo formato" : "Editar formato"} onFechar={onFechar} fecharDesabilitado={salvando}>
      <div className="flex flex-col gap-3">
        <Campo
          label="Nome base (sem peso nem quantidade)"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Pacote"
        />
        {!pesoVariavel ? (
          novo ? (
            <Selecao
              label="Como contar"
              value={unidadeContagem}
              onChange={(e) => setUnidadeContagem(e.target.value as "pacote" | "unidade")}
            >
              <option value="pacote">Pacote (embalagem com várias unidades)</option>
              <option value="unidade">Unidade (cada peça é um item)</option>
            </Selecao>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-texto-suave">Como contar (fixo)</span>
              <div className="rounded border border-borda bg-fundo px-2 py-1.5 text-sm text-texto-suave">
                {ehUnidade ? "Unidade" : "Pacote"}
              </div>
            </div>
          )
        ) : null}
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
        {!pesoVariavel ? (
          <p className="-mt-2 text-xs text-texto-fraco">Peso de 1 {ehUnidade ? "unidade" : "pacote"}, em kg.</p>
        ) : null}
        <Marca label="Peso variável (granel — kg digitado no lançamento)" marcado={pesoVariavel} onToggle={() => setPesoVariavel(!pesoVariavel)} />
        {!pesoVariavel && !ehUnidade ? (
          <Campo
            label="Unidades por pacote (opcional — ex.: pedras)"
            type="number"
            min={1}
            step="1"
            mono
            value={unidadesPorPacote}
            onChange={(e) => setUnidadesPorPacote(e.target.value)}
            placeholder="30"
          />
        ) : null}
        <p className="text-xs text-texto-suave">
          Rótulo que vai aparecer pro colaborador, no comprovante e no histórico:{" "}
          <span className="font-medium text-texto">{previa}</span>
        </p>
        <Campo
          label={`Estoque mínimo em ${pesoVariavel ? "kg" : nomeUnidade({ pesoVariavel, unidadeContagem }, 2)} (0 = sem alerta)`}
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
          <Botao variante="neutro" onClick={onFechar} disabled={salvando}>Cancelar</Botao>
          <Botao onClick={salvar} disabled={salvando || nome.trim() === "" || (!pesoVariavel && Number(pesoKg) <= 0)}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
