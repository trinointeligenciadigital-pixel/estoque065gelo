/*
  Fuso de Cuiabá (RNF15) no servidor — UTC−4, sem horário de verão. O ledger
  guarda tudo em UTC; "hoje"/"meia-noite" para quem usa o sistema é o dia de
  Cuiabá, não o do servidor. Compartilhado entre painel, estorno e sessão do
  colaborador — os três precisam desta mesma conta.
*/
const DIA_MS = 24 * 60 * 60 * 1000;
const CUIABA_OFFSET_MS = -4 * 60 * 60 * 1000;

// Início do dia (meia-noite) em Cuiabá que contém `agora`, em ms UTC.
export function inicioDoDiaCuiaba(agora: number): number {
  const local = agora + CUIABA_OFFSET_MS;
  const meiaNoiteLocal = local - (((local % DIA_MS) + DIA_MS) % DIA_MS);
  return meiaNoiteLocal - CUIABA_OFFSET_MS;
}

// Início do dia SEGUINTE em Cuiabá — a "virada do dia" que encerra sessões
// do colaborador (sprint PWA, tarefa 6), em ms UTC.
export function fimDoDiaCuiaba(agora: number): number {
  return inicioDoDiaCuiaba(agora) + DIA_MS;
}

// "05/08/2026 14:30" — usado em mensagens de erro que citam uma data (nunca
// confia em Intl/toLocaleString no runtime do Convex; conta manual, como o
// resto do fuso de Cuiabá aqui).
export function dataHoraCuiaba(ms: number): string {
  const d = new Date(ms + CUIABA_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()} ${hh}:${min}`;
}
