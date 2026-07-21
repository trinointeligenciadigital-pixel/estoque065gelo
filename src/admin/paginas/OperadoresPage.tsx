import { useMemo, useState, type ReactNode } from "react";
import { Check, MessageCircle } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Campo, Etiqueta, LinhaMensagem, LinhaTabela, Marca, MarcaAtivo, Modal, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";

type Camara = { _id: Id<"camaras">; nome: string; ativo: boolean };
type Operador = {
  _id: Id<"operadores">;
  nome: string;
  whatsapp?: string;
  camarasPermitidas: Id<"camaras">[];
  podeLancarProducao: boolean;
  podeLancarSaida: boolean;
  podeContar: boolean;
  ativo: boolean;
  temPin: boolean;
};

type PinGerado = { pin: string; nome: string; whatsapp: string };

// Normaliza o número para o formato que o wa.me espera (só dígitos). Um número
// local do Brasil (10 ou 11 dígitos) recebe o DDI 55 automaticamente.
function digitosWhats(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d === "") return "";
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

export function OperadoresPage() {
  const operadores = useQuery(api.admin.operadores.listar);
  const camaras = useQuery(api.admin.camaras.listar);
  const [editando, setEditando] = useState<Operador | "novo" | null>(null);
  const [pinGerado, setPinGerado] = useState<PinGerado | null>(null);

  const nomeCamara = useMemo(() => {
    const m = new Map<string, string>();
    (camaras ?? []).forEach((c) => m.set(c._id, c.nome));
    return m;
  }, [camaras]);

  const carregando = operadores === undefined || camaras === undefined;

  return (
    <>
      <TituloPagina
        titulo="Colaboradores"
        subtitulo="PIN individual. Gerar um novo PIN derruba as sessões ativas na hora."
        acao={<Botao onClick={() => setEditando("novo")}>Novo colaborador</Botao>}
      />

      <Tabela colunas={["Nome", "Câmaras", "Permissões", "PIN", "Status", { rotulo: "Ações", dir: true }]}>
        {carregando ? (
          <LinhaMensagem colSpan={6}>Carregando…</LinhaMensagem>
        ) : operadores.length === 0 ? (
          <LinhaMensagem colSpan={6}>Nenhum colaborador cadastrado ainda. Use “Novo colaborador”, no topo, para adicionar o primeiro.</LinhaMensagem>
        ) : (
          operadores.map((o) => (
            <LinhaTabela key={o._id} className="align-top">
              <td className="px-3 py-2.5 font-medium text-texto">{o.nome}</td>
              <td className="px-3 py-2.5 text-texto-suave">
                {o.camarasPermitidas.map((id) => nomeCamara.get(id) ?? "—").join(", ") || "—"}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {o.podeLancarProducao ? <Tag>Produção</Tag> : null}
                  {o.podeLancarSaida ? <Tag>Saída</Tag> : null}
                  {o.podeContar ? <Tag>Contagem</Tag> : null}
                </div>
              </td>
              <td className="px-3 py-2.5 text-texto-suave">{o.temPin ? "definido" : "sem PIN"}</td>
              <td className="px-3 py-2.5"><Etiqueta ativo={o.ativo} /></td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex justify-end gap-2">
                  <GerarPin operadorId={o._id} temPin={o.temPin} onGerado={setPinGerado} />
                  <Botao variante="neutro" onClick={() => setEditando(o)}>Editar</Botao>
                </div>
              </td>
            </LinhaTabela>
          ))
        )}
      </Tabela>

      {editando !== null && camaras !== undefined ? (
        <FormOperador
          inicial={editando === "novo" ? null : editando}
          camaras={camaras}
          onFechar={() => setEditando(null)}
        />
      ) : null}

      {pinGerado !== null ? (
        <ModalPin dados={pinGerado} onFechar={() => setPinGerado(null)} />
      ) : null}
    </>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded bg-acento/10 px-1.5 py-0.5 text-xs text-acento">{children}</span>;
}

function GerarPin({
  operadorId,
  temPin,
  onGerado,
}: {
  operadorId: Id<"operadores">;
  temPin: boolean;
  onGerado: (d: PinGerado) => void;
}) {
  const gerar = useMutation(api.admin.operadores.gerarPinOperador);
  const [gerando, setGerando] = useState(false);

  async function acao() {
    setGerando(true);
    try {
      const r = await gerar({ id: operadorId });
      onGerado(r);
    } catch {
      // erro silencioso aqui; o fluxo normal não falha. Reabrir tenta de novo.
    } finally {
      setGerando(false);
    }
  }

  return (
    <Botao variante="neutro" onClick={acao} disabled={gerando}>
      {gerando ? "Gerando…" : temPin ? "Novo PIN" : "Gerar PIN"}
    </Botao>
  );
}

function ModalPin({ dados, onFechar }: { dados: PinGerado; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const msg = `Olá, ${dados.nome}! Seu acesso ao Estoque 065. PIN: ${dados.pin}. Escaneie o QR na porta da câmara e digite este PIN. Não compartilhe.`;

  // Se há número cadastrado, o WhatsApp já abre na conversa dele; senão, abre
  // para o Admin escolher o contato.
  const numero = digitosWhats(dados.whatsapp);
  const link = numero
    ? `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(msg);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <Modal titulo="PIN gerado" onFechar={onFechar}>
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-texto-suave">
          Anote ou envie agora. Este PIN <strong>não será mostrado de novo</strong> —
          se perder, gere outro.
        </p>
        <div className="rounded-lg border border-borda bg-fundo px-8 py-4">
          <span className="font-mono text-3xl font-semibold tracking-widest text-texto">{dados.pin}</span>
        </div>
        <p className="text-xs text-texto-suave">
          Colaborador: {dados.nome}
          {dados.whatsapp ? ` · ${dados.whatsapp}` : " · sem número cadastrado"}
        </p>

        <div className="flex w-full flex-col gap-2">
          <Botao className="w-full" onClick={() => window.open(link, "_blank", "noopener")}>
            <MessageCircle size={16} aria-hidden="true" />
            {numero ? "Enviar no WhatsApp do colaborador" : "Enviar por WhatsApp"}
          </Botao>
          <Botao variante="neutro" onClick={copiar} className="w-full">
            {copiado ? (
              <>
                <Check size={16} aria-hidden="true" /> Mensagem copiada
              </>
            ) : (
              "Copiar mensagem"
            )}
          </Botao>
          <Botao variante="neutro" onClick={onFechar} className="w-full">Fechar</Botao>
        </div>
      </div>
    </Modal>
  );
}

function FormOperador({
  inicial,
  camaras,
  onFechar,
}: {
  inicial: Operador | null;
  camaras: Camara[];
  onFechar: () => void;
}) {
  const criar = useMutation(api.admin.operadores.criar);
  const atualizar = useMutation(api.admin.operadores.atualizar);
  const ativas = camaras.filter((c) => c.ativo || (inicial?.camarasPermitidas.includes(c._id) ?? false));

  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [whatsapp, setWhatsapp] = useState(inicial?.whatsapp ?? "");
  const [permitidas, setPermitidas] = useState<Id<"camaras">[]>(inicial?.camarasPermitidas ?? []);
  const [producao, setProducao] = useState(inicial?.podeLancarProducao ?? false);
  const [saida, setSaida] = useState(inicial?.podeLancarSaida ?? false);
  const [contar, setContar] = useState(inicial?.podeContar ?? false);
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const novo = inicial === null;

  function alternarCamara(id: Id<"camaras">) {
    setPermitidas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function salvar() {
    setErro("");
    setSalvando(true);
    const whatsappOpt = whatsapp.trim() === "" ? undefined : whatsapp.trim();
    try {
      if (novo) {
        await criar({
          nome,
          whatsapp: whatsappOpt,
          camarasPermitidas: permitidas,
          podeLancarProducao: producao,
          podeLancarSaida: saida,
          podeContar: contar,
        });
      } else {
        await atualizar({
          id: inicial._id,
          nome,
          whatsapp: whatsappOpt,
          camarasPermitidas: permitidas,
          podeLancarProducao: producao,
          podeLancarSaida: saida,
          podeContar: contar,
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
    <Modal titulo={novo ? "Novo colaborador" : "Editar colaborador"} onFechar={onFechar}>
      <div className="flex flex-col gap-4">
        <Campo label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do colaborador" />
        <Campo
          label="WhatsApp (opcional — para enviar o PIN)"
          mono
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="(65) 99999-9999"
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-texto-suave">Câmaras permitidas</span>
          {ativas.length === 0 ? (
            <p className="text-sm text-texto-suave">Cadastre uma câmara primeiro.</p>
          ) : (
            ativas.map((c) => (
              <Marca key={c._id} label={c.nome} marcado={permitidas.includes(c._id)} onToggle={() => alternarCamara(c._id)} />
            ))
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-texto-suave">Permissões</span>
          <Marca label="Lançar produção" marcado={producao} onToggle={() => setProducao(!producao)} />
          <Marca label="Lançar saída (venda, patrocínio, perda)" marcado={saida} onToggle={() => setSaida(!saida)} />
          <Marca label="Fazer contagem" marcado={contar} onToggle={() => setContar(!contar)} />
        </div>

        {!novo ? (
          <MarcaAtivo
            label="Ativo"
            avisoDesativar="Desativar este colaborador: as sessões abertas dele caem na hora e o PIN deixa de dar acesso. O histórico é preservado."
            marcado={ativo}
            onToggle={() => setAtivo(!ativo)}
          />
        ) : (
          <p className="text-xs text-texto-suave">O PIN é gerado depois, na lista, com o botão “Gerar PIN”.</p>
        )}

        {erro ? <Aviso>{erro}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Botao variante="neutro" onClick={onFechar}>Cancelar</Botao>
          <Botao onClick={salvar} disabled={salvando || nome.trim() === "" || permitidas.length === 0}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
