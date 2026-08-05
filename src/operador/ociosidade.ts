import { useEffect, useRef } from "react";

/*
  Expiração por inatividade no cliente (sprint PWA, tarefa 6) — 20 minutos
  sem nenhum toque/tecla volta pro PIN. A garantia de verdade é no servidor
  (exigirSessaoOperadorMutavel, convex/lib/auth.ts): mutations reativas não
  disparam sozinhas só porque o tempo passou, então sem isto uma tela parada
  só descobriria a sessão expirada na próxima ação. Isto é a UI percebendo
  proativamente o que o servidor já teria recusado de qualquer forma.
*/
const INATIVIDADE_MS = 20 * 60 * 1000;
const EVENTOS: (keyof DocumentEventMap)[] = ["pointerdown", "keydown", "touchstart"];

export function useOciosidade(ativo: boolean, aoExpirar: () => void) {
  const aoExpirarRef = useRef(aoExpirar);
  aoExpirarRef.current = aoExpirar;

  useEffect(() => {
    if (!ativo) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    function reiniciar() {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => aoExpirarRef.current(), INATIVIDADE_MS);
    }

    reiniciar();
    EVENTOS.forEach((ev) => document.addEventListener(ev, reiniciar));
    return () => {
      clearTimeout(timeoutId);
      EVENTOS.forEach((ev) => document.removeEventListener(ev, reiniciar));
    };
  }, [ativo]);
}
