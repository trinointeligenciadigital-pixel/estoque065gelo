import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, BotaoLink, Campo, CampoBusca, Etiqueta, LinhaMensagem, LinhaTabela, MarcaAtivo, Modal, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";

type Camara = { _id: Id<"camaras">; nome: string; qrToken: string; ativo: boolean };

export function CamarasPage() {
  const camaras = useQuery(api.admin.camaras.listar);
  const [editando, setEditando] = useState<Camara | "nova" | null>(null);
  const [busca, setBusca] = useState("");

  const buscaNorm = busca.trim().toLowerCase();
  const filtradas = (camaras ?? []).filter((c) => c.nome.toLowerCase().includes(buscaNorm));

  return (
    <>
      <TituloPagina
        titulo="Câmaras"
        subtitulo="Cada câmara tem um QR fixo na porta. Reimprimir não muda o QR."
        acao={<Botao onClick={() => setEditando("nova")}>Nova câmara</Botao>}
      />

      {camaras !== undefined && camaras.length > 6 ? (
        <CampoBusca value={busca} onChange={setBusca} placeholder="Buscar por nome…" className="mb-3 max-w-xs" />
      ) : null}

      <Tabela colunas={["Nome", "Status", { rotulo: "Ações", dir: true }]}>
        {camaras === undefined ? (
          <LinhaMensagem colSpan={3}>Carregando…</LinhaMensagem>
        ) : camaras.length === 0 ? (
          <LinhaMensagem colSpan={3}>Nenhuma câmara cadastrada ainda. Use “Nova câmara”, no topo, para adicionar a primeira.</LinhaMensagem>
        ) : filtradas.length === 0 ? (
          <LinhaMensagem colSpan={3}>Nada encontrado para "{busca}".</LinhaMensagem>
        ) : (
          filtradas.map((c) => (
            <LinhaTabela key={c._id}>
              <td className="px-3 py-2.5 font-medium text-texto">{c.nome}</td>
              <td className="px-3 py-2.5"><Etiqueta ativo={c.ativo} /></td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex justify-end gap-2">
                  <BotaoLink to={`/camaras/${c._id}/qr`}>Ver QR</BotaoLink>
                  <Botao variante="neutro" onClick={() => setEditando(c)}>Editar</Botao>
                </div>
              </td>
            </LinhaTabela>
          ))
        )}
      </Tabela>

      {editando !== null ? (
        <FormCamara
          inicial={editando === "nova" ? null : editando}
          onFechar={() => setEditando(null)}
        />
      ) : null}
    </>
  );
}

function FormCamara({ inicial, onFechar }: { inicial: Camara | null; onFechar: () => void }) {
  const criar = useMutation(api.admin.camaras.criar);
  const atualizar = useMutation(api.admin.camaras.atualizar);
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      if (inicial === null) {
        await criar({ nome });
      } else {
        await atualizar({ id: inicial._id, nome, ativo });
      }
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={inicial === null ? "Nova câmara" : "Editar câmara"} onFechar={onFechar} fecharDesabilitado={salvando}>
      <div className="flex flex-col gap-3">
        <Campo label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Câmara Saborizado" />
        {inicial !== null ? (
          <MarcaAtivo
            label="Ativa"
            avisoDesativar="Desativar esta câmara: ela e seus produtos deixam de aparecer para o colaborador, e o acesso pelo QR dela para de funcionar. O histórico é preservado."
            marcado={ativo}
            onToggle={() => setAtivo(!ativo)}
          />
        ) : null}
        {erro ? <Aviso>{erro}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Botao variante="neutro" onClick={onFechar} disabled={salvando}>Cancelar</Botao>
          <Botao onClick={salvar} disabled={salvando || nome.trim() === ""}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
