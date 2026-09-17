import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Campo, CampoBusca, Etiqueta, LinhaMensagem, LinhaTabela, MarcaAtivo, Modal, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";
import { mascaraPlaca, placaCompleta } from "../../lib/mascaras.ts";

type Veiculo = {
  _id: Id<"veiculos">;
  placa: string;
  modelo?: string;
  motoristaPadrao?: string;
  ativo: boolean;
};

export function VeiculosPage() {
  const veiculos = useQuery(api.admin.veiculos.listar);
  const [editando, setEditando] = useState<Veiculo | "novo" | null>(null);
  const [busca, setBusca] = useState("");

  const buscaNorm = busca.trim().toLowerCase();
  const filtrados = (veiculos ?? []).filter(
    (v) =>
      v.placa.toLowerCase().includes(buscaNorm) ||
      (v.modelo ?? "").toLowerCase().includes(buscaNorm) ||
      (v.motoristaPadrao ?? "").toLowerCase().includes(buscaNorm),
  );

  return (
    <>
      <TituloPagina
        titulo="Veículos"
        subtitulo="Veículos próprios. Terceiros são informados em texto no lançamento."
        acao={<Botao onClick={() => setEditando("novo")}>Novo veículo</Botao>}
      />

      {veiculos !== undefined && veiculos.length > 6 ? (
        <CampoBusca value={busca} onChange={setBusca} placeholder="Buscar por placa, modelo ou motorista…" className="mb-3 max-w-xs" />
      ) : null}

      <Tabela colunas={["Placa", "Modelo", "Motorista padrão", "Status", { rotulo: "Ações", dir: true }]}>
        {veiculos === undefined ? (
          <LinhaMensagem colSpan={5}>Carregando…</LinhaMensagem>
        ) : veiculos.length === 0 ? (
          <LinhaMensagem colSpan={5}>Nenhum veículo cadastrado ainda. Use “Novo veículo”, no topo, para adicionar o primeiro.</LinhaMensagem>
        ) : filtrados.length === 0 ? (
          <LinhaMensagem colSpan={5}>Nada encontrado para "{busca}".</LinhaMensagem>
        ) : (
          filtrados.map((v) => (
            <LinhaTabela key={v._id}>
              <td className="px-3 py-2.5 font-mono font-medium text-texto">{v.placa}</td>
              <td className="px-3 py-2.5 text-texto-suave">{v.modelo || "—"}</td>
              <td className="px-3 py-2.5 text-texto-suave">{v.motoristaPadrao || "—"}</td>
              <td className="px-3 py-2.5"><Etiqueta ativo={v.ativo} /></td>
              <td className="px-3 py-2.5 text-right">
                <Botao variante="neutro" onClick={() => setEditando(v)}>Editar</Botao>
              </td>
            </LinhaTabela>
          ))
        )}
      </Tabela>

      {editando !== null ? (
        <FormVeiculo inicial={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} />
      ) : null}
    </>
  );
}

function FormVeiculo({ inicial, onFechar }: { inicial: Veiculo | null; onFechar: () => void }) {
  const criar = useMutation(api.admin.veiculos.criar);
  const atualizar = useMutation(api.admin.veiculos.atualizar);
  const [placa, setPlaca] = useState(mascaraPlaca(inicial?.placa ?? ""));
  const [modelo, setModelo] = useState(inicial?.modelo ?? "");
  const [motorista, setMotorista] = useState(inicial?.motoristaPadrao ?? "");
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const novo = inicial === null;

  async function salvar() {
    setErro("");
    setSalvando(true);
    try {
      const modeloOpt = modelo.trim() === "" ? undefined : modelo.trim();
      const motoristaOpt = motorista.trim() === "" ? undefined : motorista.trim();
      if (novo) {
        await criar({ placa: placa.trim(), modelo: modeloOpt, motoristaPadrao: motoristaOpt });
      } else {
        await atualizar({ id: inicial._id, placa: placa.trim(), modelo: modeloOpt, motoristaPadrao: motoristaOpt, ativo });
      }
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={novo ? "Novo veículo" : "Editar veículo"} onFechar={onFechar} fecharDesabilitado={salvando}>
      <div className="flex flex-col gap-3">
        <Campo label="Placa" mono value={placa} onChange={(e) => setPlaca(mascaraPlaca(e.target.value))} placeholder="ABC1D23" maxLength={7} />
        {placa !== "" && !placaCompleta(placa) ? (
          <p className="text-xs text-alerta">A placa deve ter 7 caracteres (ex.: ABC1D23 ou ABC1234).</p>
        ) : null}
        <Campo label="Modelo (opcional)" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Baú refrigerado" />
        <Campo label="Motorista padrão (opcional)" value={motorista} onChange={(e) => setMotorista(e.target.value)} placeholder="Nome do motorista" />
        {!novo ? (
          <MarcaAtivo
            label="Ativo"
            avisoDesativar="Desativar este veículo: ele deixa de aparecer na hora de lançar saídas. As saídas já registradas com ele são preservadas."
            marcado={ativo}
            onToggle={() => setAtivo(!ativo)}
          />
        ) : null}
        {erro ? <Aviso>{erro}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Botao variante="neutro" onClick={onFechar} disabled={salvando}>Cancelar</Botao>
          <Botao onClick={salvar} disabled={salvando || !placaCompleta(placa)}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
