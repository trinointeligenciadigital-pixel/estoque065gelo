import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LinhaMensagem, LinhaTabela, Tabela, TituloPagina } from "../../shared/ui.tsx";
import { data } from "../../lib/data.ts";

/*
  Consulta de patrocínio (RF42). Para cada patrocínio: quanto saiu, quanto voltou
  e quanto foi consumido. Somente leitura.
*/
function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function PatrociniosPage() {
  const lista = useQuery(api.admin.patrocinios.listar);

  return (
    <>
      <TituloPagina titulo="Patrocínios" subtitulo="Quanto saiu, quanto voltou e quanto foi consumido em cada patrocínio." />

      <Tabela
        colunas={[
          "Data",
          "Cliente",
          "Produto / formato",
          { rotulo: "Saiu", dir: true },
          { rotulo: "Voltou", dir: true },
          { rotulo: "Consumido", dir: true },
          "Situação",
        ]}
      >
        {lista === undefined ? (
          <LinhaMensagem colSpan={7}>Carregando…</LinhaMensagem>
        ) : lista.length === 0 ? (
          <LinhaMensagem colSpan={7}>Nenhum patrocínio registrado.</LinhaMensagem>
        ) : (
          lista.map((p) => (
            <LinhaTabela key={p._id}>
              <td className="px-3 py-2.5 font-mono text-xs text-texto-suave">{data(p.registradoEm)}</td>
              <td className="px-3 py-2.5 font-medium text-texto">{p.clienteNome || "—"}</td>
              <td className="px-3 py-2.5 text-texto-suave">{p.produtoNome} / {p.formatoNome}</td>
              <td className="px-3 py-2.5 text-right font-mono text-texto">{num(p.saiu)} {p.unidade}</td>
              <td className="px-3 py-2.5 text-right font-mono text-entrada">{num(p.retornado)} {p.unidade}</td>
              <td className="px-3 py-2.5 text-right font-mono text-texto">{num(p.consumido)} {p.unidade}</td>
              <td className="px-3 py-2.5">
                {p.emAberto ? (
                  <span className="inline-block rounded-full bg-acento/10 px-2 py-0.5 text-[11px] font-semibold text-acento">
                    em aberto
                  </span>
                ) : (
                  <span className="inline-block rounded-full border border-borda-forte px-2 py-0.5 text-[11px] font-semibold text-texto-fraco">
                    quitado
                  </span>
                )}
              </td>
            </LinhaTabela>
          ))
        )}
      </Tabela>
    </>
  );
}
