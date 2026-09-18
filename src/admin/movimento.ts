import { useEffect, useRef, useState } from "react";

/*
  Movimento do Painel do Admin — a ideia é uma só: "o nível sobe". Números
  contam até o valor, réguas enchem e as linhas do gráfico se erguem, tudo com
  a mesma desaceleração. Feito à mão (rAF), sem biblioteca, para não pesar no PWA.

  Quem pede menos movimento (prefers-reduced-motion) recebe o valor final na hora.
*/

export function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Desaceleração forte no começo, suave no fim — a mesma "sensação" do
// cubic-bezier(0.16, 1, 0.3, 1) usado nas animações em CSS.
export function suavizar(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return 1 - Math.pow(1 - t, 4);
}

/*
  Número que "sobe" até o valor real. Na primeira leitura parte de zero; quando o
  valor muda depois (lançamento novo chegando ao vivo), parte de onde estava e
  corre até o novo. Sem valor ainda (carregando) fica em zero.
*/
export function useNumeroAnimado(alvo: number | undefined, { duracao = 800, atraso = 0 } = {}): number {
  const [exibido, setExibido] = useState(() => (alvo !== undefined && movimentoReduzido() ? alvo : 0));
  const atual = useRef(exibido);
  const primeira = useRef(true);

  useEffect(() => {
    if (alvo === undefined) {
      atual.current = 0;
      primeira.current = true;
      setExibido(0);
      return;
    }
    if (movimentoReduzido()) {
      atual.current = alvo;
      setExibido(alvo);
      return;
    }
    const de = atual.current;
    const espera = primeira.current ? atraso : 0;
    const dur = primeira.current ? duracao : Math.min(duracao, 500);
    primeira.current = false;
    const inicio = performance.now() + espera;
    let raf = 0;
    const passo = (agora: number) => {
      const p = (agora - inicio) / dur;
      const v = p >= 1 ? alvo : de + (alvo - de) * suavizar(p);
      atual.current = v;
      setExibido(v);
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [alvo, duracao, atraso]);

  return exibido;
}

/*
  Progresso 0 → 1 de uma entrada (o gráfico se erguendo). Recomeça sempre que a
  `chave` muda (ex.: trocar o período). `pronto` avisa que terminou — é o
  momento de disparar o toque final.
*/
export function useEntrada(chave: unknown, { duracao = 1000, atraso = 150 } = {}): { t: number; pronto: boolean } {
  const [t, setT] = useState(() => (movimentoReduzido() ? 1 : 0));

  useEffect(() => {
    if (movimentoReduzido()) {
      setT(1);
      return;
    }
    setT(0);
    const inicio = performance.now() + atraso;
    let raf = 0;
    const passo = (agora: number) => {
      const p = Math.min(1, Math.max(0, (agora - inicio) / duracao));
      setT(p);
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [chave, duracao, atraso]);

  return { t, pronto: t >= 1 };
}
