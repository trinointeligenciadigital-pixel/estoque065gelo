import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { UserButton } from "@clerk/clerk-react";
import {
  Building2,
  ClipboardCheck,
  Gift,
  LayoutDashboard,
  type LucideIcon,
  Package,
  PlusCircle,
  ScrollText,
  ShieldCheck,
  Snowflake,
  Truck,
  Users,
} from "lucide-react";
import { PainelPage } from "./paginas/PainelPage.tsx";
import { CamarasPage } from "./paginas/CamarasPage.tsx";
import { CamaraQrPage } from "./paginas/CamaraQrPage.tsx";
import { ProdutosPage } from "./paginas/ProdutosPage.tsx";
import { FormatosPage } from "./paginas/FormatosPage.tsx";
import { VeiculosPage } from "./paginas/VeiculosPage.tsx";
import { OperadoresPage } from "./paginas/OperadoresPage.tsx";
import { ContagensPage } from "./paginas/ContagensPage.tsx";
import { HistoricoPage } from "./paginas/HistoricoPage.tsx";
import { AdministradoresPage } from "./paginas/AdministradoresPage.tsx";
import { LancamentoPage } from "./paginas/LancamentoPage.tsx";
import { PatrociniosPage } from "./paginas/PatrociniosPage.tsx";
import { EmpresaPage } from "./paginas/EmpresaPage.tsx";

/*
  Casca do painel do Admin — densa, desktop (RNF12). Barra lateral fixa com a
  marca da 065, a navegação (Operação + Cadastros), o usuário e o crédito da
  Trino. Visual "painel de instrumentos de câmara fria".
*/
export function AdminShell({
  usuario,
}: {
  usuario: { nome: string; email: string; papel: string; ativo: boolean };
}) {
  return (
    <div className="flex min-h-full bg-fundo">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-borda bg-superficie p-3 print:hidden">
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <img
            src="/logo-065.png"
            alt="065 Gelo"
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-borda"
          />
          <div className="leading-tight">
            <div className="font-titulo text-[15px] font-semibold text-texto">Estoque 065</div>
            <div className="text-[10.5px] text-texto-fraco">065 Gelo · Cuiabá-MT</div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          <ItemMenu para="/painel" rotulo="Painel" Icone={LayoutDashboard} />
          <ItemMenu para="/contagens" rotulo="Contagens" Icone={ClipboardCheck} />
          <ItemMenu para="/lancar" rotulo="Lançar" Icone={PlusCircle} />
          <ItemMenu para="/historico" rotulo="Histórico" Icone={ScrollText} />
          <ItemMenu para="/patrocinios" rotulo="Patrocínios" Icone={Gift} />
          <div className="px-3 pt-4 pb-1.5 font-mono text-[9.5px] font-medium tracking-[0.12em] text-texto-fraco uppercase">
            Cadastros
          </div>
          <ItemMenu para="/camaras" rotulo="Câmaras" Icone={Snowflake} />
          <ItemMenu para="/produtos" rotulo="Produtos" Icone={Package} />
          <ItemMenu para="/veiculos" rotulo="Veículos" Icone={Truck} />
          <ItemMenu para="/operadores" rotulo="Colaboradores" Icone={Users} />
          <ItemMenu para="/administradores" rotulo="Administradores" Icone={ShieldCheck} />
          <ItemMenu para="/empresa" rotulo="Empresa" Icone={Building2} />
        </nav>

        <div className="mt-auto pt-4">
          <div className="flex items-center gap-2.5 border-t border-borda px-1 pt-3">
            <UserButton />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[12.5px] font-semibold text-texto">{usuario.nome}</div>
              <div className="text-[11px] text-texto-fraco">Administrador</div>
            </div>
          </div>
          <div className="px-1 pt-3.5">
            <div className="font-mono text-[8.5px] font-medium tracking-[0.11em] text-texto-fraco uppercase">
              Desenvolvido por
            </div>
            {/* Logo quadrado (720×720) recortado só na faixa da palavra, via
               object-cover, para não sobrar espaço em branco no rodapé. */}
            <div className="mt-1 h-[26px] w-[120px] overflow-hidden">
              <img
                src="/logo-trino.png"
                alt="Trino Inteligência Digital"
                className="h-full w-full object-cover object-center"
              />
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-6">
        <Routes>
          <Route index element={<Navigate to="/painel" replace />} />
          <Route path="painel" element={<PainelPage />} />
          <Route path="contagens" element={<ContagensPage />} />
          <Route path="lancar" element={<LancamentoPage />} />
          <Route path="historico" element={<HistoricoPage />} />
          <Route path="patrocinios" element={<PatrociniosPage />} />
          <Route path="camaras" element={<CamarasPage />} />
          <Route path="camaras/:id/qr" element={<CamaraQrPage />} />
          <Route path="produtos" element={<ProdutosPage />} />
          <Route path="produtos/:produtoId/formatos" element={<FormatosPage />} />
          <Route path="veiculos" element={<VeiculosPage />} />
          <Route path="operadores" element={<OperadoresPage />} />
          <Route path="administradores" element={<AdministradoresPage />} />
          <Route path="empresa" element={<EmpresaPage />} />
          <Route path="*" element={<Navigate to="/painel" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function ItemMenu({ para, rotulo, Icone }: { para: string; rotulo: string; Icone: LucideIcon }) {
  return (
    <NavLink
      to={para}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${
          isActive
            ? "bg-superficie-fria-2 font-semibold text-acento"
            : "font-medium text-texto-suave hover:bg-superficie-fria hover:text-texto"
        }`
      }
    >
      <Icone size={17} strokeWidth={2} className="shrink-0" aria-hidden="true" />
      {rotulo}
    </NavLink>
  );
}
