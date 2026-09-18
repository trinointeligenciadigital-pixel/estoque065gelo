import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/*
  Segunda confirmação quando o número foge do padrão (tarefa 4 do sprint PWA):
  maior que 3× a média diária dos últimos 30 dias, ou maior que 5× o saldo
  atual. Os números vêm do servidor (convex/operador/consulta.ts,
  checarPlausibilidade) — a mensagem nunca inventa um valor.
*/
export type TipoPlausivel = "producao" | "venda" | "patrocinio" | "perda";

export function usePlausibilidade(args: {
  token: string;
  produtoId: Id<"produtos"> | null;
  formatoId: Id<"formatos"> | null;
  tipo: TipoPlausivel;
  quantidade: number; // pacotes, ou kg se o formato for de peso variável
}) {
  const [confirmouAviso, setConfirmouAviso] = useState(false);

  // Espera uma pausa na digitação antes de checar (300ms) — sem isso, o botão
  // do rodapé pode trocar de "Continuar" para "Confirmar mesmo assim" no meio
  // de digitar um número de vários dígitos, bem embaixo do dedo.
  const [quantidadeEstavel, setQuantidadeEstavel] = useState(args.quantidade);
  useEffect(() => {
    const t = setTimeout(() => setQuantidadeEstavel(args.quantidade), 300);
    return () => clearTimeout(t);
  }, [args.quantidade]);

  // Cada nova tentativa exige confirmação de novo — mudou o número (ou o
  // item), a confirmação anterior não vale mais pro número novo.
  useEffect(() => {
    setConfirmouAviso(false);
  }, [args.produtoId, args.formatoId, quantidadeEstavel]);

  const ativo = args.produtoId !== null && args.formatoId !== null && quantidadeEstavel > 0;
  const check = useQuery(
    api.operador.consulta.checarPlausibilidade,
    ativo
      ? {
          token: args.token,
          produtoId: args.produtoId!,
          formatoId: args.formatoId!,
          tipo: args.tipo,
          quantidade: quantidadeEstavel,
        }
      : "skip",
  );

  return {
    // Ainda precisa do toque extra: o servidor sinalizou e o operador ainda
    // não confirmou este valor específico.
    precisaConfirmar: !!check?.precisaConfirmar && !confirmouAviso,
    confirmouAviso,
    setConfirmouAviso,
    saldoAtual: check?.saldoAtual ?? null,
    mediaDiaria: check?.mediaDiaria ?? null,
  };
}

// Nomeia o número em vez de perguntar genericamente — quem confirma tem que
// ler o valor por extenso antes de confirmar de novo. `resumo` é a primeira
// frase, já pronta ("1.200 pacotes = 6.840,0 kg." ou, pra peso variável só
// com peso, "6.840,0 kg.") — cada tela monta a que fizer sentido pra ela.
export function mensagemPlausibilidade({
  resumo,
  produtoNome,
  mediaDiariaLabel,
  saldoLabel,
}: {
  resumo: string;
  produtoNome: string;
  mediaDiariaLabel: string | null;
  saldoLabel: string;
}): string {
  const partes = [resumo];
  partes.push(
    mediaDiariaLabel !== null
      ? `A média diária de ${produtoNome} é ${mediaDiariaLabel}, e a câmara tem ${saldoLabel} em estoque.`
      : `A câmara tem ${saldoLabel} em estoque.`,
  );
  partes.push("Confirma mesmo assim?");
  return partes.join(" ");
}
