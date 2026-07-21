/*
  Datas exibidas sempre no fuso de Cuiabá, UTC−4 (RNF15). O banco guarda tudo em
  UTC (timestamp em ms); a conversão para o fuso local acontece só na exibição,
  independentemente do fuso do computador de quem abre o painel.
*/
const FUSO_CUIABA = "America/Cuiaba";

export function dataHora(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", { timeZone: FUSO_CUIABA });
}

export function data(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", { timeZone: FUSO_CUIABA });
}
