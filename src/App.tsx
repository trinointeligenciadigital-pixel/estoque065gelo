import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";

/*
  Estoque 065 — dois produtos no mesmo app:
    /c/:qrToken  -> operador (público até o PIN, arejado, celular)
    /*           -> Admin (autenticado via Clerk, denso, desktop)
  As rotas internas do Admin ficam dentro da casca do Admin.

  Carregados sob demanda (lazy): um colaborador abrindo pelo QR na porta da
  câmara nunca precisa baixar o Clerk nem as 10 páginas do Admin, e o Admin
  nunca precisa dos fluxos do colaborador — as duas cascas são mutuamente
  exclusivas por rota, então dividir aqui é puro ganho, sem risco de
  precisar dos dois ao mesmo tempo.
*/
const AdminApp = lazy(() => import("./admin/AdminApp.tsx").then((m) => ({ default: m.AdminApp })));
const OperadorApp = lazy(() => import("./operador/OperadorApp.tsx").then((m) => ({ default: m.OperadorApp })));

function Carregando() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-fundo p-6 text-sm text-texto-suave">Carregando…</div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/c/:qrToken" element={<OperadorApp />} />
        <Route path="/*" element={<AdminApp />} />
      </Routes>
    </Suspense>
  );
}
