import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { UserButton } from "@clerk/clerk-react";
import {
  Building2,
  ClipboardCheck,
  Gift,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PlusCircle,
  ScrollText,
  ShieldCheck,
  Snowflake,
  Truck,
  Users,
  X,
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

const CHAVE_COLAPSADA = "estoque065:admin-sidebar-colapsada";

/*
  Casca do painel do Admin — densa, desktop (RNF12). Barra lateral com a marca
  da 065, a navegação (Operação + Cadastros), o usuário e o crédito da Trino.
  Visual "painel de instrumentos de câmara fria".

  Responsiva em três estados:
  - Celular/tablet estreito (<lg): a barra vira uma gaveta (drawer) fora da
    tela, aberta por um botão de menu no cabeçalho fixo; um véu escurece o
    conteúdo atrás dela (mesmo tratamento do Modal — a única "elevação" fora
    do sistema plano de bordas/tons).
  - Desktop (≥lg): barra fixa de 224px, sempre visível.
  - Desktop recolhida: o Admin pode encolhê-la para uma régua de ícones
    (72px); a preferência persiste no aparelho (localStorage).
*/
export function AdminShell({
  usuario,
}: {
  usuario: { nome: string; email: string; papel: string; ativo: boolean };
}) {
  const [colapsada, setColapsada] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_COLAPSADA) === "1";
    } catch {
      return false;
    }
  });
  const [abertaMobile, setAbertaMobile] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_COLAPSADA, colapsada ? "1" : "0");
    } catch {
      // Sem localStorage (modo privado etc.) — só não persiste a preferência.
    }
  }, [colapsada]);

  // Troca de página fecha a gaveta no celular, senão ela ficaria aberta por
  // cima da tela seguinte.
  useEffect(() => {
    setAbertaMobile(false);
  }, [pathname]);

  return (
    <div className="min-h-full bg-fundo lg:flex">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-borda bg-superficie px-4 py-3 lg:hidden">
        <button
          onClick={() => setAbertaMobile(true)}
          className="-ml-1.5 rounded-lg p-1.5 text-texto-suave transition hover:bg-superficie-fria hover:text-texto"
          aria-label="Abrir menu"
        >
          <Menu size={22} aria-hidden="true" />
        </button>
        <img
          src="/logo-065.png"
          alt=""
          className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-borda"
        />
        <div className="min-w-0 flex-1 font-titulo truncate text-[14px] font-semibold text-texto">Estoque 065</div>
        {/* Quem está logado precisa aparecer sem abrir a gaveta (senão o
            celular esquecido logado passa despercebido) — mesmo avatar do
            rodapé da barra, só que sempre visível aqui. */}
        <span className="shrink-0">
          <UserButton />
        </span>
      </header>

      {abertaMobile ? (
        <div
          className="fixed inset-0 z-40 bg-texto/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setAbertaMobile(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`fixed top-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-borda bg-superficie p-3 transition-[transform,width] duration-200 ease-out print:hidden lg:sticky lg:translate-x-0 ${
          abertaMobile ? "translate-x-0" : "-translate-x-full"
        } ${colapsada ? "lg:w-[72px]" : "lg:w-56"}`}
      >
        <div className={`flex items-center gap-2.5 px-2 pb-4 ${colapsada ? "lg:justify-center lg:px-0" : ""}`}>
          <img
            src="/logo-065.png"
            alt="065 Gelo"
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-borda"
          />
          <div className={`min-w-0 leading-tight ${colapsada ? "lg:hidden" : ""}`}>
            <div className="font-titulo truncate text-[15px] font-semibold text-texto">Estoque 065</div>
            <div className="truncate text-[10.5px] text-texto-fraco">065 Gelo · Cuiabá-MT</div>
          </div>
          <button
            onClick={() => setAbertaMobile(false)}
            className="ml-auto rounded-lg p-1 text-texto-suave transition hover:bg-superficie-fria hover:text-texto lg:hidden"
            aria-label="Fechar menu"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="flex flex-col gap-0.5">
          <ItemMenu para="/painel" rotulo="Painel" Icone={LayoutDashboard} colapsada={colapsada} />
          <ItemMenu para="/contagens" rotulo="Contagens" Icone={ClipboardCheck} colapsada={colapsada} />
          <ItemMenu para="/lancar" rotulo="Lançar" Icone={PlusCircle} colapsada={colapsada} />
          <ItemMenu para="/historico" rotulo="Histórico" Icone={ScrollText} colapsada={colapsada} />
          <ItemMenu para="/patrocinios" rotulo="Patrocínios" Icone={Gift} colapsada={colapsada} />
          <div
            className={`px-3 pt-4 pb-1.5 font-mono text-[9.5px] font-medium tracking-[0.12em] text-texto-fraco uppercase ${
              colapsada ? "lg:hidden" : ""
            }`}
          >
            Cadastros
          </div>
          <ItemMenu para="/camaras" rotulo="Câmaras" Icone={Snowflake} colapsada={colapsada} />
          <ItemMenu para="/produtos" rotulo="Produtos" Icone={Package} colapsada={colapsada} />
          <ItemMenu para="/veiculos" rotulo="Veículos" Icone={Truck} colapsada={colapsada} />
          <ItemMenu para="/operadores" rotulo="Colaboradores" Icone={Users} colapsada={colapsada} />
          <ItemMenu para="/administradores" rotulo="Administradores" Icone={ShieldCheck} colapsada={colapsada} />
          <ItemMenu para="/empresa" rotulo="Empresa" Icone={Building2} colapsada={colapsada} />
        </nav>

        <div className="mt-auto pt-4">
          <div className={`flex items-center gap-2.5 border-t border-borda px-1 pt-3 ${colapsada ? "lg:justify-center" : ""}`}>
            <UserButton />
            <div className={`min-w-0 leading-tight ${colapsada ? "lg:hidden" : ""}`}>
              <div className="truncate text-[12.5px] font-semibold text-texto">{usuario.nome}</div>
              <div className="text-[11px] text-texto-fraco">Administrador</div>
            </div>
          </div>
          <div className={`px-1 pt-3.5 ${colapsada ? "lg:hidden" : ""}`}>
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
          <button
            onClick={() => setColapsada((v) => !v)}
            className={`mt-3.5 hidden w-full items-center gap-2 rounded-lg border border-borda py-1.5 text-texto-suave transition hover:border-borda-forte hover:bg-superficie-fria hover:text-texto lg:flex ${
              colapsada ? "justify-center px-0" : "justify-center px-3"
            }`}
            aria-label={colapsada ? "Expandir menu" : "Recolher menu"}
            title={colapsada ? "Expandir menu" : "Recolher menu"}
          >
            {colapsada ? (
              <PanelLeftOpen size={16} aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose size={16} aria-hidden="true" />
                <span className="text-xs font-medium">Recolher</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <main key={pathname} className="animate-conteudo-entra min-w-0 flex-1 p-4 sm:p-6">
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

function ItemMenu({
  para,
  rotulo,
  Icone,
  colapsada,
}: {
  para: string;
  rotulo: string;
  Icone: LucideIcon;
  colapsada: boolean;
}) {
  return (
    <NavLink
      to={para}
      aria-label={rotulo}
      title={colapsada ? rotulo : undefined}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${
          colapsada ? "lg:justify-center lg:px-0" : ""
        } ${
          isActive
            ? "bg-superficie-fria-2 font-semibold text-acento"
            : "font-medium text-texto-suave hover:bg-superficie-fria hover:text-texto"
        }`
      }
    >
      <Icone size={17} strokeWidth={2} className="shrink-0" aria-hidden="true" />
      <span className={colapsada ? "lg:hidden" : ""}>{rotulo}</span>
    </NavLink>
  );
}
