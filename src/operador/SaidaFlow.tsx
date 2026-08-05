import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { mensagemErro } from "../lib/erros.ts";
import { formatarPacotes, formatarPeso } from "../lib/formato.ts";
import { AvisoOperador, BotaoGrande, CampoQuantidade, kgDe, OpcaoGrande, ResumoLancamento, Tela } from "./ui.tsx";
import type { FormatoGrid, LinhaResumo, ProdutoGrid } from "./ui.tsx";
import { ListaProdutos, ListaFormatos } from "./ProducaoFlow.tsx";
import { RetornoFlow } from "./RetornoFlow.tsx";
import { Check, MessageCircle, Trash2 } from "lucide-react";
import { dataHora } from "../lib/data.ts";
import { linhasComprovante, linkWhatsappComprovante, textoComprovante, type DadosComprovante } from "../lib/comprovante.ts";

/*
  Lançar saída (RF28–RF35) e ponto de entrada do retorno (RF38–RF41). Tipos:
  venda, patrocínio, perda — e "retorno de patrocínio", que abre o fluxo próprio.
  Venda e patrocínio usam o fluxo de CARREGAMENTO: vários produtos numa mesma
  saída, um comprovante só. Perda continua um item por vez (motivo é por linha).
  Saldo insuficiente no formato é bloqueado pelo servidor com mensagem clara.
*/
type Tipo = "venda" | "patrocinio" | "perda";
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

  if (modo === "perda") {
    return <SaidaPerda token={token} camaraNome={camaraNome} onVoltar={() => setModo(null)} />;
  }

  return (
    <SaidaCarregamento
      tipo={modo}
      token={token}
      camaraNome={camaraNome}
      operadorNome={operadorNome}
      onVoltar={() => setModo(null)}
    />
  );
}

// ---------------------------------------------------------------------------
// Venda / Patrocínio — carrinho: vários produtos num mesmo carregamento.
// ---------------------------------------------------------------------------
type ItemCarrinho = {
  produto: ProdutoGrid;
  formato: FormatoGrid;
  valor: string; // quantidade (pacotes) ou kg (peso variável), como string
  chave: string; // idempotência por item
};
type PassoCarr = "itens" | "produto" | "formato" | "quantidade" | "contexto" | "revisar" | "sucesso" | "confirmarSair";

function pesoDoItem(it: ItemCarrinho): number {
  const n = Number(it.valor);
  return kgDe(it.formato, n, n);
}
function labelQtdItem(it: ItemCarrinho): string {
  if (it.formato.pesoVariavel) return "";
  return formatarPacotes(Number(it.valor));
}

function SaidaCarregamento({
  tipo,
  token,
  camaraNome,
  operadorNome,
  onVoltar,
}: {
  tipo: "venda" | "patrocinio";
  token: string;
  camaraNome: string;
  operadorNome: string;
  onVoltar: () => void;
}) {
  const produtos = useQuery(api.operador.consulta.gridProdutos, { token });
  const veiculos = useQuery(api.operador.consulta.veiculos, { token });
  const saldos = useQuery(api.operador.consulta.saldos, { token });
  const lancar = useMutation(api.operador.lancamentos.lancarSaidaMultipla);

  const rotulo = tipo === "venda" ? "Venda" : "Patrocínio";

  // Um carregamentoId por saída — agrupa as linhas e serve de chave de idempotência
  // do lote (duplo-toque no "Confirmar" não duplica).
  const [carregamentoId] = useState(() => crypto.randomUUID());
  const [itens, setItens] = useState<ItemCarrinho[]>([]);
  const [passo, setPasso] = useState<PassoCarr>("produto"); // começa adicionando o 1º item

  // Rascunho do item em adição/edição
  const [produto, setProduto] = useState<ProdutoGrid | null>(null);
  const [formato, setFormato] = useState<FormatoGrid | null>(null);
  const [valor, setValor] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null); // índice do item sendo editado

  // Contexto compartilhado do carregamento
  const [cliente, setCliente] = useState("");
  const [veiculoSel, setVeiculoSel] = useState(""); // "" | id | "terceiro"
  const [veiculoTerceiro, setVeiculoTerceiro] = useState("");
  const [motorista, setMotorista] = useState("");

  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [quandoMs, setQuandoMs] = useState(0);

  const pesoTotal = itens.reduce((acc, it) => acc + pesoDoItem(it), 0);

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

  // Adiciona um item novo, ou substitui o que está em edição (mesma chave).
  function salvarItem() {
    if (!produto || !formato) return;
    setItens((xs) => {
      const novo: ItemCarrinho = {
        produto,
        formato,
        valor,
        chave: editIdx !== null ? xs[editIdx].chave : crypto.randomUUID(),
      };
      if (editIdx !== null) return xs.map((it, idx) => (idx === editIdx ? novo : it));
      return [...xs, novo];
    });
    limparRascunho();
    setPasso("itens");
  }

  function removerItem(i: number) {
    setItens((xs) => xs.filter((_, idx) => idx !== i));
  }

  function limparRascunho() {
    setProduto(null);
    setFormato(null);
    setValor("");
    setEditIdx(null);
  }

  function comecarNovoItem() {
    limparRascunho();
    setPasso("produto");
  }

  // Formato único: seleciona sozinho e pula direto pra quantidade (tarefa 2).
  function escolherProdutoNoCarrinho(p: ProdutoGrid) {
    setProduto(p);
    if (p.formatos.length === 1) {
      setFormato(p.formatos[0]);
      setValor("");
      setPasso("quantidade");
    } else {
      setPasso("formato");
    }
  }

  // Toca numa linha do carrinho para corrigir a quantidade sem refazer tudo.
  function editarItem(i: number) {
    const it = itens[i];
    setProduto(it.produto);
    setFormato(it.formato);
    setValor(it.valor);
    setEditIdx(i);
    setPasso("quantidade");
  }

  // Saldo do formato na câmara (do servidor). Fixo → pacotes; variável → kg.
  function saldoDoFormatoCarrinho(formatoId: Id<"formatos">) {
    if (!saldos) return undefined;
    for (const p of saldos) {
      const f = p.formatos.find((x) => x._id === formatoId);
      if (f) return f;
    }
    return undefined;
  }

  // Quanto do mesmo formato já está no carrinho (fora o item em edição).
  function jaNoCarrinho(formatoId: Id<"formatos">, exceto: number | null) {
    return itens.reduce(
      (acc, it, idx) =>
        idx === exceto || it.formato._id !== formatoId ? acc : acc + (Number(it.valor) || 0),
      0,
    );
  }

  // Sair do carrinho: se há itens, confirma antes de descartar (evita perder um
  // carregamento inteiro por um toque acidental no voltar, na porta da câmara).
  function tentarSair() {
    if (itens.length > 0) setPasso("confirmarSair");
    else onVoltar();
  }

  async function confirmar() {
    if (itens.length === 0) return;
    setErro("");
    setEnviando(true);
    try {
      await lancar({
        token,
        carregamentoId,
        tipo,
        itens: itens.map((it) => ({
          chaveIdempotencia: it.chave,
          produtoId: it.produto._id,
          formatoId: it.formato._id,
          quantidade: it.formato.pesoVariavel ? undefined : Number(it.valor),
          pesoKgVariavel: it.formato.pesoVariavel ? Number(it.valor) : undefined,
        })),
        clienteNome: cliente.trim(),
        veiculoId: veiculoSel && veiculoSel !== "terceiro" ? (veiculoSel as Id<"veiculos">) : undefined,
        veiculoTerceiro: veiculoSel === "terceiro" ? veiculoTerceiro.trim() || undefined : undefined,
        motorista: motorista.trim() || undefined,
      });
      setQuandoMs(Date.now());
      setPasso("sucesso");
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  // -------- Sucesso: comprovante único do carregamento --------
  if (passo === "sucesso") {
    const dados: DadosComprovante = {
      rotulo,
      quandoMs,
      cliente: cliente.trim(),
      itens: itens.map((it) => ({
        produtoNome: it.produto.nome,
        formatoNome: it.formato.nome,
        quantidadeLabel: labelQtdItem(it),
        pesoKg: pesoDoItem(it),
      })),
      pesoTotalKg: pesoTotal,
      veiculoLabel: rotularVeiculo(),
      motorista: motorista.trim(),
      camaraNome,
      operadorNome,
      protocolo: carregamentoId.slice(0, 8).toUpperCase() || "—",
    };

    return (
      <Tela titulo={`${rotulo} lançada`} camaraNome={camaraNome} aoVoltarHardware={onVoltar}>
        <AvisoOperador tom="ok">
          Registrado com sucesso · {itens.length} {itens.length === 1 ? "produto" : "produtos"}.
        </AvisoOperador>
        <div className="mt-4">
          <ComprovanteSaida dados={dados} />
        </div>
        <div className="mt-6">
          <BotaoGrande variante="neutro" onClick={onVoltar}>Voltar</BotaoGrande>
        </div>
      </Tela>
    );
  }

  // -------- Confirmar descarte do carregamento --------
  if (passo === "confirmarSair") {
    return (
      <Tela
        titulo={`Descartar ${rotulo.toLowerCase()}?`}
        camaraNome={camaraNome}
        onVoltar={() => setPasso("itens")}
        rodape={
          <div className="flex flex-col gap-3">
            <BotaoGrande variante="saida" onClick={onVoltar}>
              Descartar e sair
            </BotaoGrande>
            <BotaoGrande variante="neutro" onClick={() => setPasso("itens")}>
              Continuar editando
            </BotaoGrande>
          </div>
        }
      >
        <AvisoOperador>
          Você tem {itens.length} {itens.length === 1 ? "produto" : "produtos"} neste carregamento.
          Se sair agora, eles serão perdidos.
        </AvisoOperador>
      </Tela>
    );
  }

  // -------- Hub do carrinho: itens já adicionados --------
  if (passo === "itens") {
    return (
      <Tela
        titulo={`${rotulo} — carregamento`}
        camaraNome={camaraNome}
        onVoltar={tentarSair}
        rodape={
          <BotaoGrande variante="saida" onClick={() => setPasso("contexto")} disabled={itens.length === 0}>
            Continuar
          </BotaoGrande>
        }
      >
        <div className="flex flex-col gap-3">
          {itens.length === 0 ? (
            <p className="text-base text-texto-suave">Nenhum produto ainda. Adicione o primeiro.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {itens.map((it, i) => (
                  <LinhaItem
                    key={it.chave}
                    titulo={it.produto.nome}
                    detalhe={`${it.formato.nome}${labelQtdItem(it) ? ` · ${labelQtdItem(it)}` : ""}`}
                    peso={pesoDoItem(it)}
                    onEditar={() => editarItem(i)}
                    onRemover={() => removerItem(i)}
                  />
                ))}
              </div>
              <div className="flex items-baseline justify-between border-t border-borda px-1 pt-3">
                <span className="text-base text-texto-suave">Peso total</span>
                <span className="font-mono text-lg font-semibold text-texto">{formatarPeso(pesoTotal)}</span>
              </div>
            </>
          )}
          <BotaoGrande variante="neutro" onClick={comecarNovoItem}>+ Adicionar produto</BotaoGrande>
        </div>
      </Tela>
    );
  }

  // -------- Adicionar item: produto --------
  if (passo === "produto") {
    return (
      <Tela
        titulo={`${rotulo} — produto`}
        camaraNome={camaraNome}
        onVoltar={itens.length > 0 ? () => setPasso("itens") : onVoltar}
      >
        <ListaProdutos produtos={produtos} onEscolher={escolherProdutoNoCarrinho} />
      </Tela>
    );
  }

  // -------- Adicionar item: formato --------
  if (passo === "formato" && produto) {
    return (
      <Tela titulo={`${rotulo} — formato`} camaraNome={produto.nome} onVoltar={() => setPasso("produto")}>
        <ListaFormatos
          produto={produto}
          onEscolher={(f) => { setFormato(f); setValor(""); setPasso("quantidade"); }}
        />
      </Tela>
    );
  }

  // -------- Adicionar/editar item: quantidade --------
  if (passo === "quantidade" && produto && formato) {
    const num = Number(valor);
    const validoBasico = formato.pesoVariavel ? num > 0 : Number.isInteger(num) && num > 0;
    const editando = editIdx !== null;
    const pulouFormato = produto.formatos.length === 1;

    // Saldo disponível já descontando o que este carregamento reserva do mesmo
    // formato (o servidor revalida no Confirmar; aqui é para não montar em falso).
    const info = saldoDoFormatoCarrinho(formato._id);
    const base = info ? (formato.pesoVariavel ? info.pesoLiquidoKg : info.saldo) : null;
    const disponivel = base === null ? null : Math.max(0, base - jaNoCarrinho(formato._id, editIdx));
    const excede = disponivel !== null && num > disponivel;
    const valido = validoBasico && !excede;

    return (
      <Tela
        titulo={editando ? `${rotulo} — editar item` : `${rotulo} — quantidade`}
        camaraNome={`${produto.nome} · ${formato.nome}`}
        onVoltar={
          editando
            ? () => { limparRascunho(); setPasso("itens"); }
            : () => setPasso(pulouFormato ? "produto" : "formato")
        }
        rodape={
          <BotaoGrande variante="saida" onClick={salvarItem} disabled={!valido}>
            {editando ? "Salvar alteração" : "Adicionar ao carregamento"}
          </BotaoGrande>
        }
      >
        <CampoQuantidade formato={formato} valor={valor} onChange={setValor} />
        {disponivel !== null ? (
          <p className="mt-3 text-center text-base text-texto-suave">
            Disponível nesta câmara:{" "}
            <span className="font-mono text-texto">
              {formato.pesoVariavel ? formatarPeso(disponivel) : formatarPacotes(disponivel)}
            </span>
          </p>
        ) : null}
        {excede ? (
          <div className="mt-4">
            <AvisoOperador>
              Só há {formato.pesoVariavel ? formatarPeso(disponivel!) : formatarPacotes(disponivel!)} deste formato nesta câmara
              {jaNoCarrinho(formato._id, editIdx) > 0 ? " (contando o que já está no carregamento)" : ""}.
            </AvisoOperador>
          </div>
        ) : null}
      </Tela>
    );
  }

  // -------- Contexto compartilhado --------
  if (passo === "contexto") {
    const podeConfirmar = cliente.trim() !== "" && (veiculoSel !== "terceiro" || veiculoTerceiro.trim() !== "");
    return (
      <Tela
        titulo={`${rotulo} — detalhes`}
        camaraNome={camaraNome}
        onVoltar={() => setPasso("itens")}
        etapa={1}
        totalEtapas={2}
        rodape={
          <BotaoGrande variante="saida" onClick={() => setPasso("revisar")} disabled={!podeConfirmar}>
            Continuar
          </BotaoGrande>
        }
      >
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
        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  // -------- Revisar --------
  if (passo === "revisar") {
    const linhas: LinhaResumo[] = [
      { rotulo: "Tipo", valor: `${rotulo} (saída)` },
      ...itens.map((it) => ({
        rotulo: `${it.produto.nome} · ${it.formato.nome}${labelQtdItem(it) ? ` · ${labelQtdItem(it)}` : ""}`,
        valor: formatarPeso(pesoDoItem(it)),
        mono: true,
      })),
      { rotulo: "Cliente", valor: cliente.trim() },
      { rotulo: "Veículo", valor: rotularVeiculo() },
      ...(motorista.trim() ? [{ rotulo: "Motorista", valor: motorista.trim() }] : []),
      { rotulo: "Câmara", valor: camaraNome },
    ];

    return (
      <Tela
        titulo={`${rotulo} — confira`}
        camaraNome={camaraNome}
        onVoltar={() => setPasso("contexto")}
        etapa={2}
        totalEtapas={2}
        rodape={
          <BotaoGrande variante="saida" onClick={confirmar} disabled={enviando}>
            {enviando ? "Enviando…" : `Confirmar ${rotulo.toLowerCase()}`}
          </BotaoGrande>
        }
      >
        <ResumoLancamento pesoKg={pesoTotal} linhas={linhas} />
        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  return null;
}

// Linha de item no carrinho: toca para editar a quantidade; lixeira para remover.
function LinhaItem({
  titulo,
  detalhe,
  peso,
  onEditar,
  onRemover,
}: {
  titulo: string;
  detalhe: string;
  peso: number;
  onEditar: () => void;
  onRemover: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-borda bg-superficie">
      <button
        onClick={onEditar}
        aria-label={`Editar ${titulo}`}
        className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-l-xl px-4 py-3 text-left transition outline-none hover:bg-superficie-fria focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-texto">{titulo}</span>
          <span className="block truncate text-sm text-texto-suave">{detalhe}</span>
        </span>
        <span className="shrink-0 font-mono text-base text-texto">{formatarPeso(peso)}</span>
      </button>
      <button
        onClick={onRemover}
        aria-label={`Remover ${titulo}`}
        className="mr-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-texto-suave transition outline-none hover:bg-superficie-fria hover:text-alerta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
      >
        <Trash2 size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Perda — um item por vez (o motivo é por linha; não entra em carregamento).
// ---------------------------------------------------------------------------
type PassoPerda = "produto" | "formato" | "quantidade" | "contexto" | "revisar" | "sucesso";

function SaidaPerda({
  token,
  camaraNome,
  onVoltar,
}: {
  token: string;
  camaraNome: string;
  onVoltar: () => void;
}) {
  const produtos = useQuery(api.operador.consulta.gridProdutos, { token });
  const lancar = useMutation(api.operador.lancamentos.lancarSaida);

  const [passo, setPasso] = useState<PassoPerda>("produto");
  const [produto, setProduto] = useState<ProdutoGrid | null>(null);
  const [formato, setFormato] = useState<FormatoGrid | null>(null);
  const [valor, setValor] = useState("");
  const [chave, setChave] = useState("");
  const [motivo, setMotivo] = useState<MotivoPerda | "">("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  function escolherFormato(f: FormatoGrid) {
    setFormato(f);
    setValor("");
    setChave(crypto.randomUUID());
    setPasso("quantidade");
  }

  // Formato único: seleciona sozinho e pula direto pra quantidade (tarefa 2).
  function escolherProduto(p: ProdutoGrid) {
    setProduto(p);
    if (p.formatos.length === 1) {
      setFormato(p.formatos[0]);
      setValor("");
      setChave(crypto.randomUUID());
      setPasso("quantidade");
    } else {
      setPasso("formato");
    }
  }

  const pulouFormato = produto !== null && produto.formatos.length === 1;
  const totalEtapasPerda = pulouFormato ? 4 : 5;

  async function confirmar() {
    if (!produto || !formato) return;
    setErro("");
    setEnviando(true);
    try {
      const num = Number(valor);
      await lancar({
        token,
        chaveIdempotencia: chave,
        tipo: "perda",
        produtoId: produto._id,
        formatoId: formato._id,
        quantidade: formato.pesoVariavel ? undefined : num,
        pesoKgVariavel: formato.pesoVariavel ? num : undefined,
        motivoPerda: (motivo || undefined) as MotivoPerda | undefined,
        observacao: observacao.trim() || undefined,
      });
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
    const quantidadeLabel = formato?.pesoVariavel ? "" : formatarPacotes(num);
    return (
      <Tela titulo="Perda lançada" camaraNome={camaraNome} aoVoltarHardware={onVoltar}>
        <AvisoOperador tom="ok">Registrado com sucesso.</AvisoOperador>
        {produto && formato ? (
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
        ) : null}
        <div className="mt-6">
          <BotaoGrande variante="neutro" onClick={onVoltar}>Voltar</BotaoGrande>
        </div>
      </Tela>
    );
  }

  if (passo === "produto") {
    return (
      <Tela titulo="Perda — produto" camaraNome={camaraNome} onVoltar={onVoltar} etapa={1} totalEtapas={5}>
        <ListaProdutos produtos={produtos} onEscolher={escolherProduto} />
      </Tela>
    );
  }

  if (passo === "formato" && produto) {
    return (
      <Tela titulo="Perda — formato" camaraNome={produto.nome} onVoltar={() => setPasso("produto")} etapa={2} totalEtapas={5}>
        <ListaFormatos produto={produto} onEscolher={escolherFormato} />
      </Tela>
    );
  }

  if (passo === "quantidade" && produto && formato) {
    const num = Number(valor);
    const valido = formato.pesoVariavel ? num > 0 : Number.isInteger(num) && num > 0;
    return (
      <Tela
        titulo="Perda — quantidade"
        camaraNome={`${produto.nome} · ${formato.nome}`}
        onVoltar={() => setPasso(pulouFormato ? "produto" : "formato")}
        etapa={pulouFormato ? 2 : 3}
        totalEtapas={totalEtapasPerda}
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
    const podeConfirmar = motivo !== "" && (motivo !== "outro" || observacao.trim() !== "");
    return (
      <Tela
        titulo="Perda — detalhes"
        camaraNome={camaraNome}
        onVoltar={() => setPasso("quantidade")}
        etapa={pulouFormato ? 3 : 4}
        totalEtapas={totalEtapasPerda}
        rodape={
          <BotaoGrande variante="saida" onClick={() => setPasso("revisar")} disabled={!podeConfirmar}>
            Continuar
          </BotaoGrande>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-base font-medium text-texto">Motivo da perda</p>
          {(["derreteu", "danificado", "descarte", "outro"] as MotivoPerda[]).map((m) => (
            <OpcaoGrande key={m} titulo={rotuloMotivo(m)} selecionado={motivo === m} onClick={() => setMotivo(m)} />
          ))}
          {motivo === "outro" ? (
            <Texto label="Descreva o motivo (obrigatório)" value={observacao} onChange={setObservacao} />
          ) : null}
        </div>
        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  if (passo === "revisar" && produto && formato) {
    const num = Number(valor);
    const linhas: LinhaResumo[] = [
      { rotulo: "Tipo", valor: "Perda (saída)" },
      { rotulo: "Produto", valor: produto.nome },
      { rotulo: "Formato", valor: formato.nome },
      ...(formato.pesoVariavel ? [] : [{ rotulo: "Quantidade", valor: formatarPacotes(num), mono: true }]),
      { rotulo: "Motivo", valor: rotuloMotivo(motivo as MotivoPerda) },
      ...(motivo === "outro" ? [{ rotulo: "Descrição", valor: observacao.trim() }] : []),
      { rotulo: "Câmara", valor: camaraNome },
    ];
    return (
      <Tela
        titulo="Perda — confira"
        camaraNome={camaraNome}
        onVoltar={() => setPasso("contexto")}
        etapa={pulouFormato ? 4 : 5}
        totalEtapas={totalEtapasPerda}
        rodape={
          <BotaoGrande variante="saida" onClick={confirmar} disabled={enviando}>
            {enviando ? "Enviando…" : "Confirmar perda"}
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
          {linhas.map((l, i) =>
            l.forte ? (
              <div
                key={i}
                className="flex items-baseline justify-between gap-3 border-y border-borda bg-superficie-fria/40 px-4 py-3"
              >
                <dt className="text-base font-medium text-texto">{l.rotulo}</dt>
                <dd className="text-right font-mono text-2xl font-semibold text-texto">{l.valor}</dd>
              </div>
            ) : (
              <div
                key={i}
                className="flex items-baseline justify-between gap-3 border-b border-borda/60 px-4 py-2.5 last:border-0"
              >
                <dt className="min-w-0 flex-1 text-base text-texto-suave">{l.rotulo}</dt>
                <dd className={`shrink-0 text-right text-base text-texto ${l.mono ? "font-mono" : ""}`}>{l.valor}</dd>
              </div>
            ),
          )}
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
