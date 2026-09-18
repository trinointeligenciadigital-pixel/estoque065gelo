import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AvisoOperador, EstadoVazio, Kg, primeiroNome, Tela } from "./ui.tsx";
import { formatarPeso, formatarQuantidade, rotuloFormato } from "../lib/formato.ts";

/*
  Ver saldo (RF43–RF45). Somente leitura: saldo por formato e peso total por
  produto, da câmara da sessão. Não gera movimentação nenhuma. Enquanto o
  colaborador tiver uma contagem aberta nesta câmara, o servidor devolve
  `null` em vez do saldo (contagem às cegas, sprint PWA tarefa 1) — normalmente
  esta tela nem é alcançável nesse período ("Ver saldo" some da home), mas a
  query já protege mesmo que a pessoa tenha a tela aberta de antes.
*/
export function SaldoView({
  token,
  camaraNome,
  operadorNome,
  onVoltar,
}: {
  token: string;
  camaraNome: string;
  operadorNome: string;
  onVoltar: () => void;
}) {
  const saldos = useQuery(api.operador.consulta.saldos, { token });

  return (
    <Tela titulo="Saldo da câmara" camaraNome={camaraNome} operadorNome={primeiroNome(operadorNome)} onVoltar={onVoltar}>
      {saldos === undefined ? (
        <p className="text-base text-texto-suave">Carregando…</p>
      ) : saldos === null ? (
        <AvisoOperador>Saldo indisponível durante a contagem.</AvisoOperador>
      ) : saldos.length === 0 ? (
        <EstadoVazio mensagem="Nenhum produto nesta câmara." onVoltar={onVoltar} />
      ) : (
        <div className="flex flex-col gap-4">
          {saldos.map((p) => (
            <div key={p._id} className="rounded-xl border border-borda bg-superficie p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-base font-semibold text-texto">{p.nome}</span>
                <span className="text-sm text-texto-suave">
                  total <Kg valor={p.pesoTotalKg} />
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {p.formatos.length === 0 ? (
                  <span className="text-sm text-texto-suave">Sem formatos ativos.</span>
                ) : (
                  p.formatos.map((f) => (
                    <div key={f._id} className="flex items-center justify-between text-base">
                      <span className="text-texto-suave">{rotuloFormato(f)}</span>
                      <span className="font-numero text-texto">
                        {f.pesoVariavel ? formatarPeso(f.pesoLiquidoKg) : formatarQuantidade(f.saldo, f)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Tela>
  );
}
