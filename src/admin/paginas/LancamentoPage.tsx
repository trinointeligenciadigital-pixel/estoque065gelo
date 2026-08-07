import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Campo, Cartao, Selecao, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";
import { formatarPacotes, formatarPeso, rotuloFormato } from "../../lib/formato.ts";
import { rotuloProduto } from "../../lib/produto.ts";
import { mascaraPlaca, placaCompleta } from "../../lib/mascaras.ts";

/*
  Lançamento manual pelo Admin (RF63). Mesmas validações do colaborador: saldo,
  idempotência, sinal/pesoKg no servidor. Venda/patrocínio usam o fluxo de
  CARREGAMENTO: vários produtos numa mesma saída, gravados em lote (atômico).
  Produção e perda seguem um item por vez. A chave/carregamento é renovada após
  cada sucesso, para evitar duplicação por duplo-clique.
*/
type Tipo = "producao" | "venda" | "patrocinio" | "perda" | "transferencia";
type MotivoPerda = "derreteu" | "danificado" | "descarte" | "outro";

const rotuloMotivo: Record<MotivoPerda, string> = {
  derreteu: "Derreteu",
  danificado: "Danificado",
  descarte: "Descarte",
  outro: "Outro",
};

// Um item já anexado ao carregamento (venda/patrocínio).
type ItemCarregamento = {
  chave: string;
  produtoId: Id<"produtos">;
  formatoId: Id<"formatos">;
  produtoNome: string;
  formatoNome: string;
  pesoVariavel: boolean;
  valor: string;
  pesoKg: number;
};

export function LancamentoPage() {
  const produtos = useQuery(api.admin.lancamentos.produtosParaLancamento);
  const veiculos = useQuery(api.admin.veiculos.listar);
  const camaras = useQuery(api.admin.camaras.listar);
  const lancarProducao = useMutation(api.admin.lancamentos.lancarProducao);
  const lancarSaida = useMutation(api.admin.lancamentos.lancarSaida);
  const lancarSaidaMultipla = useMutation(api.admin.lancamentos.lancarSaidaMultipla);
  const transferir = useMutation(api.admin.transferencias.transferir);

  const [tipo, setTipo] = useState<Tipo>("producao");
  const [produtoId, setProdutoId] = useState<Id<"produtos"> | "">("");
  const [formatoId, setFormatoId] = useState<Id<"formatos"> | "">("");
  const [valor, setValor] = useState("");
  const [cliente, setCliente] = useState("");
  const [veiculoSel, setVeiculoSel] = useState("");
  const [veiculoTerceiro, setVeiculoTerceiro] = useState("");
  const [veiculoTerceiroModelo, setVeiculoTerceiroModelo] = useState("");
  const [motorista, setMotorista] = useState("");
  const [motivo, setMotivo] = useState<MotivoPerda | "">("");
  const [observacao, setObservacao] = useState("");
  const [itens, setItens] = useState<ItemCarregamento[]>([]);
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const [carregamentoId, setCarregamentoId] = useState(() => crypto.randomUUID());
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Transferência entre câmaras (tarefa 5) — origem usa os mesmos campos
  // Produto/Formato/Quantidade do resto do formulário; só o destino é próprio.
  const [camaraDestinoId, setCamaraDestinoId] = useState<Id<"camaras"> | "">("");
  const [observacaoTransferencia, setObservacaoTransferencia] = useState("");
  const [chaveTransferencia, setChaveTransferencia] = useState(() => crypto.randomUUID());

  // Agrupado por câmara — produtos homônimos em câmaras diferentes (ex.: dois
  // "Cubo") ficam em grupos separados, e o rótulo de cada opção leva a câmara
  // junto (necessário porque um <select> fechado só mostra o texto da opção
  // escolhida, não o rótulo do optgroup).
  const produtosPorCamara = useMemo(() => {
    const grupos = new Map<string, NonNullable<typeof produtos>>();
    for (const p of produtos ?? []) {
      const lista = grupos.get(p.camaraNome) ?? [];
      lista.push(p);
      grupos.set(p.camaraNome, lista);
    }
    return grupos;
  }, [produtos]);

  const produto = produtos?.find((p) => p._id === produtoId);
  const formato = produto?.formatos.find((f) => f._id === formatoId);
  const ehCarregamento = tipo === "venda" || tipo === "patrocinio";
  const ehTransferencia = tipo === "transferencia";

  // Ao trocar de produto, limpa o formato. Ao trocar de tipo, esvazia o carrinho
  // e a câmara de destino (evita levar uma escolha de uma transferência
  // anterior para a próxima, com outro produto de origem).
  useEffect(() => { setFormatoId(""); }, [produtoId]);
  useEffect(() => { setItens([]); setCamaraDestinoId(""); }, [tipo]);

  // Produto+formato de mesmo nome/peso na câmara de destino — nunca cria nada;
  // null bloqueia o envio com a mensagem de cadastro pendente (tarefa 5).
  const equivalente = useQuery(
    api.admin.transferencias.equivalente,
    ehTransferencia && produtoId && formatoId && camaraDestinoId
      ? { produtoOrigemId: produtoId, formatoOrigemId: formatoId, camaraDestinoId }
      : "skip",
  );
  const camaraDestinoNome = camaras?.find((c) => c._id === camaraDestinoId)?.nome ?? "—";

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

  const numVal = Number(valor);
  const valorValido = formato ? (formato.pesoVariavel ? numVal > 0 : Number.isInteger(numVal) && numVal > 0) : false;
  const itemStaged = !!produto && !!formato && valorValido;

  const contextoValido =
    tipo === "producao"
      ? true
      : tipo === "perda"
        ? motivo !== "" && (motivo !== "outro" || observacao.trim() !== "")
        : tipo === "transferencia"
          ? camaraDestinoId !== "" && !!equivalente
          : cliente.trim() !== "" && (veiculoSel !== "terceiro" || placaCompleta(veiculoTerceiro));

  // Itens que entram no carregamento: os já anexados + o em edição, se válido.
  function itemDoStaged(): ItemCarregamento | null {
    if (!produto || !formato || !valorValido) return null;
    return {
      chave: crypto.randomUUID(),
      produtoId: produto._id,
      formatoId: formato._id,
      produtoNome: produto.nome,
      formatoNome: rotuloFormato(formato),
      pesoVariavel: formato.pesoVariavel,
      valor,
      pesoKg: formato.pesoVariavel ? numVal : numVal * formato.pesoKg,
    };
  }

  const itensParaEnviar = ehCarregamento
    ? [...itens, ...(itemStaged ? [itemDoStaged()!] : [])]
    : [];
  const pesoTotal = itensParaEnviar.reduce((acc, it) => acc + it.pesoKg, 0);

  const podeEnviar = ehCarregamento
    ? itensParaEnviar.length > 0 && contextoValido && !enviando
    : !!produto && !!formato && valorValido && contextoValido && !enviando;

  function adicionarItem() {
    const it = itemDoStaged();
    if (!it) return;
    setItens((xs) => [...xs, it]);
    setProdutoId("");
    setFormatoId("");
    setValor("");
  }

  function removerItem(chaveItem: string) {
    setItens((xs) => xs.filter((x) => x.chave !== chaveItem));
  }

  function limparTudo() {
    setChave(crypto.randomUUID());
    setCarregamentoId(crypto.randomUUID());
    setChaveTransferencia(crypto.randomUUID());
    setProdutoId("");
    setFormatoId("");
    setValor("");
    setCliente("");
    setVeiculoSel("");
    setVeiculoTerceiro("");
    setVeiculoTerceiroModelo("");
    setMotorista("");
    setMotivo("");
    setObservacao("");
    setItens([]);
    setCamaraDestinoId("");
    setObservacaoTransferencia("");
  }

  async function confirmar() {
    setErro("");
    setMsg("");
    setEnviando(true);
    try {
      if (ehCarregamento) {
        if (itensParaEnviar.length === 0) return;
        await lancarSaidaMultipla({
          carregamentoId,
          tipo,
          itens: itensParaEnviar.map((it) => ({
            chaveIdempotencia: it.chave,
            produtoId: it.produtoId,
            formatoId: it.formatoId,
            quantidade: it.pesoVariavel ? undefined : Number(it.valor),
            pesoKgVariavel: it.pesoVariavel ? Number(it.valor) : undefined,
          })),
          clienteNome: cliente.trim(),
          veiculoId: veiculoSel && veiculoSel !== "terceiro" ? (veiculoSel as Id<"veiculos">) : undefined,
          veiculoTerceiro: veiculoSel === "terceiro" ? veiculoTerceiro || undefined : undefined,
          veiculoTerceiroModelo: veiculoSel === "terceiro" ? veiculoTerceiroModelo.trim() || undefined : undefined,
          motorista: motorista.trim() || undefined,
        });
        setMsg(`Carregamento registrado · ${itensParaEnviar.length} ${itensParaEnviar.length === 1 ? "produto" : "produtos"}.`);
        limparTudo();
        return;
      }

      if (tipo === "transferencia") {
        if (!produto || !formato || !camaraDestinoId || !equivalente) return;
        await transferir({
          chaveIdempotencia: chaveTransferencia,
          produtoOrigemId: produto._id,
          formatoOrigemId: formato._id,
          produtoDestinoId: equivalente.produtoId,
          formatoDestinoId: equivalente.formatoId,
          quantidade: formato.pesoVariavel ? undefined : numVal,
          pesoKgVariavel: formato.pesoVariavel ? numVal : undefined,
          observacao: observacaoTransferencia.trim() || undefined,
        });
        setMsg("Transferência registrada.");
        limparTudo();
        return;
      }

      if (!produto || !formato) return;
      const comum = {
        chaveIdempotencia: chave,
        produtoId: produto._id,
        formatoId: formato._id,
        quantidade: formato.pesoVariavel ? undefined : numVal,
        pesoKgVariavel: formato.pesoVariavel ? numVal : undefined,
      } as const;

      if (tipo === "producao") {
        await lancarProducao(comum);
      } else {
        await lancarSaida({
          ...comum,
          tipo: "perda",
          motivoPerda: (motivo || undefined) as MotivoPerda | undefined,
          observacao: observacao.trim() || undefined,
        });
      }
      setMsg("Lançamento registrado.");
      limparTudo();
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
            <option value="transferencia">Transferência (entre câmaras)</option>
          </Selecao>

          {/* Itens já anexados ao carregamento (venda/patrocínio) */}
          {ehCarregamento && itens.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-borda p-3">
              <span className="text-xs font-medium text-texto-suave">Itens do carregamento</span>
              {itens.map((it) => (
                <div key={it.chave} className="flex items-center gap-3 rounded border border-borda bg-superficie px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-texto">{it.produtoNome} <span className="text-texto-suave">/ {it.formatoNome}</span></p>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-texto">
                    {it.pesoVariavel ? "" : `${formatarPacotes(Number(it.valor))} × `}{formatarPeso(it.pesoKg)}
                  </span>
                  <button
                    onClick={() => removerItem(it.chave)}
                    aria-label={`Remover ${it.produtoNome}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-texto-suave transition outline-none hover:bg-superficie-fria hover:text-alerta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="flex items-baseline justify-between border-t border-borda pt-2">
                <span className="text-sm text-texto-suave">Peso total</span>
                <span className="font-mono text-sm font-semibold text-texto">{formatarPeso(pesoTotal)}</span>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Selecao label="Produto" value={produtoId} onChange={(e) => setProdutoId(e.target.value as Id<"produtos">)}>
              <option value="">— escolha —</option>
              {[...produtosPorCamara.entries()].map(([camaraNome, lista]) => (
                <optgroup key={camaraNome} label={camaraNome}>
                  {lista.map((p) => (
                    <option key={p._id} value={p._id}>{rotuloProduto(p.nome, p.camaraNome)}</option>
                  ))}
                </optgroup>
              ))}
            </Selecao>
            <Selecao label="Formato" value={formatoId} onChange={(e) => setFormatoId(e.target.value as Id<"formatos">)} disabled={!produto}>
              <option value="">— escolha —</option>
              {(produto?.formatos ?? []).map((f) => (
                <option key={f._id} value={f._id}>{rotuloFormato(f)}</option>
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
              <span className="pb-1.5 font-mono text-sm text-texto-suave">= {formatarPeso(pesoPrevisto)}</span>
            ) : null}
            {ehCarregamento ? (
              <Botao variante="neutro" onClick={adicionarItem} disabled={!itemStaged} className="ml-auto">
                + Adicionar item
              </Botao>
            ) : null}
          </div>

          {ehCarregamento ? (
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Campo
                      label="Placa do terceiro"
                      mono
                      value={veiculoTerceiro}
                      onChange={(e) => setVeiculoTerceiro(mascaraPlaca(e.target.value))}
                      placeholder="ABC1D23"
                      maxLength={7}
                    />
                    {veiculoTerceiro !== "" && !placaCompleta(veiculoTerceiro) ? (
                      <p className="mt-1 text-xs text-alerta">Formato: ABC-1234 ou ABC1D23.</p>
                    ) : null}
                  </div>
                  <Campo
                    label="Modelo / descrição (opcional)"
                    value={veiculoTerceiroModelo}
                    onChange={(e) => setVeiculoTerceiroModelo(e.target.value)}
                    placeholder="Van baú branca"
                  />
                </div>
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

          {ehTransferencia ? (
            <div className="flex flex-col gap-3">
              <Selecao
                label="Câmara de destino"
                value={camaraDestinoId}
                onChange={(e) => setCamaraDestinoId(e.target.value as Id<"camaras">)}
                disabled={!produto}
              >
                <option value="">— escolha —</option>
                {(camaras ?? [])
                  .filter((c) => c.ativo && c.nome !== produto?.camaraNome)
                  .map((c) => (
                    <option key={c._id} value={c._id}>{c.nome}</option>
                  ))}
              </Selecao>

              {produto && formato && camaraDestinoId ? (
                equivalente === undefined ? (
                  <p className="text-sm text-texto-suave">Verificando produto equivalente na câmara de destino…</p>
                ) : equivalente === null ? (
                  <Aviso>
                    Não há "{produto.nome} · {rotuloFormato(formato)}" cadastrado na câmara {camaraDestinoNome}.
                    Cadastre o produto antes de transferir.
                  </Aviso>
                ) : (
                  <div className="rounded-lg border border-borda bg-superficie-fria/40 p-3 text-sm text-texto">
                    <p>
                      {produto.nome}{" "}
                      <span className="text-texto-suave">
                        · {produto.camaraNome} → {camaraDestinoNome}
                      </span>
                    </p>
                    {valorValido ? (
                      <p className="mt-1 font-mono font-medium">
                        {formato.pesoVariavel
                          ? formatarPeso(numVal)
                          : `${formatarPacotes(numVal)} · ${formatarPeso(pesoPrevisto ?? 0)}`}
                      </p>
                    ) : null}
                  </div>
                )
              ) : null}

              <Campo
                label="Observação (opcional)"
                value={observacaoTransferencia}
                onChange={(e) => setObservacaoTransferencia(e.target.value)}
              />
            </div>
          ) : null}

          {erro ? <Aviso>{erro}</Aviso> : null}
          {msg ? <Aviso tom="info">{msg}</Aviso> : null}

          <div className="flex justify-end">
            <Botao onClick={confirmar} disabled={!podeEnviar}>
              {enviando ? "Enviando…" : ehCarregamento ? "Lançar carregamento" : ehTransferencia ? "Transferir" : "Lançar"}
            </Botao>
          </div>
        </div>
      </Cartao>
    </>
  );
}
