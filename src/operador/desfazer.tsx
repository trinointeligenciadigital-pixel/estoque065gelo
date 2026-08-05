import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { mensagemErro } from "../lib/erros.ts";
import { AvisoOperador, BotaoGrande } from "./ui.tsx";

/*
  "Desfazer" (sprint PWA, tarefa 5) — visível por 5 minutos depois de um
  lançamento, depois some. Chama convex/operador/desfazer.ts, que revalida a
  janela no servidor (o timer aqui é só pra UI decidir quando esconder o
  botão; quem impede de verdade é o servidor).
*/
const JANELA_MS = 5 * 60 * 1000;

function useJanelaDesfazer(quandoMs: number | null): { restanteMs: number; expirada: boolean } {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (quandoMs === null) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [quandoMs]);

  if (quandoMs === null) return { restanteMs: 0, expirada: true };
  const restanteMs = Math.max(0, quandoMs + JANELA_MS - agora);
  return { restanteMs, expirada: restanteMs <= 0 };
}

// "4:32" — minutos:segundos restantes, pro rótulo do botão.
function rotuloContagem(restanteMs: number): string {
  const totalSeg = Math.ceil(restanteMs / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${min}:${String(seg).padStart(2, "0")}`;
}

export function BotaoDesfazer({
  token,
  lancamentoId,
  quandoMs,
  onDesfeito,
}: {
  token: string;
  lancamentoId: Id<"movimentacoes">;
  quandoMs: number;
  onDesfeito: () => void;
}) {
  const { restanteMs, expirada } = useJanelaDesfazer(quandoMs);
  const desfazer = useMutation(api.operador.desfazer.desfazerMeuLancamento);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  if (expirada) return null;

  async function tentar() {
    setErro("");
    setEnviando(true);
    try {
      await desfazer({ token, lancamentoId });
      onDesfeito();
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <BotaoGrande variante="neutro" onClick={tentar} disabled={enviando}>
        {enviando ? "Desfazendo…" : `Desfazer (${rotuloContagem(restanteMs)})`}
      </BotaoGrande>
      {erro ? <AvisoOperador>{erro}</AvisoOperador> : null}
    </div>
  );
}

/*
  Desfazer de um CARREGAMENTO (venda/patrocínio, adendo PWA tarefa 4) — mesma
  janela de 5 min, mas com duas diferenças do desfazer simples:
  1. Some assim que o comprovante foi enviado/copiado (`compartilhado`), com
     uma linha explicando por quê, em vez de simplesmente desaparecer sem
     dizer nada.
  2. Confirmação inline nomeando o protocolo antes de cancelar — venda tira
     produto de verdade e o comprovante pode já ter circulado; não é um toque
     só, como em produção.
*/
export function BotaoDesfazerCarregamento({
  token,
  carregamentoId,
  protocolo,
  quandoMs,
  compartilhado,
  onDesfeito,
}: {
  token: string;
  carregamentoId: string;
  protocolo: string;
  quandoMs: number;
  compartilhado: boolean;
  onDesfeito: () => void;
}) {
  const { restanteMs, expirada } = useJanelaDesfazer(quandoMs);
  const desfazer = useMutation(api.operador.desfazer.desfazerMeuCarregamento);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  if (expirada) return null;

  if (compartilhado) {
    return (
      <p className="text-center text-sm text-texto-suave">
        Comprovante já enviado. Para corrigir, procure o administrador.
      </p>
    );
  }

  async function tentar() {
    setErro("");
    setEnviando(true);
    try {
      await desfazer({ token, carregamentoId });
      onDesfeito();
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
      setConfirmando(false);
    }
  }

  if (confirmando) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-borda bg-superficie p-3">
        <p className="text-center text-sm text-texto">
          O comprovante <span className="font-mono font-medium">{protocolo}</span> será cancelado. Confirma?
        </p>
        <div className="flex gap-2">
          <BotaoGrande variante="neutro" onClick={() => setConfirmando(false)} disabled={enviando} className="flex-1">
            Cancelar
          </BotaoGrande>
          <BotaoGrande variante="saida" onClick={tentar} disabled={enviando} className="flex-1">
            {enviando ? "Desfazendo…" : "Sim, desfazer"}
          </BotaoGrande>
        </div>
        {erro ? <AvisoOperador>{erro}</AvisoOperador> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <BotaoGrande variante="neutro" onClick={() => setConfirmando(true)}>
        {`Desfazer (${rotuloContagem(restanteMs)})`}
      </BotaoGrande>
      {erro ? <AvisoOperador>{erro}</AvisoOperador> : null}
    </div>
  );
}
