import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { mensagemErro } from "../lib/erros.ts";
import { formatarPacotes, formatarPeso } from "../lib/formato.ts";
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
        <ListaProdutos produtos={produtos} onEscolher={escolherProduto} />
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

export function ListaProdutos({
  produtos,
  onEscolher,
}: {
  produtos: ProdutoGrid[] | undefined;
  onEscolher: (p: ProdutoGrid) => void;
}) {
  if (produtos === undefined) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando produtos">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-h-[56px] animate-pulse rounded-xl border border-borda bg-superficie-fria" />
        ))}
      </div>
    );
  }
  if (produtos.length === 0) return <p className="text-base text-texto-suave">Nenhum produto nesta câmara.</p>;
  return (
    <div className="flex flex-col gap-3">
      {produtos.map((p) => (
        <OpcaoGrande key={p._id} titulo={p.nome} detalhe={p.categoria} onClick={() => onEscolher(p)} />
      ))}
    </div>
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
