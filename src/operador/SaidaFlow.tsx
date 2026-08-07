import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ehFalhaDeRede, mensagemErro } from "../lib/erros.ts";
import { formatarPacotes, formatarPeso, rotuloFormato } from "../lib/formato.ts";
import { mascaraPlaca, placaCompleta, rotuloPlacaOuTexto } from "../lib/mascaras.ts";
import { AvisoOperador, BotaoGrande, CampoQuantidade, kgDe, OpcaoGrande, primeiroNome, ResumoLancamento, Tela } from "./ui.tsx";
import type { FormatoGrid, ItemResumo, LinhaResumo, ProdutoGrid } from "./ui.tsx";
import { ListaProdutos, ListaFormatos } from "./ProducaoFlow.tsx";
import { mensagemPlausibilidade, usePlausibilidade } from "./plausibilidade.ts";
import { BotaoDesfazer, BotaoDesfazerCarregamento } from "./desfazer.tsx";
import { RetornoFlow } from "./RetornoFlow.tsx";
import { Check, MessageCircle, Trash2 } from "lucide-react";
import { dataHoraComprovante } from "../lib/data.ts";
import {
  cabecalhoEmpresaEstruturado,
  linhasContexto,
  linkWhatsappComprovante,
  SELO_NAO_FISCAL,
  textoComprovante,
  totalPacotesComprovante,
  type DadosComprovante,
} from "../lib/comprovante.ts";

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
  const nome = primeiroNome(operadorNome);
  // Sabe de antemão se há patrocínio em aberto pra desabilitar a opção no menu
  // em vez de deixar o operador entrar num fluxo sem nada pra fazer (tarefa 7).
  const patrociniosAbertos = useQuery(api.operador.consulta.patrociniosAbertos, { token });

  if (modo === "retorno") {
    return <RetornoFlow token={token} camaraNome={camaraNome} operadorNome={operadorNome} onVoltar={() => setModo(null)} />;
  }
  if (modo === null) {
    const semPatrocinio = patrociniosAbertos !== undefined && patrociniosAbertos.length === 0;
    return (
      <Tela titulo="Saída / retorno" camaraNome={camaraNome} operadorNome={nome} onVoltar={onVoltar}>
        <div className="flex flex-col gap-3">
          <OpcaoGrande titulo="Venda" onClick={() => setModo("venda")} />
          <OpcaoGrande titulo="Patrocínio" onClick={() => setModo("patrocinio")} />
          <OpcaoGrande titulo="Perda" onClick={() => setModo("perda")} />
          <OpcaoGrande
            titulo="Retorno de patrocínio"
            detalhe={semPatrocinio ? "nenhum em aberto" : undefined}
            disabled={semPatrocinio}
            onClick={() => setModo("retorno")}
          />
        </div>
      </Tela>
    );
  }

  if (modo === "perda") {
    return (
      <SaidaPerda token={token} camaraNome={camaraNome} operadorNome={operadorNome} onVoltar={() => setModo(null)} />
    );
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

// Cancelar o carregamento inteiro (tarefa 4 da correção "quatro ajustes
// pontuais") — texto simples, nunca do tamanho/peso do botão de avançar, e
// longe dele na tela (topo do conteúdo, não colado ao rodapé) pra não virar
// um toque errado por confundir os dois. `onClick` é sempre `tentarSair`:
// confirma antes de descartar quando há itens, sai direto quando não há.
function BotaoCancelarFluxo({ rotulo, onClick }: { rotulo: string; onClick: () => void }) {
  return (
    <div className="mb-3 flex justify-end">
      <button
        onClick={onClick}
        className="min-h-[44px] px-1 text-base font-medium text-texto-suave underline-offset-4 outline-none transition hover:text-alerta hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
      >
        Cancelar {rotulo.toLowerCase()}
      </button>
    </div>
  );
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
  const nome = primeiroNome(operadorNome);
  const produtos = useQuery(api.operador.consulta.gridProdutos, { token });
  const frequentes = useQuery(api.operador.consulta.produtosFrequentes, { token });
  const veiculos = useQuery(api.operador.consulta.veiculos, { token });
  const saldos = useQuery(api.operador.consulta.saldos, { token });
  const lancar = useMutation(api.operador.lancamentos.lancarSaidaMultipla);
  // Cabeçalho do comprovante (tarefa 7) — leitura pública, sem exigirAdmin: o
  // operador não tem sessão Clerk.
  const empresa = useQuery(api.empresaPublica.dadosComprovante);

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
  const [veiculoTerceiroModelo, setVeiculoTerceiroModelo] = useState("");
  const [motorista, setMotorista] = useState("");

  const [erro, setErro] = useState("");
  const [erroDeRede, setErroDeRede] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [quandoMs, setQuandoMs] = useState(0);
  const [protocolo, setProtocolo] = useState("");
  // Desfazer do carregamento (tarefa 4 do adendo): fecha assim que o
  // comprovante é enviado/copiado — ver ComprovanteSaida mais abaixo.
  const [compartilhado, setCompartilhado] = useState(false);
  const [desfeito, setDesfeito] = useState(false);

  const pesoTotal = itens.reduce((acc, it) => acc + pesoDoItem(it), 0);
  // Total de pacotes (tarefa 5 do adendo): quem carrega a van conta pacotes, não
  // quilos — soma só os itens de formato fixo (peso variável não tem "pacote").
  // 0 quando o carregamento é só granel: nesse caso não existe "0 pacotes" pra
  // mostrar, só o peso.
  const totalPacotes = itens.reduce(
    (acc, it) => (it.formato.pesoVariavel ? acc : acc + (Number(it.valor) || 0)),
    0,
  );

  // Hook no topo (regra dos hooks) — a query só ativa com produto+formato+
  // quantidade > 0, então não pesa nos outros passos do carrinho.
  const num = Number(valor);
  const plaus = usePlausibilidade({
    token,
    produtoId: produto?._id ?? null,
    formatoId: formato?._id ?? null,
    tipo,
    quantidade: num,
  });

  function escolherVeiculo(sel: string) {
    setVeiculoSel(sel);
    const v = veiculos?.find((x) => x._id === sel);
    if (v?.motoristaPadrao && motorista === "") setMotorista(v.motoristaPadrao);
  }

  function rotularVeiculo(): string {
    if (veiculoSel === "") return "sem veículo";
    if (veiculoSel === "terceiro") {
      if (!veiculoTerceiro) return "terceiro";
      const placa = rotuloPlacaOuTexto(veiculoTerceiro);
      return `${placa} (terceiro)${veiculoTerceiroModelo.trim() ? ` · ${veiculoTerceiroModelo.trim()}` : ""}`;
    }
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
    setErroDeRede(false);
    setEnviando(true);
    try {
      const r = await lancar({
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
        veiculoTerceiro: veiculoSel === "terceiro" ? veiculoTerceiro || undefined : undefined,
        veiculoTerceiroModelo: veiculoSel === "terceiro" ? veiculoTerceiroModelo.trim() || undefined : undefined,
        motorista: motorista.trim() || undefined,
      });
      setProtocolo(r.protocolo);
      setQuandoMs(Date.now());
      setPasso("sucesso");
    } catch (e) {
      const rede = ehFalhaDeRede(e);
      setErroDeRede(rede);
      setErro(rede ? "Não foi possível enviar. Seu lançamento não foi perdido." : mensagemErro(e));
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
        formatoNome: rotuloFormato(it.formato),
        quantidadePacotes: it.formato.pesoVariavel ? null : Number(it.valor),
        pesoKg: pesoDoItem(it),
      })),
      pesoTotalKg: pesoTotal,
      veiculoLabel: rotularVeiculo(),
      motorista: motorista.trim(),
      camaraNome,
      operadorNome,
      protocolo: protocolo || "—",
      empresa: empresa ?? null,
    };

    return (
      <Tela
        titulo={`${rotulo} lançad${tipo === "venda" ? "a" : "o"}`}
        camaraNome={camaraNome}
        operadorNome={nome}
        aoVoltarHardware={onVoltar}
      >
        <AvisoOperador tom="ok">
          {desfeito ? "Lançamento desfeito." : `Registrado com sucesso · ${itens.length} ${itens.length === 1 ? "produto" : "produtos"}.`}
        </AvisoOperador>
        {!desfeito ? (
          <>
            <div className="mt-4">
              <ComprovanteSaida
                token={token}
                carregamentoId={carregamentoId}
                dados={dados}
                onCompartilhado={() => setCompartilhado(true)}
              />
            </div>
            {protocolo ? (
              <div className="mt-4">
                <BotaoDesfazerCarregamento
                  token={token}
                  carregamentoId={carregamentoId}
                  protocolo={protocolo}
                  quandoMs={quandoMs}
                  compartilhado={compartilhado}
                  onDesfeito={() => setDesfeito(true)}
                />
              </div>
            ) : null}
          </>
        ) : null}
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
        titulo="Descartar?"
        camaraNome={camaraNome}
        operadorNome={nome}
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
          Descartar a {rotulo.toLowerCase()} em andamento? {itens.length === 1 ? "O produto adicionado será perdido." : `Os ${itens.length} produtos adicionados serão perdidos.`}
        </AvisoOperador>
      </Tela>
    );
  }

  // -------- Hub do carrinho: itens já adicionados --------
  if (passo === "itens") {
    return (
      <Tela
        titulo="Carregamento"
        camaraNome={camaraNome}
        operadorNome={nome}
        onVoltar={tentarSair}
        rodape={
          <BotaoGrande variante="primario" onClick={() => setPasso("contexto")} disabled={itens.length === 0}>
            Continuar
          </BotaoGrande>
        }
      >
        <BotaoCancelarFluxo rotulo={rotulo} onClick={tentarSair} />
        <div className="flex flex-col gap-3">
          {itens.length === 0 ? (
            <p className="text-base text-texto-suave">Nenhum produto ainda. Adicione o primeiro.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {itens.map((it, i) => (
                  <LinhaItem
                    key={it.chave}
                    produtoNome={it.produto.nome}
                    formatoNome={rotuloFormato(it.formato)}
                    quantidadePacotes={it.formato.pesoVariavel ? null : Number(it.valor)}
                    pesoKg={pesoDoItem(it)}
                    onEditar={() => editarItem(i)}
                    onRemover={() => removerItem(i)}
                  />
                ))}
              </div>
              {/* Quantidade em destaque (tarefa 5): quem carrega a van conta
                  pacotes; o peso é derivado, em corpo menor ao lado. */}
              <div className="flex items-baseline justify-between border-t border-borda px-1 pt-3">
                <span className="text-base font-medium text-texto">Total</span>
                <span className="text-right">
                  {totalPacotes > 0 ? (
                    <>
                      <span className="font-mono text-lg font-semibold text-texto">{formatarPacotes(totalPacotes)}</span>
                      <span className="ml-2 font-mono text-sm text-texto-suave">{formatarPeso(pesoTotal)}</span>
                    </>
                  ) : (
                    <span className="font-mono text-lg font-semibold text-texto">{formatarPeso(pesoTotal)}</span>
                  )}
                </span>
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
        titulo="Produto"
        camaraNome={camaraNome}
        operadorNome={nome}
        onVoltar={itens.length > 0 ? () => setPasso("itens") : onVoltar}
      >
        <ListaProdutos
          produtos={produtos}
          frequentesIds={frequentes}
          onEscolher={escolherProdutoNoCarrinho}
          onVoltar={onVoltar}
        />
      </Tela>
    );
  }

  // -------- Adicionar item: formato --------
  if (passo === "formato" && produto) {
    return (
      <Tela titulo="Formato" camaraNome={produto.nome} operadorNome={nome} onVoltar={() => setPasso("produto")}>
        <ListaFormatos
          produto={produto}
          onEscolher={(f) => { setFormato(f); setValor(""); setPasso("quantidade"); }}
          onVoltar={onVoltar}
        />
      </Tela>
    );
  }

  // -------- Adicionar/editar item: quantidade --------
  if (passo === "quantidade" && produto && formato) {
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

    // Fora do saldo, a quantidade é grande demais pro padrão (tarefa 4):
    // segunda confirmação nomeando o número, em vez de deixar passar direto.
    const formatarValor = formato.pesoVariavel ? formatarPeso : formatarPacotes;
    const pesoDigitado = kgDe(formato, num, num);
    const mensagemAviso = valido && plaus.precisaConfirmar
      ? mensagemPlausibilidade({
          resumo: formato.pesoVariavel ? `${formatarPeso(pesoDigitado)}.` : `${formatarPacotes(num)} = ${formatarPeso(pesoDigitado)}.`,
          produtoNome: produto.nome,
          mediaDiariaLabel: plaus.mediaDiaria !== null ? formatarValor(plaus.mediaDiaria) : null,
          saldoLabel: formatarValor(plaus.saldoAtual ?? 0),
        })
      : null;

    return (
      <Tela
        titulo={editando ? "Editar item" : "Quantidade"}
        camaraNome={`${produto.nome} · ${rotuloFormato(formato)}`}
        operadorNome={nome}
        onVoltar={
          editando
            ? () => { limparRascunho(); setPasso("itens"); }
            : () => setPasso(pulouFormato ? "produto" : "formato")
        }
        rodape={
          mensagemAviso ? (
            <div className="flex flex-col gap-3">
              <AvisoOperador>{mensagemAviso}</AvisoOperador>
              <BotaoGrande variante="neutro" onClick={() => plaus.setConfirmouAviso(true)}>
                Confirmar mesmo assim
              </BotaoGrande>
            </div>
          ) : (
            <BotaoGrande variante="primario" onClick={salvarItem} disabled={!valido}>
              {editando ? "Salvar alteração" : "Adicionar ao carregamento"}
            </BotaoGrande>
          )
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
    const podeConfirmar = cliente.trim() !== "" && (veiculoSel !== "terceiro" || placaCompleta(veiculoTerceiro));
    return (
      <Tela
        titulo="Detalhes"
        camaraNome={camaraNome}
        operadorNome={nome}
        onVoltar={() => setPasso("itens")}
        rodape={
          <BotaoGrande variante="primario" onClick={() => setPasso("revisar")} disabled={!podeConfirmar}>
            Continuar
          </BotaoGrande>
        }
      >
        <BotaoCancelarFluxo rotulo={rotulo} onClick={tentarSair} />
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
            <>
              <label className="flex flex-col gap-1">
                <span className="text-base font-medium text-texto">Placa do terceiro</span>
                <input
                  value={veiculoTerceiro}
                  onChange={(e) => setVeiculoTerceiro(mascaraPlaca(e.target.value))}
                  placeholder="ABC1D23"
                  inputMode="text"
                  autoCapitalize="characters"
                  maxLength={7}
                  className="min-h-[56px] rounded-xl border border-borda bg-superficie px-4 font-mono text-base text-texto outline-none focus:border-acento"
                />
                {veiculoTerceiro !== "" && !placaCompleta(veiculoTerceiro) ? (
                  <span className="text-sm text-alerta">Formato: ABC-1234 ou ABC1D23.</span>
                ) : null}
              </label>
              <Texto
                label="Modelo / descrição (opcional)"
                value={veiculoTerceiroModelo}
                onChange={setVeiculoTerceiroModelo}
                placeholder="Van baú branca"
              />
            </>
          ) : null}

          <Texto label="Motorista (opcional)" value={motorista} onChange={setMotorista} placeholder="Nome do motorista" />
        </div>
        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  // -------- Revisar --------
  if (passo === "revisar") {
    // Cada produto vira um item de verdade (tarefa 5) — nunca uma string
    // "produto · formato · quantidade" concatenada numa linha genérica.
    const itensResumo: ItemResumo[] = itens.map((it) => ({
      produtoNome: it.produto.nome,
      formatoNome: rotuloFormato(it.formato),
      quantidadePacotes: it.formato.pesoVariavel ? null : Number(it.valor),
      pesoKg: pesoDoItem(it),
    }));
    const linhas: LinhaResumo[] = [
      { rotulo: "Tipo", valor: `${rotulo} (saída)` },
      { rotulo: "Cliente", valor: cliente.trim() },
      { rotulo: "Veículo", valor: rotularVeiculo() },
      ...(motorista.trim() ? [{ rotulo: "Motorista", valor: motorista.trim() }] : []),
      { rotulo: "Câmara", valor: camaraNome },
    ];

    return (
      <Tela
        titulo="Confira"
        camaraNome={camaraNome}
        operadorNome={nome}
        onVoltar={enviando ? undefined : () => setPasso("contexto")}
        rodape={
          <BotaoGrande variante="primario" onClick={confirmar} disabled={enviando}>
            {enviando ? "Enviando…" : erroDeRede ? "Tentar de novo" : `Confirmar ${rotulo.toLowerCase()}`}
          </BotaoGrande>
        }
      >
        {!enviando ? <BotaoCancelarFluxo rotulo={rotulo} onClick={tentarSair} /> : null}
        {/* Mesma hierarquia da produção (tarefa 5): quantidade em destaque,
            peso derivado abaixo — não o contrário. */}
        <ResumoLancamento
          pesoKg={pesoTotal}
          quantidadePacotes={totalPacotes > 0 ? totalPacotes : null}
          itens={itensResumo}
          linhas={linhas}
        />
        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  return null;
}

// Linha de item no carrinho: toca para editar a quantidade; lixeira para remover.
// A lixeira nunca remove com um toque só (tarefa 5): com luva e celular
// molhado, é fácil apagar sem querer — confirmação inline nomeando o item
// antes de tirar do carregamento. Produto e formato em linhas separadas
// (produto é a âncora, formato é metadado — nunca uma string concatenada);
// quantidade em pacotes é o destaque à direita, peso derivado abaixo dela.
function LinhaItem({
  produtoNome,
  formatoNome,
  quantidadePacotes,
  pesoKg,
  onEditar,
  onRemover,
}: {
  produtoNome: string;
  formatoNome: string;
  quantidadePacotes: number | null;
  pesoKg: number;
  onEditar: () => void;
  onRemover: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  if (confirmando) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-borda bg-superficie p-3">
        <p className="text-base text-texto">
          Remover <span className="font-medium">{produtoNome}</span>?
        </p>
        <div className="flex gap-2">
          <BotaoGrande variante="neutro" onClick={() => setConfirmando(false)} className="flex-1">
            Cancelar
          </BotaoGrande>
          <BotaoGrande variante="saida" onClick={onRemover} className="flex-1">
            Remover
          </BotaoGrande>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-stretch gap-1 rounded-xl border border-borda bg-superficie">
      <button
        onClick={onEditar}
        aria-label={`Editar ${produtoNome}`}
        className="flex min-h-[56px] min-w-0 flex-1 items-start justify-between gap-3 rounded-l-xl px-4 py-3 text-left transition outline-none hover:bg-superficie-fria focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-texto">{produtoNome}</span>
          <span className="block truncate text-sm text-texto-suave">{formatoNome}</span>
        </span>
        <span className="shrink-0 text-right whitespace-nowrap">
          {quantidadePacotes !== null ? (
            <>
              <span className="block font-mono text-base font-semibold text-texto">
                {quantidadePacotes}
                <span className="ml-1 font-sans text-sm font-normal text-texto-suave">
                  {quantidadePacotes === 1 ? "pacote" : "pacotes"}
                </span>
              </span>
              <span className="block font-mono text-sm text-texto-suave">{formatarPeso(pesoKg)}</span>
            </>
          ) : (
            <span className="block font-mono text-base font-semibold text-texto">{formatarPeso(pesoKg)}</span>
          )}
        </span>
      </button>
      <button
        onClick={() => setConfirmando(true)}
        aria-label={`Remover ${produtoNome}`}
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
  operadorNome,
  onVoltar,
}: {
  token: string;
  camaraNome: string;
  operadorNome: string;
  onVoltar: () => void;
}) {
  const nome = primeiroNome(operadorNome);
  const produtos = useQuery(api.operador.consulta.gridProdutos, { token });
  const frequentes = useQuery(api.operador.consulta.produtosFrequentes, { token });
  const saldos = useQuery(api.operador.consulta.saldos, { token });
  const lancar = useMutation(api.operador.lancamentos.lancarSaida);

  const [passo, setPasso] = useState<PassoPerda>("produto");
  const [produto, setProduto] = useState<ProdutoGrid | null>(null);
  const [formato, setFormato] = useState<FormatoGrid | null>(null);
  const [valor, setValor] = useState("");
  const [chave, setChave] = useState("");
  const [motivo, setMotivo] = useState<MotivoPerda | "">("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [erroDeRede, setErroDeRede] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Do último lançamento bem-sucedido — pra "Lançar outro do mesmo produto" e
  // pro botão Desfazer (tarefa 5).
  const [ultimoId, setUltimoId] = useState<Id<"movimentacoes"> | null>(null);
  const [quandoMs, setQuandoMs] = useState<number | null>(null);
  const [protocolo, setProtocolo] = useState("");
  const [desfeito, setDesfeito] = useState(false);

  // Saldo do formato na câmara (do servidor). Fixo → pacotes; variável → kg.
  function saldoDoFormatoPerda(formatoId: Id<"formatos">) {
    if (!saldos) return undefined;
    for (const p of saldos) {
      const f = p.formatos.find((x) => x._id === formatoId);
      if (f) return f;
    }
    return undefined;
  }

  function escolherFormato(f: FormatoGrid) {
    setFormato(f);
    setValor("");
    setPasso("quantidade");
  }

  // Formato único: seleciona sozinho e pula direto pra quantidade (tarefa 2).
  function escolherProduto(p: ProdutoGrid) {
    setProduto(p);
    setValor("");
    setPasso(p.formatos.length === 1 ? "quantidade" : "formato");
    if (p.formatos.length === 1) setFormato(p.formatos[0]);
  }

  // Mantém produto e formato, pede motivo de novo (cada perda tem o seu
  // próprio motivo) — atalho "Lançar outro do mesmo produto" na tela de sucesso.
  function lancarDeNovoMesmoProduto() {
    setValor("");
    setMotivo("");
    setObservacao("");
    setChave("");
    setErro("");
    setUltimoId(null);
    setQuandoMs(null);
    setProtocolo("");
    setDesfeito(false);
    setPasso("quantidade");
  }

  const pulouFormato = produto !== null && produto.formatos.length === 1;
  const totalEtapasPerda = pulouFormato ? 4 : 5;

  // Hooks no topo (regra dos hooks).
  const num = Number(valor);
  const plaus = usePlausibilidade({
    token,
    produtoId: produto?._id ?? null,
    formatoId: formato?._id ?? null,
    tipo: "perda",
    quantidade: num,
  });

  // Chave de idempotência gerada ao ENTRAR na conferência (tarefa 5), não
  // antes — assim mudar a quantidade ou o motivo depois de voltar sempre gera
  // uma chave nova, nunca reaproveita a idempotência de um valor diferente.
  function irParaConferencia() {
    setChave(crypto.randomUUID());
    setPasso("revisar");
  }

  async function confirmar() {
    if (!produto || !formato) return;
    setErro("");
    setErroDeRede(false);
    setEnviando(true);
    try {
      const r = await lancar({
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
      setUltimoId(r.movimentacaoId);
      setProtocolo(r.protocolo);
      setQuandoMs(Date.now());
      setPasso("sucesso");
    } catch (e) {
      const rede = ehFalhaDeRede(e);
      setErroDeRede(rede);
      setErro(rede ? "Não foi possível enviar. Seu lançamento não foi perdido." : mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (passo === "sucesso") {
    const pesoKg = produto && formato ? kgDe(formato, num, num) : 0;
    return (
      <Tela titulo="Perda lançada" camaraNome={camaraNome} operadorNome={nome} aoVoltarHardware={onVoltar}>
        <AvisoOperador tom="ok">
          {desfeito ? "Lançamento desfeito." : "Registrado com sucesso."}
          {!desfeito && protocolo ? <span className="ml-1.5 font-mono text-sm">· {protocolo}</span> : null}
        </AvisoOperador>
        {produto && formato && !desfeito ? (
          <div className="mt-4">
            <ResumoLancamento
              pesoKg={pesoKg}
              quantidadePacotes={formato.pesoVariavel ? null : num}
              linhas={[
                { rotulo: "Produto", valor: produto.nome },
                { rotulo: "Formato", valor: rotuloFormato(formato) },
                { rotulo: "Motivo", valor: rotuloMotivo(motivo as MotivoPerda) },
              ]}
            />
          </div>
        ) : null}
        <div className="mt-6 flex flex-col gap-3">
          {!desfeito ? (
            <>
              <BotaoGrande variante="saida" onClick={lancarDeNovoMesmoProduto}>
                Lançar outro do mesmo produto
              </BotaoGrande>
              {ultimoId && quandoMs ? (
                <BotaoDesfazer
                  token={token}
                  lancamentoId={ultimoId}
                  quandoMs={quandoMs}
                  onDesfeito={() => setDesfeito(true)}
                />
              ) : null}
            </>
          ) : null}
          <BotaoGrande variante="neutro" onClick={onVoltar}>Voltar ao início</BotaoGrande>
        </div>
      </Tela>
    );
  }

  if (passo === "produto") {
    return (
      <Tela titulo="Perda — produto" camaraNome={camaraNome} operadorNome={nome} onVoltar={onVoltar} etapa={1} totalEtapas={5}>
        <ListaProdutos produtos={produtos} frequentesIds={frequentes} onEscolher={escolherProduto} onVoltar={onVoltar} />
      </Tela>
    );
  }

  if (passo === "formato" && produto) {
    return (
      <Tela titulo="Perda — formato" camaraNome={produto.nome} operadorNome={nome} onVoltar={() => setPasso("produto")} etapa={2} totalEtapas={5}>
        <ListaFormatos produto={produto} onEscolher={escolherFormato} onVoltar={onVoltar} />
      </Tela>
    );
  }

  if (passo === "quantidade" && produto && formato) {
    const validoBasico = formato.pesoVariavel ? num > 0 : Number.isInteger(num) && num > 0;

    // Saldo disponível (tarefa 4): saída maior que o saldo BLOQUEIA, não avisa.
    const info = saldoDoFormatoPerda(formato._id);
    const disponivel = info ? (formato.pesoVariavel ? info.pesoLiquidoKg : info.saldo) : null;
    const excede = disponivel !== null && num > disponivel;
    const valido = validoBasico && !excede;

    return (
      <Tela
        titulo="Perda — quantidade"
        camaraNome={`${produto.nome} · ${rotuloFormato(formato)}`}
        operadorNome={nome}
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
              Só há {formato.pesoVariavel ? formatarPeso(disponivel!) : formatarPacotes(disponivel!)} deste formato nesta câmara.
            </AvisoOperador>
          </div>
        ) : null}
      </Tela>
    );
  }

  if (passo === "contexto") {
    const podeConfirmar = motivo !== "" && (motivo !== "outro" || observacao.trim() !== "");
    return (
      <Tela
        titulo="Perda — detalhes"
        camaraNome={camaraNome}
        operadorNome={nome}
        onVoltar={() => setPasso("quantidade")}
        etapa={pulouFormato ? 3 : 4}
        totalEtapas={totalEtapasPerda}
        rodape={
          <BotaoGrande variante="saida" onClick={irParaConferencia} disabled={!podeConfirmar}>
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
    const pesoKg = kgDe(formato, num, num);
    const linhas: LinhaResumo[] = [
      { rotulo: "Tipo", valor: "Perda (saída)" },
      { rotulo: "Produto", valor: produto.nome },
      { rotulo: "Formato", valor: rotuloFormato(formato) },
      { rotulo: "Motivo", valor: rotuloMotivo(motivo as MotivoPerda) },
      ...(motivo === "outro" ? [{ rotulo: "Descrição", valor: observacao.trim() }] : []),
      { rotulo: "Câmara", valor: camaraNome },
    ];

    const formatarValor = formato.pesoVariavel ? formatarPeso : formatarPacotes;
    const mensagemAviso = plaus.precisaConfirmar
      ? mensagemPlausibilidade({
          resumo: formato.pesoVariavel ? `${formatarPeso(pesoKg)}.` : `${formatarPacotes(num)} = ${formatarPeso(pesoKg)}.`,
          produtoNome: produto.nome,
          mediaDiariaLabel: plaus.mediaDiaria !== null ? formatarValor(plaus.mediaDiaria) : null,
          saldoLabel: formatarValor(plaus.saldoAtual ?? 0),
        })
      : null;

    return (
      <Tela
        titulo="Perda — confira"
        camaraNome={camaraNome}
        operadorNome={nome}
        onVoltar={enviando ? undefined : () => setPasso("contexto")}
        etapa={pulouFormato ? 4 : 5}
        totalEtapas={totalEtapasPerda}
        rodape={
          mensagemAviso ? (
            <div className="flex flex-col gap-3">
              <AvisoOperador>{mensagemAviso}</AvisoOperador>
              <BotaoGrande variante="neutro" onClick={() => plaus.setConfirmouAviso(true)}>
                Confirmar mesmo assim
              </BotaoGrande>
            </div>
          ) : (
            <BotaoGrande variante="saida" onClick={confirmar} disabled={enviando}>
              {enviando ? "Enviando…" : erroDeRede ? "Tentar de novo" : "Confirmar perda"}
            </BotaoGrande>
          )
        }
      >
        <ResumoLancamento pesoKg={pesoKg} quantidadePacotes={formato.pesoVariavel ? null : num} linhas={linhas} />
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
// Enviar ou copiar marca o carregamento como compartilhado (tarefa 4 do
// adendo) — a partir daí o Desfazer fecha, porque o comprovante já pode estar
// na mão do cliente.
function ComprovanteSaida({
  token,
  carregamentoId,
  dados,
  onCompartilhado,
}: {
  token: string;
  carregamentoId: string;
  dados: DadosComprovante;
  onCompartilhado: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const marcarCompartilhado = useMutation(api.operador.desfazer.marcarComprovanteCompartilhado);
  const texto = textoComprovante(dados);
  const link = linkWhatsappComprovante(dados);

  function avisarCompartilhado() {
    onCompartilhado();
    marcarCompartilhado({ token, carregamentoId }).catch(() => {});
  }

  function abrirWhatsapp() {
    window.open(link, "_blank", "noopener");
    avisarCompartilhado();
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      avisarCompartilhado();
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  const contexto = linhasContexto(dados);
  const totalPacotes = totalPacotesComprovante(dados);

  const empresa = dados.empresa;
  const cabecalho = cabecalhoEmpresaEstruturado(empresa);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-borda bg-superficie">
        {/* De quem → pra quem → o quê (tarefa 7), em quatro blocos fixos que
            nunca truncam (correção "quatro ajustes pontuais", tarefa 2): o
            único documento que sai da empresa e chega ao cliente por
            WhatsApp não pode chegar anônimo, nem cortado no telefone. */}
        {cabecalho.nome ? (
          <div className="flex items-start gap-3 border-b border-borda px-4 py-3">
            {empresa?.logoUrl ? (
              <img src={empresa.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded object-contain" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-texto">{cabecalho.nome}</p>
              {cabecalho.linhaCnpj ? <p className="mt-0.5 text-sm text-texto-suave">{cabecalho.linhaCnpj}</p> : null}
              {cabecalho.endereco ? <p className="text-sm text-texto-suave">{cabecalho.endereco}</p> : null}
              {cabecalho.linhaContato ? <p className="text-sm text-texto-suave">{cabecalho.linhaContato}</p> : null}
            </div>
          </div>
        ) : null}
        <div className="border-b border-borda px-4 py-3">
          <div className="font-mono text-[11px] font-medium tracking-[0.1em] text-texto-fraco uppercase">
            Comprovante de saída
          </div>
          <div className="mt-0.5 text-base font-semibold text-texto">
            {dados.rotulo}{" "}
            <span className="font-mono text-sm font-normal text-texto-suave">{dataHoraComprovante(dados.quandoMs)}</span>
          </div>
        </div>

        {/* Cada produto é a âncora da sua linha; formato é metadado abaixo dele.
            Quantidade em pacotes é o destaque à direita, peso derivado abaixo
            (tarefa 5 — nunca uma string concatenada produto/formato/quantidade). */}
        <div className="border-b border-borda">
          {dados.itens.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-3 border-b border-borda/60 px-4 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-texto">{it.produtoNome}</p>
                <p className="truncate text-sm text-texto-suave">{it.formatoNome}</p>
              </div>
              <div className="shrink-0 text-right whitespace-nowrap">
                {it.quantidadePacotes !== null ? (
                  <>
                    <p className="font-mono text-base font-semibold text-texto">
                      {it.quantidadePacotes}
                      <span className="ml-1 font-sans text-sm font-normal text-texto-suave">
                        {it.quantidadePacotes === 1 ? "pacote" : "pacotes"}
                      </span>
                    </p>
                    <p className="font-mono text-sm text-texto-suave">{formatarPeso(it.pesoKg)}</p>
                  </>
                ) : (
                  <p className="font-mono text-base font-semibold text-texto">{formatarPeso(it.pesoKg)}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-3 border-b border-borda bg-superficie-fria/40 px-4 py-3">
          <dt className="text-base font-medium text-texto">Total</dt>
          <dd className="text-right">
            {totalPacotes > 0 ? (
              <>
                <span className="font-mono text-2xl font-semibold text-texto">{formatarPacotes(totalPacotes)}</span>
                <span className="ml-2 font-mono text-sm text-texto-suave">{formatarPeso(dados.pesoTotalKg)}</span>
              </>
            ) : (
              <span className="font-mono text-2xl font-semibold text-texto">{formatarPeso(dados.pesoTotalKg)}</span>
            )}
          </dd>
        </div>

        <dl>
          {contexto.map((l, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-3 border-b border-borda/60 px-4 py-2.5 last:border-0"
            >
              <dt className="min-w-0 flex-1 text-base text-texto-suave">{l.rotulo}</dt>
              <dd className={`shrink-0 text-right text-base text-texto ${l.mono ? "font-mono" : ""}`}>{l.valor}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between border-t border-borda px-4 py-2.5">
          <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-texto-fraco uppercase">
            Protocolo
          </span>
          <span className="font-mono text-sm text-texto">{dados.protocolo}</span>
        </div>
        <p className="border-t border-borda px-4 py-2 text-center text-[11px] text-texto-fraco">{SELO_NAO_FISCAL}</p>
      </div>

      <BotaoGrande variante="primario" onClick={abrirWhatsapp}>
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
