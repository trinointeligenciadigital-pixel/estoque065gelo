import { useEffect } from "react";

/*
  "Voltar" físico do celular dentro do app do colaborador.

  Toda a navegação do operador é estado React (menu → fluxo → passos), não rotas.
  Sem isso, o botão voltar do Android sairia do fluxo e perderia o lançamento.

  Estratégia "buffer de histórico": mantemos sempre UMA entrada-tampão no histórico
  do navegador (mesma URL /c/:qrToken, então o react-router não é afetado). Ao
  apertar voltar, interceptamos o popstate, chamamos o `onVoltar` da tela atual (um
  passo para trás) e recolocamos a tampão. Sem handler (menu/raiz), deixamos sair.

  Só há uma `Tela` montada por vez, então basta um handler global.
*/
const refVoltar: { handler: (() => void) | null } = { handler: null };

// Garante que existe a entrada-tampão à frente (idempotente). Mantém a URL atual.
function garantirBuffer() {
  if (!window.history.state?.opBuffer) {
    window.history.pushState({ opBuffer: true }, "");
  }
}

// A tela atual registra seu "voltar". Passa `undefined` = sem voltar (menu/raiz).
export function useVoltarHardware(handler?: () => void) {
  useEffect(() => {
    refVoltar.handler = handler ?? null;
    if (handler) garantirBuffer(); // toda tela com voltar assegura a tampão
    return () => {
      // Só limpa se ainda for este handler (a próxima tela pode já ter assumido).
      if (refVoltar.handler === (handler ?? null)) refVoltar.handler = null;
    };
  }, [handler]);
}

// Instala o buffer + listener enquanto o app do operador estiver montado.
export function instalarVoltarHardware(): () => void {
  garantirBuffer();
  function onPop() {
    const h = refVoltar.handler;
    if (h) {
      h(); // um passo para trás dentro do app
      garantirBuffer(); // re-arma a tampão para o próximo voltar
    }
    // sem handler: não faz nada — o pop segue e sai da tela do operador
  }
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}
