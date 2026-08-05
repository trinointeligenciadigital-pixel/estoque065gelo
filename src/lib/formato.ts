/*
  Formatação de números do domínio — padrão pt-BR único no app inteiro (Painel e
  PWA do colaborador). Antes desta função, "pacote" aparecia como unidade "pct"
  (lida como percentual) e o peso ora usava vírgula, ora ponto, ora número
  variável de casas decimais — inaceitável num sistema de estoque.
*/

// "1 pacote" / "1.461 pacotes" / "−3 pacotes" — sem casas decimais, separador
// de milhar pt-BR, singular só para exatamente 1 (positivo ou negativo).
export function formatarPacotes(n: number): string {
  const arredondado = Math.round(n);
  const unidade = Math.abs(arredondado) === 1 ? "pacote" : "pacotes";
  return `${arredondado.toLocaleString("pt-BR")} ${unidade}`;
}

// "37.047,0 kg" / "1.077,3 kg" / "5,7 kg" — sempre 1 casa decimal, separador
// de milhar e decimal pt-BR.
export function formatarPeso(kg: number): string {
  const texto = kg.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${texto} kg`;
}
