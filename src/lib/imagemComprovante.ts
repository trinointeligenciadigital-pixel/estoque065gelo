import { useEffect, useState, type RefObject } from "react";
import { toBlob } from "html-to-image";
import { linkWhatsappComprovante, rotuloNumeroComprovante, type DadosComprovante } from "./comprovante.ts";
import { data } from "./data.ts";

/*
  Comprovante como IMAGEM (PNG) para mandar no WhatsApp. O link wa.me só aceita
  texto — o WhatsApp não deixa um link anexar arquivo. Para a imagem chegar como
  foto na conversa, o caminho é o menu de compartilhar do aparelho (Web Share
  API): a pessoa escolhe o WhatsApp lá. A imagem é uma "foto" do próprio
  ComprovanteCartao (renderizado fora da tela, largura fixa), então o que chega
  ao cliente é exatamente o que aparece na tela.

  A imagem é gerada ANTES do toque no botão (useImagemComprovante): o iPhone
  só abre o menu de compartilhar se ele for chamado logo depois do toque — se
  gerássemos a imagem no clique, o Safari recusaria.
*/

export const LARGURA_IMAGEM_COMPROVANTE = 420;

async function gerarImagem(el: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const opcoes = { pixelRatio: 3, backgroundColor: "#ffffff", cacheBust: true };
  try {
    const blob = await toBlob(el, opcoes);
    if (blob) return blob;
  } catch {
    // Normalmente é o logo vindo de outro endereço sem permissão para ser
    // embutido — tenta de novo sem imagens, em vez de não ter comprovante.
  }
  const semImagens = await toBlob(el, { ...opcoes, filter: (n) => !(n instanceof HTMLImageElement) });
  if (!semImagens) throw new Error("Não foi possível gerar a imagem do comprovante.");
  return semImagens;
}

export function nomeArquivoComprovante(d: DadosComprovante): string {
  const ref = d.numeroComprovante !== null ? String(d.numeroComprovante).padStart(6, "0") : d.protocolo;
  return `comprovante-${ref}.png`;
}

function legenda(d: DadosComprovante): string {
  const numero = d.numeroComprovante !== null ? ` ${rotuloNumeroComprovante(d.numeroComprovante)}` : "";
  return `Comprovante${numero} · ${d.rotulo} · ${data(d.quandoMs)}`;
}

// Gera (e regenera quando os dados mudam) o PNG do cartão apontado por `ref`.
// `imagem` null com `gerando` false = falhou; quem envia cai para o texto.
export function useImagemComprovante(ref: RefObject<HTMLElement | null>, dados: DadosComprovante) {
  const [imagem, setImagem] = useState<Blob | null>(null);
  const [gerando, setGerando] = useState(true);
  const chave = JSON.stringify(dados);
  useEffect(() => {
    let vivo = true;
    setImagem(null);
    setGerando(true);
    const el = ref.current;
    if (!el) {
      setGerando(false);
      return;
    }
    gerarImagem(el)
      .then((b) => { if (vivo) setImagem(b); })
      .catch(() => { if (vivo) setImagem(null); })
      .finally(() => { if (vivo) setGerando(false); });
    return () => { vivo = false; };
  }, [chave, ref]);
  return { imagem, gerando };
}

export function baixarImagem(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ResultadoEnvio = "compartilhado" | "cancelado" | "baixado" | "texto";

// Compartilha a imagem pelo menu do aparelho. Sem suporte (navegador antigo,
// alguns desktops): baixa o PNG e abre o WhatsApp com o texto, para a pessoa
// anexar a imagem salva. Sem imagem pronta: cai para o texto, como antes.
export async function enviarComprovante(d: DadosComprovante, blob: Blob | null): Promise<ResultadoEnvio> {
  if (blob) {
    const arquivo = new File([blob], nomeArquivoComprovante(d), { type: "image/png" });
    if (navigator.canShare?.({ files: [arquivo] })) {
      try {
        await navigator.share({ files: [arquivo], text: legenda(d) });
        return "compartilhado";
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return "cancelado";
        // NotAllowedError e afins: segue para o plano B abaixo.
      }
    }
    baixarImagem(blob, arquivo.name);
  }
  window.open(linkWhatsappComprovante(d), "_blank", "noopener");
  return blob ? "baixado" : "texto";
}
