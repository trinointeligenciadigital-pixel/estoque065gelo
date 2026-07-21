import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { mensagemErro } from "../lib/erros.ts";
import { AvisoOperador, BotaoGrande, CampoQuantidade, kgDe, OpcaoGrande, ResumoLancamento, Tela } from "./ui.tsx";
import type { FormatoGrid, LinhaResumo, ProdutoGrid } from "./ui.tsx";
import { ListaProdutos, ListaFormatos } from "./ProducaoFlow.tsx";
import { RetornoFlow } from "./RetornoFlow.tsx";
import { Check, MessageCircle } from "lucide-react";
import { dataHora } from "../lib/data.ts";
import { linhasComprovante, linkWhatsappComprovante, textoComprovante, type DadosComprovante } from "../lib/comprovante.ts";

/*
  Lançar saída (RF28–RF35) e ponto de entrada do retorno (RF38–RF41). Tipos:
  venda, patrocínio, perda — e "retorno de patrocínio", que abre o fluxo próprio.
  Saldo insuficiente no formato é bloqueado pelo servidor com mensagem clara.
*/
type Tipo = "venda" | "patrocinio" | "perda";
type Passo = "produto" | "formato" | "quantidade" | "contexto" | "revisar" | "sucesso";
type MotivoPerda = "derreteu" | "danificado" | "descarte" | "outro";

export function SaidaFlow({
  token,
  camaraNome,
  operadorNome,
  onVoltar,
}: {
  token: string;
  camaraNome: string;
  operadorNome: string;
  onVoltar: () => void;
}) {
  const [modo, setModo] = useState<Tipo | "retorno" | null>(null);

  if (modo === "retorno") {
    return <RetornoFlow token={token} camaraNome={camaraNome} onVoltar={() => setModo(null)} />;
  }
  if (modo === null) {
    return (
      <Tela titulo="Saída / retorno" camaraNome={camaraNome} onVoltar={onVoltar}>
        <div className="flex flex-col gap-3">
          <OpcaoGrande titulo="Venda" onClick={() => setModo("venda")} />
          <OpcaoGrande titulo="Patrocínio" onClick={() => setModo("patrocinio")} />
          <OpcaoGrande titulo="Perda" onClick={() => setModo("perda")} />
          <OpcaoGrande titulo="Retorno de patrocínio" onClick={() => setModo("retorno")} />
        </div>
      </Tela>
    );
  }

  return (
    <SaidaTipo
      tipo={modo}
      token={token}
      camaraNome={camaraNome}
      operadorNome={operadorNome}
      onVoltar={() => setModo(null)}
    />
  );
}

function SaidaTipo({
  tipo,
  token,
  camaraNome,
  operadorNome,
  onVoltar,
}: {
  tipo: Tipo;
  token: string;
  camaraNome: string;
  operadorNome: string;
  onVoltar: () => void;
}) {
  const produtos = useQuery(api.operador.consulta.gridProdutos, { token });
  const veiculos = useQuery(api.operador.consulta.veiculos, { token });
  const lancar = useMutation(api.operador.lancamentos.lancarSaida);

  const rotulo = tipo === "venda" ? "Venda" : tipo === "patrocinio" ? "Patrocínio" : "Perda";

  const [passo, setPasso] = useState<Passo>("produto");
  const [produto, setProduto] = useState<ProdutoGrid | null>(null);
  const [formato, setFormato] = useState<FormatoGrid | null>(null);
  const [valor, setValor] = useState("");
  const [chave, setChave] = useState("");

  // Contexto venda/patrocínio
  const [cliente, setCliente] = useState("");
  const [veiculoSel, setVeiculoSel] = useState<string>(""); // "" | id | "terceiro"
  const [veiculoTerceiro, setVeiculoTerceiro] = useState("");
  const [motorista, setMotorista] = useState("");
  // Contexto perda
  const [motivo, setMotivo] = useState<MotivoPerda | "">("");
  const [observacao, setObservacao] = useState("");

  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [quandoMs, setQuandoMs] = useState(0); // hora do registro, p/ o comprovante

  function escolherFormato(f: FormatoGrid) {
    setFormato(f);
    setValor("");
    setChave(crypto.randomUUID());
    setPasso("quantidade");
  }

  function escolherVeiculo(sel: string) {
    setVeiculoSel(sel);
    const v = veiculos?.find((x) => x._id === sel);
    if (v?.motoristaPadrao && motorista === "") setMotorista(v.motoristaPadrao);
  }

  function rotularVeiculo(): string {
    if (veiculoSel === "") return "sem veículo";
    if (veiculoSel === "terceiro") return veiculoTerceiro.trim() || "terceiro";
    const v = veiculos?.find((x) => x._id === veiculoSel);
    return v ? `${v.placa}${v.modelo ? ` · ${v.modelo}` : ""}` : "—";
  }

  async function confirmar() {
    if (!produto || !formato) return;
    setErro("");
    setEnviando(true);
    try {
      const num = Number(valor);
      const comum = {
        token,
        chaveIdempotencia: chave,
        tipo,
        produtoId: produto._id,
        formatoId: formato._id,
        quantidade: formato.pesoVariavel ? undefined : num,
        pesoKgVariavel: formato.pesoVariavel ? num : undefined,
      } as const;

      if (tipo === "perda") {
        await lancar({
          ...comum,
          motivoPerda: (motivo || undefined) as MotivoPerda | undefined,
          observacao: observacao.trim() || undefined,
        });
      } else {
        await lancar({
          ...comum,
          clienteNome: cliente.trim(),
          veiculoId:
            veiculoSel && veiculoSel !== "terceiro" ? (veiculoSel as Id<"veiculos">) : undefined,
          veiculoTerceiro: veiculoSel === "terceiro" ? veiculoTerceiro.trim() || undefined : undefined,
          motorista: motorista.trim() || undefined,
        });
      }
      setQuandoMs(Date.now());
      setPasso("sucesso");
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (passo === "sucesso") {
    const num = Number(valor);
    const pesoKg = produto && formato ? kgDe(formato, num, num) : 0;
    const quantidadeLabel = formato?.pesoVariavel ? "" : `${num} ${num === 1 ? "pacote" : "pacotes"}`;

    return (
      <Tela titulo={`${rotulo} lançada`} camaraNome={camaraNome} aoVoltarHardware={onVoltar}>
        <AvisoOperador tom="ok">Registrado com sucesso.</AvisoOperador>
        {produto && formato ? (
          tipo === "perda" ? (
            <div className="mt-4">
              <ResumoLancamento
                pesoKg={pesoKg}
                linhas={[
                  { rotulo: "Produto", valor: produto.nome },
                  { rotulo: "Formato", valor: formato.nome },
                  ...(quantidadeLabel ? [{ rotulo: "Quantidade", valor: quantidadeLabel, mono: true }] : []),
                  { rotulo: "Motivo", valor: rotuloMotivo(motivo as MotivoPerda) },
                ]}
              />
            </div>
          ) : (
            <div className="mt-4">
              <ComprovanteSaida
                dados={{
                  rotulo,
                  quandoMs,
                  cliente: cliente.trim(),
                  produtoNome: produto.nome,
                  formatoNome: formato.nome,
                  quantidadeLabel,
                  pesoKg,
                  veiculoLabel: rotularVeiculo(),
                  motorista: motorista.trim(),
                  camaraNome,
                  operadorNome,
                  protocolo: chave.slice(0, 8).toUpperCase() || "—",
                }}
              />
            </div>
          )
        ) : null}
        <div className="mt-6">
          <BotaoGrande variante="neutro" onClick={onVoltar}>Voltar</BotaoGrande>
        </div>
      </Tela>
    );
  }

  if (passo === "produto") {
    return (
      <Tela titulo={`${rotulo} — produto`} camaraNome={camaraNome} onVoltar={onVoltar} etapa={1} totalEtapas={5}>
        <ListaProdutos produtos={produtos} onEscolher={(p) => { setProduto(p); setPasso("formato"); }} />
      </Tela>
    );
  }

  if (passo === "formato" && produto) {
    return (
      <Tela titulo={`${rotulo} — formato`} camaraNome={produto.nome} onVoltar={() => setPasso("produto")} etapa={2} totalEtapas={5}>
        <ListaFormatos produto={produto} onEscolher={escolherFormato} />
      </Tela>
    );
  }

  if (passo === "quantidade" && produto && formato) {
    const num = Number(valor);
    const valido = formato.pesoVariavel ? num > 0 : Number.isInteger(num) && num > 0;
    return (
      <Tela
        titulo={`${rotulo} — quantidade`}
        camaraNome={`${produto.nome} · ${formato.nome}`}
        onVoltar={() => setPasso("formato")}
        etapa={3}
        totalEtapas={5}
        rodape={
          <BotaoGrande variante="saida" onClick={() => setPasso("contexto")} disabled={!valido}>
            Continuar
          </BotaoGrande>
        }
      >
        <CampoQuantidade formato={formato} valor={valor} onChange={setValor} />
      </Tela>
    );
  }

  if (passo === "contexto") {
    const podeConfirmar =
      tipo === "perda"
        ? motivo !== "" && (motivo !== "outro" || observacao.trim() !== "")
        : cliente.trim() !== "" && (veiculoSel !== "terceiro" || veiculoTerceiro.trim() !== "");

    return (
      <Tela
        titulo={`${rotulo} — detalhes`}
        camaraNome={camaraNome}
        onVoltar={() => setPasso("quantidade")}
        etapa={4}
        totalEtapas={5}
        rodape={
          <BotaoGrande variante="saida" onClick={() => setPasso("revisar")} disabled={!podeConfirmar}>
            Continuar
          </BotaoGrande>
        }
      >
        {tipo === "perda" ? (
          <div className="flex flex-col gap-3">
            <p className="text-base font-medium text-texto">Motivo da perda</p>
            {(["derreteu", "danificado", "descarte", "outro"] as MotivoPerda[]).map((m) => (
              <OpcaoGrande
                key={m}
                titulo={rotuloMotivo(m)}
                selecionado={motivo === m}
                onClick={() => setMotivo(m)}
              />
            ))}
            {motivo === "outro" ? (
              <Texto label="Descreva o motivo (obrigatório)" value={observacao} onChange={setObservacao} />
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Texto label="Cliente" value={cliente} onChange={setCliente} placeholder="Nome do cliente" />

            <div className="flex flex-col gap-1">
              <label className="text-base font-medium text-texto">Veículo</label>
              <select
                value={veiculoSel}
                onChange={(e) => escolherVeiculo(e.target.value)}
                className="min-h-[56px] rounded-xl border border-borda bg-superficie px-4 text-base text-texto"
              >
                <option value="">— sem veículo —</option>
                {(veiculos ?? []).map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.placa}{v.modelo ? ` · ${v.modelo}` : ""}
                  </option>
                ))}
                <option value="terceiro">Terceiro (digitar)</option>
              </select>
            </div>

            {veiculoSel === "terceiro" ? (
              <Texto label="Veículo terceiro" value={veiculoTerceiro} onChange={setVeiculoTerceiro} placeholder="Placa / descrição" />
            ) : null}

            <Texto label="Motorista (opcional)" value={motorista} onChange={setMotorista} placeholder="Nome do motorista" />
          </div>
        )}

        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  if (passo === "revisar" && produto && formato) {
    const num = Number(valor);

    const veiculoLabel = rotularVeiculo();

    const linhas: LinhaResumo[] = [
      { rotulo: "Tipo", valor: `${rotulo} (saída)` },
      { rotulo: "Produto", valor: produto.nome },
      { rotulo: "Formato", valor: formato.nome },
      ...(formato.pesoVariavel
        ? []
        : [{ rotulo: "Quantidade", valor: `${num} ${num === 1 ? "pacote" : "pacotes"}`, mono: true }]),
      ...(tipo === "perda"
        ? [
            { rotulo: "Motivo", valor: rotuloMotivo(motivo as MotivoPerda) },
            ...(motivo === "outro" ? [{ rotulo: "Descrição", valor: observacao.trim() }] : []),
          ]
        : [
            { rotulo: "Cliente", valor: cliente.trim() },
            { rotulo: "Veículo", valor: veiculoLabel },
            ...(motorista.trim() ? [{ rotulo: "Motorista", valor: motorista.trim() }] : []),
          ]),
      { rotulo: "Câmara", valor: camaraNome },
    ];

    return (
      <Tela
        titulo={`${rotulo} — confira`}
        camaraNome={camaraNome}
        onVoltar={() => setPasso("contexto")}
        etapa={5}
        totalEtapas={5}
        rodape={
          <BotaoGrande variante="saida" onClick={confirmar} disabled={enviando}>
            {enviando ? "Enviando…" : `Confirmar ${rotulo.toLowerCase()}`}
          </BotaoGrande>
        }
      >
        <ResumoLancamento pesoKg={kgDe(formato, num, num)} linhas={linhas} />
        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  return null;
}

function rotuloMotivo(m: MotivoPerda): string {
  return m === "derreteu" ? "Derreteu" : m === "danificado" ? "Danificado" : m === "descarte" ? "Descarte" : "Outro";
}

function Texto({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-base font-medium text-texto">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[56px] rounded-xl border border-borda bg-superficie px-4 text-base text-texto outline-none focus:border-acento"
      />
    </label>
  );
}

// Comprovante da saída (venda/patrocínio) na tela de sucesso do operador. Formato e
// texto vêm de src/lib/comprovante.ts (compartilhado com o histórico do Admin).
function ComprovanteSaida({ dados }: { dados: DadosComprovante }) {
  const [copiado, setCopiado] = useState(false);
  const texto = textoComprovante(dados);
  const link = linkWhatsappComprovante(dados);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  const linhas = linhasComprovante(dados);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-borda bg-superficie">
        <div className="border-b border-borda px-4 py-3">
          <div className="font-mono text-[11px] font-medium tracking-[0.1em] text-texto-fraco uppercase">
            Comprovante de saída
          </div>
          <div className="mt-0.5 text-base font-semibold text-texto">
            {dados.rotulo}{" "}
            <span className="font-mono text-sm font-normal text-texto-suave">{dataHora(dados.quandoMs)}</span>
          </div>
        </div>
        <dl>
          {linhas.map((l, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-3 border-b border-borda/60 px-4 py-2.5 last:border-0"
            >
              <dt className="text-base text-texto-suave">{l.rotulo}</dt>
              <dd className={`text-right text-base text-texto ${l.mono ? "font-mono" : ""}`}>{l.valor}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between border-t border-borda px-4 py-2.5">
          <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-texto-fraco uppercase">
            Protocolo
          </span>
          <span className="font-mono text-sm text-texto">{dados.protocolo}</span>
        </div>
      </div>

      <BotaoGrande variante="primario" onClick={() => window.open(link, "_blank", "noopener")}>
        <MessageCircle size={20} aria-hidden="true" /> Enviar comprovante no WhatsApp
      </BotaoGrande>
      <BotaoGrande variante="neutro" onClick={copiar}>
        {copiado ? (
          <>
            <Check size={18} aria-hidden="true" /> Comprovante copiado
          </>
        ) : (
          "Copiar comprovante"
        )}
      </BotaoGrande>
    </div>
  );
}
