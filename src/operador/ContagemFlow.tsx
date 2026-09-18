import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { mensagemErro } from "../lib/erros.ts";
import { nomeUnidade, rotuloFormato } from "../lib/formato.ts";
import { AvisoOperador, BotaoGrande, EstadoVazio, primeiroNome, Tela } from "./ui.tsx";

/*
  Contagem física do colaborador (RF46–RF50). ÀS CEGAS: a tela nunca mostra o saldo
  do sistema — a query da lista não traz esse dado (RF48). O colaborador digita o
  contado de cada formato; ao fechar, o servidor congela a foto do saldo e calcula
  a divergência. A decisão é do Admin, depois.
*/
export function ContagemFlow({
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
  const estado = useQuery(api.operador.contagem.estado, { token });
  const abrir = useMutation(api.operador.contagem.abrir);

  const [contagemId, setContagemId] = useState<Id<"contagens"> | null>(null);
  const [erro, setErro] = useState("");
  const [abrindo, setAbrindo] = useState(false);

  async function iniciar() {
    setErro("");
    setAbrindo(true);
    try {
      const r = await abrir({ token });
      setContagemId(r.contagemId);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAbrindo(false);
    }
  }

  // Já contando (retomando uma contagem aberta por mim, ou recém-aberta agora).
  if (contagemId) {
    return (
      <Preenchimento
        token={token}
        camaraNome={camaraNome}
        operadorNome={operadorNome}
        contagemId={contagemId}
        onVoltar={onVoltar}
      />
    );
  }

  if (estado === undefined) {
    return (
      <Tela titulo="Contagem" camaraNome={camaraNome} operadorNome={nome} onVoltar={onVoltar}>
        <p className="text-base text-texto-suave">Carregando…</p>
      </Tela>
    );
  }

  if (estado.situacao === "minha" && estado.contagemId) {
    return (
      <Preenchimento
        token={token}
        camaraNome={camaraNome}
        operadorNome={operadorNome}
        contagemId={estado.contagemId}
        onVoltar={onVoltar}
      />
    );
  }

  if (estado.situacao === "pendente") {
    return (
      <Tela titulo="Contagem" camaraNome={camaraNome} operadorNome={nome} onVoltar={onVoltar}>
        <AvisoOperador>Já existe uma contagem desta câmara aguardando o Admin. Fale com ele.</AvisoOperador>
      </Tela>
    );
  }

  if (estado.situacao === "de_outro") {
    return (
      <Tela titulo="Contagem" camaraNome={camaraNome} operadorNome={nome} onVoltar={onVoltar}>
        <AvisoOperador>Outra pessoa já está contando esta câmara agora.</AvisoOperador>
      </Tela>
    );
  }

  // Nenhuma: pode iniciar.
  return (
    <Tela
      titulo="Contagem"
      camaraNome={camaraNome}
      operadorNome={nome}
      onVoltar={onVoltar}
      rodape={
        <BotaoGrande onClick={iniciar} disabled={abrindo}>
          {abrindo ? "Abrindo…" : "Iniciar contagem"}
        </BotaoGrande>
      }
    >
      <p className="text-base text-texto-suave">
        Conte o que há na câmara, formato por formato. Você não vê o saldo do sistema — é conferência às cegas.
        Ao terminar, envie para o Admin conferir.
      </p>
      {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
    </Tela>
  );
}

function Preenchimento({
  token,
  camaraNome,
  operadorNome,
  contagemId,
  onVoltar,
}: {
  token: string;
  camaraNome: string;
  operadorNome: string;
  contagemId: Id<"contagens">;
  onVoltar: () => void;
}) {
  const nome = primeiroNome(operadorNome);
  const grid = useQuery(api.operador.consulta.gridProdutos, { token });
  const fechar = useMutation(api.operador.contagem.fechar);

  // Rascunho preso a esta contagem, salvo no aparelho: sobrevive a recarregar a
  // página ou a uma interrupção no meio da contagem (RF46–RF50). Some ao enviar.
  const chaveRascunho = `contagem065:${contagemId}`;
  const [contado, setContado] = useState<Record<string, string>>(() => {
    try {
      const bruto = localStorage.getItem(chaveRascunho);
      return bruto ? (JSON.parse(bruto) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(chaveRascunho, JSON.stringify(contado));
    } catch {
      // localStorage indisponível/cheio: segue sem persistir, não quebra a contagem.
    }
  }, [contado, chaveRascunho]);

  async function confirmar() {
    if (!grid) return;
    setErro("");
    setEnviando(true);
    try {
      const itens = grid.flatMap((p) =>
        p.formatos.map((f) => ({
          produtoId: p._id,
          formatoId: f._id,
          saldoContado: Number(contado[f._id]) || 0,
        })),
      );
      await fechar({ token, contagemId, itens });
      try {
        localStorage.removeItem(chaveRascunho);
      } catch {
        // sem problema: rascunho preso ao contagemId, não reaparece em outra contagem.
      }
      setSucesso(true);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (sucesso) {
    return (
      <Tela titulo="Contagem enviada" camaraNome={camaraNome} operadorNome={nome} aoVoltarHardware={onVoltar}>
        <AvisoOperador tom="ok">Contagem enviada para o Admin conferir. Obrigado!</AvisoOperador>
        <div className="mt-6">
          <BotaoGrande variante="neutro" onClick={onVoltar}>Voltar ao menu</BotaoGrande>
        </div>
      </Tela>
    );
  }

  return (
    <Tela
      titulo="Contagem — o que há na câmara"
      camaraNome={camaraNome}
      operadorNome={nome}
      onVoltar={onVoltar}
      rodape={
        <BotaoGrande onClick={confirmar} disabled={enviando || grid === undefined}>
          {enviando ? "Enviando…" : "Fechar contagem"}
        </BotaoGrande>
      }
    >
      {grid === undefined ? (
        <p className="text-base text-texto-suave">Carregando…</p>
      ) : grid.length === 0 ? (
        <EstadoVazio mensagem="Nenhum produto nesta câmara." onVoltar={onVoltar} />
      ) : (
        <div className="flex flex-col gap-5">
          {grid.map((p) => (
            <div key={p._id}>
              <h2 className="mb-2 text-base font-semibold text-texto">{p.nome}</h2>
              <div className="flex flex-col gap-2">
                {p.formatos.length === 0 ? (
                  <p className="text-sm text-texto-suave">Sem formatos ativos.</p>
                ) : (
                  p.formatos.map((f) => (
                    <label key={f._id} className="flex items-center justify-between gap-3">
                      <span className="text-base text-texto">
                        {rotuloFormato(f)}
                        <span className="ml-1 text-sm text-texto-suave">
                          ({f.pesoVariavel ? "kg" : nomeUnidade(f, 2)})
                        </span>
                      </span>
                      <input
                        inputMode="decimal"
                        value={contado[f._id] ?? ""}
                        onChange={(e) => setContado((c) => ({ ...c, [f._id]: e.target.value }))}
                        placeholder="0"
                        className="w-28 rounded-xl border border-borda bg-superficie px-3 py-3 text-center font-mono text-2xl text-texto outline-none focus:border-acento"
                      />
                    </label>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {erro ? <div className="mt-4"><AvisoOperador>{erro}</AvisoOperador></div> : null}
    </Tela>
  );
}
