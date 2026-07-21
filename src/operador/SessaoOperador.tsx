import { useState } from "react";
import { useMutation } from "convex/react";
import { ClipboardList, Gauge, PackagePlus, Truck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { BotaoGrande, Tela } from "./ui.tsx";
import { ProducaoFlow } from "./ProducaoFlow.tsx";
import { SaidaFlow } from "./SaidaFlow.tsx";
import { SaldoView } from "./SaldoView.tsx";
import { ContagemFlow } from "./ContagemFlow.tsx";

export type Sessao = {
  operadorNome: string;
  camaraNome: string;
  podeLancarProducao: boolean;
  podeLancarSaida: boolean;
  podeContar: boolean;
};

type Tela = "menu" | "producao" | "saida" | "saldo" | "contagem";

/*
  Menu da câmara — ações grandes, só as permitidas aparecem (nunca desabilitadas).
  Retorno de patrocínio fica dentro de Saída. Contar aparece só com podeContar.
*/
export function SessaoOperador({
  token,
  sessao,
  aoSair,
}: {
  token: string;
  sessao: Sessao;
  aoSair: () => void;
}) {
  const [tela, setTela] = useState<Tela>("menu");
  const sair = useMutation(api.operador.acesso.sair);

  async function sairAgora() {
    try {
      await sair({ token });
    } finally {
      aoSair();
    }
  }

  if (tela === "producao") {
    return <ProducaoFlow token={token} camaraNome={sessao.camaraNome} onVoltar={() => setTela("menu")} />;
  }
  if (tela === "saida") {
    return (
      <SaidaFlow
        token={token}
        camaraNome={sessao.camaraNome}
        operadorNome={sessao.operadorNome}
        onVoltar={() => setTela("menu")}
      />
    );
  }
  if (tela === "saldo") {
    return <SaldoView token={token} camaraNome={sessao.camaraNome} onVoltar={() => setTela("menu")} />;
  }
  if (tela === "contagem") {
    return <ContagemFlow token={token} camaraNome={sessao.camaraNome} onVoltar={() => setTela("menu")} />;
  }

  return (
    <Tela titulo={`Olá, ${sessao.operadorNome}`} camaraNome={sessao.camaraNome}>
      <div className="flex flex-col gap-3">
        {sessao.podeLancarProducao ? (
          <BotaoGrande variante="entrada" onClick={() => setTela("producao")}>
            <PackagePlus size={20} aria-hidden="true" /> Lançar produção
          </BotaoGrande>
        ) : null}
        {sessao.podeLancarSaida ? (
          <BotaoGrande variante="saida" onClick={() => setTela("saida")}>
            <Truck size={20} aria-hidden="true" /> Lançar saída / retorno
          </BotaoGrande>
        ) : null}
        <BotaoGrande variante="neutro" onClick={() => setTela("saldo")}>
          <Gauge size={20} aria-hidden="true" /> Ver saldo
        </BotaoGrande>
        {sessao.podeContar ? (
          <BotaoGrande variante="neutro" onClick={() => setTela("contagem")}>
            <ClipboardList size={20} aria-hidden="true" /> Contar
          </BotaoGrande>
        ) : null}
      </div>

      <div className="mt-10">
        <button onClick={sairAgora} className="w-full py-3 text-base text-texto-suave underline">
          Sair
        </button>
      </div>
    </Tela>
  );
}
