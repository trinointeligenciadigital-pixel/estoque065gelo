import { QRCodeSVG } from "qrcode.react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Botao, BotaoLink } from "../../shared/ui.tsx";

/*
  Visualização e impressão do QR de uma câmara (RF19). O QR codifica a URL que o
  operador abre ao escanear. Reimprimir NÃO muda o qrToken — ele é sempre o
  mesmo valor já salvo na câmara. Ao imprimir, cabeçalho e menu somem (print:hidden
  na casca); sobra o cartão com o nome legível e o código.
*/
export function CamaraQrPage() {
  const { id } = useParams<{ id: string }>();
  const camaras = useQuery(api.admin.camaras.listar);

  if (camaras === undefined) {
    return <p className="text-sm text-texto-suave">Carregando…</p>;
  }

  const camara = camaras.find((c) => c._id === id);
  if (!camara) {
    return (
      <div>
        <p className="text-sm text-texto-suave">Câmara não encontrada.</p>
        <Link to="/camaras" className="text-sm text-acento hover:underline">Voltar</Link>
      </div>
    );
  }

  const url = `${window.location.origin}/c/${camara.qrToken}`;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <BotaoLink to="/camaras">Voltar</BotaoLink>
        <Botao onClick={() => window.print()}>Imprimir</Botao>
      </div>

      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 rounded-lg border border-borda bg-superficie p-8 text-center">
        <div>
          <p className="text-xs tracking-wide text-texto-suave uppercase">Estoque 065</p>
          <h1 className="mt-1 text-2xl font-semibold text-texto">{camara.nome}</h1>
        </div>
        <QRCodeSVG value={url} size={240} level="M" />
        <p className="text-sm text-texto-suave">
          Aponte a câmera do celular para o código para acessar esta câmara.
        </p>
      </div>

      <p className="mt-4 text-center text-xs text-texto-suave print:hidden">
        Para testar no computador, abra:{" "}
        <a href={url} target="_blank" rel="noreferrer" className="break-all text-acento underline">
          {url}
        </a>
      </p>
    </div>
  );
}
