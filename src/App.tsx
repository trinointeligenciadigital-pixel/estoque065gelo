import { Routes, Route } from "react-router-dom";
import { AdminApp } from "./admin/AdminApp.tsx";
import { OperadorApp } from "./operador/OperadorApp.tsx";

/*
  Estoque 065 — dois produtos no mesmo app:
    /c/:qrToken  -> operador (público até o PIN, arejado, celular)
    /*           -> Admin (autenticado via Clerk, denso, desktop)
  As rotas internas do Admin ficam dentro da casca do Admin.
*/
export default function App() {
  return (
    <Routes>
      <Route path="/c/:qrToken" element={<OperadorApp />} />
      <Route path="/*" element={<AdminApp />} />
    </Routes>
  );
}
