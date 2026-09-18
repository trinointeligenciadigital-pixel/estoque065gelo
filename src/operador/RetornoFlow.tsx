import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { mensagemErro } from "../lib/erros.ts";
import { data } from "../lib/data.ts";
import { normalizarBusca } from "../lib/busca.ts";
import { formatarQuantidade, rotuloFormato } from "../lib/formato.ts";
import { AvisoOperador, BotaoGrande, EstadoVazio, primeiroNome, Tela } from "./ui.tsx";

function formatarQtd(
  n: number,
  p: { formatoPesoVariavel: boolean; formatoUnidadeContagem?: "pacote" | "unidade" | null },
): string {
  return formatarQuantidade(n, { pesoVariavel: p.formatoPesoVariavel, unidadeContagem: p.formatoUnidadeContagem });
}

function rotuloFormatoPatrocinio(p: Patrocinio): string {
  return rotuloFormato({
    nome: p.formatoNome,
    pesoKg: p.formatoPesoKg,
    pesoVariavel: p.formatoPesoVariavel,
    unidadesPorPacote: p.formatoUnidadesPorPacote,
  });
}

/*
  Retorno de patrocínio (RF38–RF41). O colaborador escolhe a MOVIMENTAÇÃO de
  origem (não só o cliente): a lista mostra data, produto, formato e quanto ainda
  está em aberto — o que distingue dois patrocínios do mesmo cliente. Produto,
  câmara e formato são herdados da origem; o servidor barra retorno acima do que saiu.
*/
type Patrocinio = {
  origemId: Id<"movimentacoes">;
  registradoEm: number;
  produtoNome: string;
  formatoNome: string;
  formatoPesoKg: number;
  formatoUnidadesPorPacote: number | null;
  formatoUnidadeContagem: "pacote" | "unidade";
  formatoPesoVariavel: boolean;
  clienteNome: string;
  saido: number;
  retornado: number;
  aberto: number;
  unidade: string;
};

export function RetornoFlow({
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
  const abertos = useQuery(api.operador.consulta.patrociniosAbertos, { token });
  const lancar = useMutation(api.operador.lancamentos.lancarRetorno);

  const [alvo, setAlvo] = useState<Patrocinio | null>(null);
  const [valor, setValor] = useState("");
  const [chave, setChave] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [protocolo, setProtocolo] = useState("");
  // Busca por cliente/produto (mesmo padrão de ListaProdutos) — sem isso, uma
  // câmara com vários patrocínios em aberto ao mesmo tempo só dá pra achar
  // rolando a lista inteira.
  const [busca, setBusca] = useState("");

  function escolher(p: Patrocinio) {
    setAlvo(p);
    setValor("");
    setChave(crypto.randomUUID());
    setErro("");
  }

  async function confirmar() {
    if (!alvo) return;
    setErro("");
    setEnviando(true);
    try {
      const num = Number(valor);
      const r = await lancar({
        token,
        chaveIdempotencia: chave,
        patrocinioOrigemId: alvo.origemId,
        quantidade: alvo.formatoPesoVariavel ? undefined : num,
        pesoKgVariavel: alvo.formatoPesoVariavel ? num : undefined,
      });
      setProtocolo(r.protocolo);
      setSucesso(true);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (sucesso) {
    const num = Number(valor);
    return (
      <Tela titulo="Retorno lançado" camaraNome={camaraNome} operadorNome={nome} aoVoltarHardware={onVoltar}>
        <AvisoOperador tom="ok">
          Retorno registrado:{" "}
          <span className="font-numero">{formatarQtd(num, alvo ?? { formatoPesoVariavel: false })}</span>
          {alvo ? ` · ${alvo.produtoNome} · ${rotuloFormatoPatrocinio(alvo)}` : ""}.
          {protocolo ? <span className="ml-1.5 font-mono text-sm">· {protocolo}</span> : null}
        </AvisoOperador>
        <div className="mt-6">
          <BotaoGrande variante="neutro" onClick={onVoltar}>Voltar</BotaoGrande>
        </div>
      </Tela>
    );
  }

  if (alvo) {
    const num = Number(valor);
    const valido = num > 0 && num <= alvo.aberto && (alvo.formatoPesoVariavel || Number.isInteger(num));
    return (
      <Tela
        titulo="Retorno — quantidade"
        camaraNome={`${alvo.produtoNome} · ${rotuloFormatoPatrocinio(alvo)}`}
        operadorNome={nome}
        onVoltar={() => setAlvo(null)}
        etapa={2}
        totalEtapas={2}
        rodape={
          <BotaoGrande variante="entrada" onClick={confirmar} disabled={!valido || enviando}>
            {enviando ? "Enviando…" : "Confirmar retorno"}
          </BotaoGrande>
        }
      >
        <p className="mb-3 text-base text-texto-suave">
          Cliente: <span className="text-texto">{alvo.clienteNome || "—"}</span>
          <br />
          Em aberto: <span className="font-numero text-texto">{formatarQtd(alvo.aberto, alvo)}</span>
        </p>
        <label className="flex flex-col gap-2">
          <span className="text-base font-medium text-texto">
            {alvo.formatoPesoVariavel ? "Peso a retornar (kg)" : "Quantidade a retornar"}
          </span>
          <input
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0"
            className="w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-center font-numero text-3xl text-texto outline-none focus:border-acento"
          />
        </label>
        {num > alvo.aberto ? (
          <p className="mt-2 text-center text-base text-alerta">
            Máximo em aberto: {formatarQtd(alvo.aberto, alvo)}.
          </p>
        ) : null}
        {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
      </Tela>
    );
  }

  return (
    <Tela titulo="Retorno de patrocínio" camaraNome={camaraNome} operadorNome={nome} onVoltar={onVoltar} etapa={1} totalEtapas={2}>
      {abertos === undefined ? (
        <p className="text-base text-texto-suave">Carregando…</p>
      ) : abertos.length === 0 ? (
        <EstadoVazio mensagem="Nenhum patrocínio em aberto nesta câmara." onVoltar={onVoltar} />
      ) : (
        <div className="flex flex-col gap-3">
          {abertos.length > 4 ? (
            <input
              type="search"
              inputMode="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente ou produto…"
              aria-label="Buscar cliente ou produto"
              className="min-h-[56px] w-full rounded-xl border border-borda bg-superficie px-4 text-base text-texto outline-none focus:border-acento"
            />
          ) : null}
          {(() => {
            const termo = normalizarBusca(busca);
            const filtrados = termo === ""
              ? abertos
              : abertos.filter(
                  (p) => normalizarBusca(p.clienteNome).includes(termo) || normalizarBusca(p.produtoNome).includes(termo),
                );
            return filtrados.length === 0 ? (
              <p className="text-base text-texto-suave">Nenhum resultado para "{busca}".</p>
            ) : (
              filtrados.map((p) => (
                <button
                  key={p.origemId}
                  onClick={() => escolher(p)}
                  className="flex items-center gap-3 rounded-xl border border-borda bg-superficie px-4 py-3 text-left transition outline-none hover:bg-superficie-fria focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:brightness-95"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-base font-medium text-texto">{p.clienteNome || "Sem cliente"}</span>
                    <span className="text-sm text-texto-suave">
                      {p.produtoNome} · {rotuloFormatoPatrocinio(p)} · {data(p.registradoEm)}
                    </span>
                    <span className="font-numero text-sm text-acento">
                      em aberto: {formatarQtd(p.aberto, p)}
                    </span>
                  </span>
                  <ChevronRight size={22} className="shrink-0 text-texto-fraco" aria-hidden="true" />
                </button>
              ))
            );
          })()}
        </div>
      )}
    </Tela>
  );
}
