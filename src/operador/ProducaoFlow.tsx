import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { mensagemErro } from "../lib/erros.ts";
import { formatarPacotes, formatarPeso } from "../lib/formato.ts";
import { normalizarBusca } from "../lib/busca.ts";
import { AvisoOperador, BotaoGrande, CampoQuantidade, kgDe, OpcaoGrande, ResumoLancamento, Tela } from "./ui.tsx";
import type { FormatoGrid, ProdutoGrid } from "./ui.tsx";

/*
  Lançar produção (RF26, RF31–RF34). Passos: produto → formato → quantidade →
  confirmar. A chave de idempotência é gerada ANTES do envio, uma por lançamento;
  a confirmação só acontece após o ACK do servidor (nunca otimista, RNF09).
*/
type Passo = "produto" | "formato" | "quantidade" | "revisar" | "sucesso";

export function ProducaoFlow({
  token,
  camaraNome,
  onVoltar,
}: {
  token: string;
  camaraNome: string;
  onVoltar: () => void;
}) {
  const produtos = useQuery(api.operador.consulta.gridProdutos, { token });
  const frequentes = useQuery(api.operador.consulta.produtosFrequentes, { token });
  const lancar = useMutation(api.operador.lancamentos.lancarProducao);

  const [passo, setPasso] = useState<Passo>("produto");
  const [produto, setProduto] = useState<ProdutoGrid | null>(null);
  const [formato, setFormato] = useState<FormatoGrid | null>(null);
  const [valor, setValor] = useState("");
  const [chave, setChave] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  function reiniciar() {
    setProduto(null);
    setFormato(null);
    setValor("");
    setChave("");
    setErro("");
    setPasso("produto");
  }

  // Formato único: nem mostra a lista de um item só — seleciona sozinho e já
  // pula pra quantidade (tarefa 2 do sprint PWA). O formato continua visível
  // no subtítulo da tela seguinte e na conferência; só o TOQUE some.
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

  function escolherFormato(f: FormatoGrid) {
    setFormato(f);
    setValor("");
    setChave(crypto.randomUUID()); // uma chave por lançamento
    setPasso("quantidade");
  }

  // Só sabemos se o passo de formato foi pulado depois que o produto é
  // escolhido — por isso a barra de progresso do passo "produto" usa o total
  // "cheio" (4) como padrão neutro.
  const pulouFormato = produto !== null && produto.formatos.length === 1;
  const totalEtapas = pulouFormato ? 3 : 4;

  async function confirmar() {
    if (!produto || !formato) return;
    setErro("");
    setEnviando(true);
    try {
      const num = Number(valor);
      await lancar({
        token,
        chaveIdempotencia: chave,
        produtoId: produto._id,
        formatoId: formato._id,
        quantidade: formato.pesoVariavel ? undefined : num,
        pesoKgVariavel: formato.pesoVariavel ? num : undefined,
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
    return (
      <Tela titulo="Produção lançada" camaraNome={camaraNome} aoVoltarHardware={onVoltar}>
        <AvisoOperador tom="ok">Registrado com sucesso.</AvisoOperador>
        {produto && formato ? (
          <div className="mt-4">
            <ResumoLancamento
              pesoKg={kgDe(formato, num, num)}
              linhas={[
                { rotulo: "Produto", valor: produto.nome },
                { rotulo: "Formato", valor: formato.nome },
                ...(formato.pesoVariavel
                  ? []
                  : [{ rotulo: "Quantidade", valor: formatarPacotes(num), mono: true }]),
              ]}
            />
          </div>
        ) : null}
        <div className="mt-6 flex flex-col gap-3">
          <BotaoGrande variante="entrada" onClick={reiniciar}>Lançar outra produção</BotaoGrande>
          <BotaoGrande variante="neutro" onClick={onVoltar}>Voltar ao menu</BotaoGrande>
        </div>
      </Tela>
    );
  }

  if (passo === "produto") {
    return (
      <Tela titulo="Produção — produto" camaraNome={camaraNome} onVoltar={onVoltar} etapa={1} totalEtapas={4}>
        <ListaProdutos produtos={produtos} frequentesIds={frequentes} onEscolher={escolherProduto} />
      </Tela>
    );
  }

  if (passo === "formato" && produto) {
    return (
      <Tela titulo="Produção — formato" camaraNome={produto.nome} onVoltar={() => setPasso("produto")} etapa={2} totalEtapas={4}>
        <ListaFormatos produto={produto} onEscolher={escolherFormato} />
      </Tela>
    );
  }

  if (passo === "quantidade" && produto && formato) {
    const num = Number(valor);
    const valido = formato.pesoVariavel ? num > 0 : Number.isInteger(num) && num > 0;
    return (
      <Tela
        titulo="Produção — quantidade"
        camaraNome={`${produto.nome} · ${formato.nome}`}
        onVoltar={() => setPasso(pulouFormato ? "produto" : "formato")}
        etapa={pulouFormato ? 2 : 3}
        totalEtapas={totalEtapas}
        rodape={
          <BotaoGrande variante="entrada" onClick={() => setPasso("revisar")} disabled={!valido}>
            Continuar
          </BotaoGrande>
        }
      >
        <CampoQuantidade formato={formato} valor={valor} onChange={setValor} />
      </Tela>
    );
  }

  if (passo === "revisar" && produto && formato) {
    const num = Number(valor);
    return (
      <Tela
        titulo="Produção — confira"
        camaraNome={camaraNome}
        onVoltar={() => setPasso("quantidade")}
        etapa={pulouFormato ? 3 : 4}
        totalEtapas={totalEtapas}
        rodape={
          <BotaoGrande variante="entrada" onClick={confirmar} disabled={enviando}>
            {enviando ? "Enviando…" : "Confirmar produção"}
          </BotaoGrande>
        }
      >
        <ResumoLancamento
          pesoKg={kgDe(formato, num, num)}
          linhas={[
            { rotulo: "Tipo", valor: "Produção (entrada)" },
            { rotulo: "Produto", valor: produto.nome },
            { rotulo: "Formato", valor: formato.nome },
            ...(formato.pesoVariavel
              ? []
              : [{ rotulo: "Quantidade", valor: formatarPacotes(num), mono: true }]),
            { rotulo: "Câmara", valor: camaraNome },
          ]}
        />
        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  return null;
}

// Lista de produtos com busca e atalho de "Frequentes" (tarefa 3 do sprint
// PWA). 19 produtos numa câmara e cinco rolagens pra achar o último era o
// problema real — busca sem acento e os mais usados no topo resolvem sem
// precisar rolar quase nunca.
export function ListaProdutos({
  produtos,
  frequentesIds,
  onEscolher,
}: {
  produtos: ProdutoGrid[] | undefined;
  frequentesIds?: Id<"produtos">[];
  onEscolher: (p: ProdutoGrid) => void;
}) {
  const [busca, setBusca] = useState("");

  if (produtos === undefined) {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Carregando produtos">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="min-h-[56px] animate-pulse rounded-xl border border-borda bg-superficie-fria" />
        ))}
      </div>
    );
  }
  if (produtos.length === 0) return <p className="text-base text-texto-suave">Nenhum produto nesta câmara.</p>;

  const buscando = normalizarBusca(busca) !== "";
  const filtrados = buscando
    ? produtos.filter((p) => normalizarBusca(p.nome).includes(normalizarBusca(busca)))
    : produtos;

  // Sem autofoco: o teclado cobriria o bloco de frequentes assim que a tela
  // abre. Some enquanto o operador está buscando — nesse momento ele já sabe
  // o que quer, o atalho vira ruído.
  const frequentes = buscando
    ? []
    : (frequentesIds ?? [])
        .map((id) => produtos.find((p) => p._id === id))
        .filter((p): p is ProdutoGrid => p !== undefined);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        inputMode="search"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar produto…"
        aria-label="Buscar produto"
        className="min-h-[56px] w-full rounded-xl border border-borda bg-superficie px-4 text-base text-texto outline-none focus:border-acento"
      />

      {frequentes.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-texto-fraco uppercase">
            Frequentes
          </span>
          <div className="flex flex-col gap-2">
            {frequentes.map((p) => (
              <LinhaProduto key={p._id} produto={p} onClick={() => onEscolher(p)} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {frequentes.length > 0 ? (
          <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-texto-fraco uppercase">
            Todos
          </span>
        ) : null}
        {filtrados.length === 0 ? (
          <p className="text-base text-texto-suave">Nenhum produto encontrado para "{busca}".</p>
        ) : (
          filtrados.map((p) => <LinhaProduto key={p._id} produto={p} onClick={() => onEscolher(p)} />)
        )}
      </div>
    </div>
  );
}

// Linha densa (~72px, toque ≥56px) — a mudança visual autorizada deste
// sprint (skill de design da Trino: "operador treinado, uso diário" pede
// denso). Saldo à direita: pacotes em destaque quando há só um formato (a
// única situação em que "N pacotes" é honesto); peso nos demais casos.
function LinhaProduto({ produto, onClick }: { produto: ProdutoGrid; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border border-borda bg-superficie px-4 py-2.5 text-left transition outline-none hover:bg-superficie-fria focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:brightness-95"
    >
      <span className="min-w-0 flex-1 truncate text-base font-medium text-texto">{produto.nome}</span>
      {produto.saldo ? (
        <span className="shrink-0 text-right leading-tight">
          <span className="block font-mono text-base font-semibold text-texto">
            {produto.saldo.pacotes !== null ? formatarPacotes(produto.saldo.pacotes) : formatarPeso(produto.saldo.pesoKg)}
          </span>
          {produto.saldo.pacotes !== null ? (
            <span className="block font-mono text-xs text-texto-suave">{formatarPeso(produto.saldo.pesoKg)}</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

export function ListaFormatos({
  produto,
  onEscolher,
}: {
  produto: ProdutoGrid;
  onEscolher: (f: FormatoGrid) => void;
}) {
  if (produto.formatos.length === 0) {
    return <p className="text-base text-texto-suave">Este produto não tem formato ativo.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {produto.formatos.map((f) => (
        <OpcaoGrande
          key={f._id}
          titulo={f.nome}
          detalhe={f.pesoVariavel ? "peso variável" : formatarPeso(f.pesoKg)}
          onClick={() => onEscolher(f)}
        />
      ))}
    </div>
  );
}
