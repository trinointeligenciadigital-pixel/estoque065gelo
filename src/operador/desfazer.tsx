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
