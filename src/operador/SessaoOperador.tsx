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

  // Ações visíveis do menu, conforme as permissões da sessão. "Ver saldo" é sempre
  // permitida. Cada uma vira um azulejo quadrado na grade 2×2 (launcher da câmara).
  const acoes: {
    chave: Tela;
    rotulo: string;
    Icone: typeof PackagePlus;
    variante: "entrada" | "saida" | "neutro";
  }[] = [
    ...(sessao.podeLancarProducao
      ? [{ chave: "producao" as const, rotulo: "Produção", Icone: PackagePlus, variante: "entrada" as const }]
      : []),
    ...(sessao.podeLancarSaida
      ? [{ chave: "saida" as const, rotulo: "Saída / retorno", Icone: Truck, variante: "saida" as const }]
      : []),
    { chave: "saldo" as const, rotulo: "Ver saldo", Icone: Gauge, variante: "neutro" as const },
    ...(sessao.podeContar
      ? [{ chave: "contagem" as const, rotulo: "Contar", Icone: ClipboardList, variante: "neutro" as const }]
      : []),
  ];
  const impar = acoes.length % 2 === 1;

  return (
    <Tela titulo={`Olá, ${sessao.operadorNome}`} camaraNome={sessao.camaraNome}>
      <div className="grid grid-cols-2 gap-3">
        {acoes.map(({ chave, rotulo, Icone, variante }, i) => {
          // Contagem ímpar: o último azulejo ocupa a linha inteira (bloco largo mais
          // baixo), sem deixar uma célula vazia solta.
          const ultimoImpar = impar && i === acoes.length - 1;
          return (
            <BotaoGrande
              key={chave}
              variante={variante}
              onClick={() => setTela(chave)}
              className={`flex-col gap-3 text-lg ${ultimoImpar ? "col-span-2 min-h-[7rem]" : "aspect-square"}`}
            >
              <Icone size={32} aria-hidden="true" />
              <span className="text-balance leading-tight">{rotulo}</span>
            </BotaoGrande>
          );
        })}
      </div>

      <div className="mt-10">
        <button onClick={sairAgora} className="w-full py-3 text-base text-texto-suave underline">
          Sair
        </button>
      </div>
    </Tela>
  );
}
