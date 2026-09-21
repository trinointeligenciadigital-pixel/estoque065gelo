import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ClipboardList, Gauge, PackagePlus, Truck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { AzulejoAcao, ProvedorCamaraAtual, Tela } from "./ui.tsx";
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
  // Contagem cega (tarefa 1): enquanto ESTE colaborador tiver uma contagem
  // aberta nesta câmara, "Ver saldo" some da home — o servidor já nem devolve
  // o saldo (consulta.saldos), isto só evita mostrar um botão morto.
  const contagemAberta = useQuery(api.operador.contagem.contagemAbertaDoColaborador, { token });

  async function sairAgora() {
    try {
      await sair({ token });
    } finally {
      aoSair();
    }
  }

  if (tela === "producao") {
    return (
      <ProvedorCamaraAtual camaraNome={sessao.camaraNome}>
        <ProducaoFlow
          token={token}
          camaraNome={sessao.camaraNome}
          operadorNome={sessao.operadorNome}
          onVoltar={() => setTela("menu")}
        />
      </ProvedorCamaraAtual>
    );
  }
  if (tela === "saida") {
    return (
      <ProvedorCamaraAtual camaraNome={sessao.camaraNome}>
        <SaidaFlow
          token={token}
          camaraNome={sessao.camaraNome}
          operadorNome={sessao.operadorNome}
          onVoltar={() => setTela("menu")}
        />
      </ProvedorCamaraAtual>
    );
  }
  if (tela === "saldo") {
    return (
      <ProvedorCamaraAtual camaraNome={sessao.camaraNome}>
        <SaldoView
          token={token}
          camaraNome={sessao.camaraNome}
          operadorNome={sessao.operadorNome}
          onVoltar={() => setTela("menu")}
        />
      </ProvedorCamaraAtual>
    );
  }
  if (tela === "contagem") {
    return (
      <ProvedorCamaraAtual camaraNome={sessao.camaraNome}>
        <ContagemFlow
          token={token}
          camaraNome={sessao.camaraNome}
          operadorNome={sessao.operadorNome}
          onVoltar={() => setTela("menu")}
        />
      </ProvedorCamaraAtual>
    );
  }

  // Contagem cega (tarefa 1): "Ver saldo" some da home enquanto durar — não
  // fica desabilitado (some mesmo), porque um botão morto convida a tentar de
  // novo. Enquanto a query carrega, assume que NÃO há contagem aberta (o
  // servidor protege o dado de qualquer forma; o pior caso aqui é o botão
  // aparecer por um instante, nunca um vazamento de saldo).
  const temContagemAberta = !!contagemAberta;

  // Ações visíveis do menu, conforme as permissões da sessão. Cada uma vira um
  // azulejo quadrado na grade 2×2 (launcher da câmara).
  const acoes: {
    chave: Tela;
    rotulo: string;
    Icone: typeof PackagePlus;
    variante: "entrada" | "primario" | "neutro";
  }[] = [
    ...(sessao.podeLancarProducao
      ? [{ chave: "producao" as const, rotulo: "Produção", Icone: PackagePlus, variante: "entrada" as const }]
      : []),
    ...(sessao.podeLancarSaida
      ? // Teal, não vermelho (tarefa 1 do adendo): saída/venda é a operação mais
        // rotineira da fábrica, não é perigo. Vermelho fica só para Perda.
        [{ chave: "saida" as const, rotulo: "Saída / retorno", Icone: Truck, variante: "primario" as const }]
      : []),
    ...(!temContagemAberta
      ? [{ chave: "saldo" as const, rotulo: "Ver saldo", Icone: Gauge, variante: "neutro" as const }]
      : []),
    ...(sessao.podeContar
      ? [{ chave: "contagem" as const, rotulo: "Contar", Icone: ClipboardList, variante: "neutro" as const }]
      : []),
  ];
  const impar = acoes.length % 2 === 1;

  return (
    <ProvedorCamaraAtual camaraNome={sessao.camaraNome}>
      <Tela titulo={`Olá, ${sessao.operadorNome}`} camaraNome={sessao.camaraNome}>
        {temContagemAberta ? (
          <button
            onClick={() => setTela("contagem")}
            className="mb-4 flex w-full flex-col gap-0.5 rounded-xl border border-acento bg-acento/5 px-4 py-3 text-left transition outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento active:brightness-95"
          >
            <span className="flex items-center gap-2 text-base font-medium text-texto">
              <ClipboardList size={18} aria-hidden="true" />
              Contagem em andamento · {sessao.camaraNome}
            </span>
            <span className="text-sm text-texto-suave">
              Toque para continuar. Saldo indisponível até você terminar.
            </span>
          </button>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          {acoes.map(({ chave, rotulo, Icone, variante }, i) => {
            // Contagem ímpar: o último azulejo ocupa a linha inteira, sem deixar
            // uma célula vazia solta. Entrada escalonada (tarefa: profundidade e
            // movimento) — cada azulejo "chega" um pouco depois do anterior.
            const ultimoImpar = impar && i === acoes.length - 1;
            return (
              <AzulejoAcao
                key={chave}
                rotulo={rotulo}
                Icone={Icone}
                variante={variante}
                largo={ultimoImpar}
                atraso={i * 60}
                onClick={() => setTela(chave)}
              />
            );
          })}
        </div>

        <div className="mt-10">
          <button onClick={sairAgora} className="w-full py-3 text-base text-texto-suave underline">
            Sair
          </button>
        </div>
      </Tela>
    </ProvedorCamaraAtual>
  );
}
