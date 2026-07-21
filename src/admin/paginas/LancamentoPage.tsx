import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Campo, Cartao, Selecao, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";

/*
  Lançamento manual pelo Admin (RF63). Mesmas validações do colaborador: saldo,
  idempotência, sinal/pesoKg no servidor. A chave de idempotência é gerada por
  lançamento e renovada após cada sucesso, para evitar duplicação por duplo-clique.
*/
type Tipo = "producao" | "venda" | "patrocinio" | "perda";
type MotivoPerda = "derreteu" | "danificado" | "descarte" | "outro";

const rotuloMotivo: Record<MotivoPerda, string> = {
  derreteu: "Derreteu",
  danificado: "Danificado",
  descarte: "Descarte",
  outro: "Outro",
};

export function LancamentoPage() {
  const produtos = useQuery(api.admin.lancamentos.produtosParaLancamento);
  const veiculos = useQuery(api.admin.veiculos.listar);
  const lancarProducao = useMutation(api.admin.lancamentos.lancarProducao);
  const lancarSaida = useMutation(api.admin.lancamentos.lancarSaida);

  const [tipo, setTipo] = useState<Tipo>("producao");
  const [produtoId, setProdutoId] = useState<Id<"produtos"> | "">("");
  const [formatoId, setFormatoId] = useState<Id<"formatos"> | "">("");
  const [valor, setValor] = useState("");
  const [cliente, setCliente] = useState("");
  const [veiculoSel, setVeiculoSel] = useState("");
  const [veiculoTerceiro, setVeiculoTerceiro] = useState("");
  const [motorista, setMotorista] = useState("");
  const [motivo, setMotivo] = useState<MotivoPerda | "">("");
  const [observacao, setObservacao] = useState("");
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);

  const produto = produtos?.find((p) => p._id === produtoId);
  const formato = produto?.formatos.find((f) => f._id === formatoId);

  // Ao trocar de produto, limpa o formato.
  useEffect(() => { setFormatoId(""); }, [produtoId]);

  const pesoPrevisto = useMemo(() => {
    if (!formato) return null;
    const n = Number(valor) || 0;
    return formato.pesoVariavel ? n : n * formato.pesoKg;
  }, [formato, valor]);

  const ativosVeiculos = (veiculos ?? []).filter((v) => v.ativo);

  function escolherVeiculo(sel: string) {
    setVeiculoSel(sel);
    const v = ativosVeiculos.find((x) => x._id === sel);
    if (v?.motoristaPadrao && motorista === "") setMotorista(v.motoristaPadrao);
  }

  const num = Number(valor);
  const valorValido = formato ? (formato.pesoVariavel ? num > 0 : Number.isInteger(num) && num > 0) : false;
  const contextoValido =
    tipo === "producao"
      ? true
      : tipo === "perda"
        ? motivo !== "" && (motivo !== "outro" || observacao.trim() !== "")
        : cliente.trim() !== "" && (veiculoSel !== "terceiro" || veiculoTerceiro.trim() !== "");
  const podeEnviar = !!produto && !!formato && valorValido && contextoValido && !enviando;

  async function confirmar() {
    if (!produto || !formato) return;
    setErro("");
    setMsg("");
    setEnviando(true);
    try {
      const comum = {
        chaveIdempotencia: chave,
        produtoId: produto._id,
        formatoId: formato._id,
        quantidade: formato.pesoVariavel ? undefined : num,
        pesoKgVariavel: formato.pesoVariavel ? num : undefined,
      } as const;

      if (tipo === "producao") {
        await lancarProducao(comum);
      } else if (tipo === "perda") {
        await lancarSaida({
          ...comum,
          tipo: "perda",
          motivoPerda: (motivo || undefined) as MotivoPerda | undefined,
          observacao: observacao.trim() || undefined,
        });
      } else {
        await lancarSaida({
          ...comum,
          tipo,
          clienteNome: cliente.trim(),
          veiculoId: veiculoSel && veiculoSel !== "terceiro" ? (veiculoSel as Id<"veiculos">) : undefined,
          veiculoTerceiro: veiculoSel === "terceiro" ? veiculoTerceiro.trim() || undefined : undefined,
          motorista: motorista.trim() || undefined,
        });
      }
      setMsg("Lançamento registrado.");
      // Renova a chave e limpa quantidade para o próximo lançamento.
      setChave(crypto.randomUUID());
      setValor("");
      setCliente("");
      setVeiculoSel("");
      setVeiculoTerceiro("");
      setMotorista("");
      setMotivo("");
      setObservacao("");
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <TituloPagina titulo="Lançar movimentação" subtitulo="Lançamento manual do Admin, com as mesmas regras do colaborador." />

      <Cartao className="max-w-xl p-4">
        <div className="flex flex-col gap-4">
          <Selecao label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
            <option value="producao">Produção (entrada)</option>
            <option value="venda">Venda (saída)</option>
            <option value="patrocinio">Patrocínio (saída)</option>
            <option value="perda">Perda (saída)</option>
          </Selecao>

          <div className="grid grid-cols-2 gap-3">
            <Selecao label="Produto" value={produtoId} onChange={(e) => setProdutoId(e.target.value as Id<"produtos">)}>
              <option value="">— escolha —</option>
              {(produtos ?? []).map((p) => (
                <option key={p._id} value={p._id}>{p.nome} · {p.camaraNome}</option>
              ))}
            </Selecao>
            <Selecao label="Formato" value={formatoId} onChange={(e) => setFormatoId(e.target.value as Id<"formatos">)} disabled={!produto}>
              <option value="">— escolha —</option>
              {(produto?.formatos ?? []).map((f) => (
                <option key={f._id} value={f._id}>{f.nome}{f.pesoVariavel ? " (kg)" : ` · ${f.pesoKg}kg`}</option>
              ))}
            </Selecao>
          </div>

          <div className="flex items-end gap-3">
            <Campo
              label={formato?.pesoVariavel ? "Peso (kg)" : "Quantidade (pacotes)"}
              type="number"
              min={0}
              step={formato?.pesoVariavel ? "0.01" : "1"}
              mono
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              disabled={!formato}
              className="w-40"
            />
            {pesoPrevisto !== null && !formato?.pesoVariavel ? (
              <span className="pb-1.5 font-mono text-sm text-texto-suave">= {pesoPrevisto} kg</span>
            ) : null}
          </div>

          {(tipo === "venda" || tipo === "patrocinio") ? (
            <div className="flex flex-col gap-3">
              <Campo label="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nome do cliente" />
              <Selecao label="Veículo" value={veiculoSel} onChange={(e) => escolherVeiculo(e.target.value)}>
                <option value="">— sem veículo —</option>
                {ativosVeiculos.map((v) => (
                  <option key={v._id} value={v._id}>{v.placa}{v.modelo ? ` · ${v.modelo}` : ""}</option>
                ))}
                <option value="terceiro">Terceiro (digitar)</option>
              </Selecao>
              {veiculoSel === "terceiro" ? (
                <Campo label="Veículo terceiro" value={veiculoTerceiro} onChange={(e) => setVeiculoTerceiro(e.target.value)} placeholder="Placa / descrição" />
              ) : null}
              <Campo label="Motorista (opcional)" value={motorista} onChange={(e) => setMotorista(e.target.value)} />
            </div>
          ) : null}

          {tipo === "perda" ? (
            <div className="flex flex-col gap-3">
              <Selecao label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoPerda)}>
                <option value="">— escolha —</option>
                {(Object.keys(rotuloMotivo) as MotivoPerda[]).map((m) => (
                  <option key={m} value={m}>{rotuloMotivo[m]}</option>
                ))}
              </Selecao>
              {motivo === "outro" ? (
                <Campo label="Descreva o motivo (obrigatório)" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
              ) : null}
            </div>
          ) : null}

          {erro ? <Aviso>{erro}</Aviso> : null}
          {msg ? <Aviso tom="info">{msg}</Aviso> : null}

          <div className="flex justify-end">
            <Botao onClick={confirmar} disabled={!podeEnviar}>
              {enviando ? "Enviando…" : "Lançar"}
            </Botao>
          </div>
        </div>
      </Cartao>
    </>
  );
}
