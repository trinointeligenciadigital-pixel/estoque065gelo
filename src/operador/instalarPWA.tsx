import { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";

/*
  Convite de instalação do PWA no iOS (sprint PWA, tarefa 7). O Safari não tem
  o prompt nativo do Android (beforeinstallprompt) — o único jeito é instruir
  "Compartilhar → Adicionar à Tela de Início". Aparece uma vez por aparelho, na
  primeira visita; some para sempre depois de dispensado ou depois que a pessoa
  já instalou (não insiste).
*/
const CHAVE_DISPENSADO = "pwa065:convite-dispensado";

function estaInstalado(): boolean {
  return (
    (window.navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function ehIOS(): boolean {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent) && !("MSStream" in window);
}

export function ConvitePwaIOS() {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (!ehIOS() || estaInstalado()) return;
    try {
      if (localStorage.getItem(CHAVE_DISPENSADO)) return;
    } catch {
      return;
    }
    setVisivel(true);
  }, []);

  function dispensar() {
    setVisivel(false);
    try {
      localStorage.setItem(CHAVE_DISPENSADO, "1");
    } catch {
      // Sem localStorage: some só desta vez — não trava o uso do app por isso.
    }
  }

  if (!visivel) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar o Estoque 065"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-borda bg-superficie px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4"
    >
      <div className="flex items-start gap-3">
        <img src="/logo-065.png" alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-borda" />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-base font-medium text-texto">Instale o Estoque 065</p>
          <p className="mt-1 text-sm text-texto-suave">
            Toque em <Share size={14} className="inline -mt-0.5" aria-hidden="true" /> Compartilhar, depois em{" "}
            <SquarePlus size={14} className="inline -mt-0.5" aria-hidden="true" /> Adicionar à Tela de Início.
          </p>
        </div>
        <button
          onClick={dispensar}
          aria-label="Dispensar"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-texto-suave transition outline-none hover:bg-superficie-fria focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
