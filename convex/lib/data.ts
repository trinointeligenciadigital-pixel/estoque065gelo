import { ConvexError } from "convex/values";

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

/*
  Data do movimento (RF65): o dia em que o gelo REALMENTE entrou ou saiu, que
  pode ser até 7 dias antes do registro (venda de ontem lançada hoje). O cliente
  manda só o DIA ("AAAA-MM-DD", dia de Cuiabá); o horário é decidido aqui:
  - sem dia, ou dia = hoje → o próprio `agora` (igual a registradoEm)
  - dia passado → 12:00 de Cuiabá daquele dia (meio do dia: não escorrega pra
    data vizinha em nenhuma conversão de fuso)
  Futuro, mais de 7 dias atrás ou texto inválido → erro, antes de gravar.
*/
export const DIAS_RETROATIVOS_MAX = 7;
const MEIO_DIA_MS = 12 * 60 * 60 * 1000;

export function resolverDataMovimento(dia: string | undefined, agora: number): number {
  if (dia === undefined || dia === "") return agora;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (m === null) throw new ConvexError("Data inválida.");
  const meiaNoiteLocal = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const inicioDia = meiaNoiteLocal - CUIABA_OFFSET_MS;
  // Date.UTC normaliza "2026-02-31" para março — confere que o dia existe.
  if (diaCuiaba(inicioDia) !== dia) throw new ConvexError("Data inválida.");

  const inicioHoje = inicioDoDiaCuiaba(agora);
  if (inicioDia === inicioHoje) return agora;
  if (inicioDia > inicioHoje) throw new ConvexError("A data do movimento não pode ser no futuro.");
  if (inicioDia < inicioHoje - DIAS_RETROATIVOS_MAX * DIA_MS) {
    throw new ConvexError(`A data do movimento pode ser no máximo ${DIAS_RETROATIVOS_MAX} dias atrás.`);
  }
  return inicioDia + MEIO_DIA_MS;
}

// "AAAA-MM-DD" do dia de Cuiabá que contém `ms`.
export function diaCuiaba(ms: number): string {
  const d = new Date(ms + CUIABA_OFFSET_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

// Data do movimento de qualquer linha do ledger. Lançamentos anteriores ao
// RF65 não têm o campo (sem migração — seria patch no ledger, regra 2): para
// eles, o movimento aconteceu quando foi registrado.
export function dataEfetiva(m: { dataMovimento?: number; registradoEm: number }): number {
  return m.dataMovimento ?? m.registradoEm;
}

// Folga para buscar pelo índice by_registrado_em quando o filtro é pela data
// do movimento: como dataMovimento ≤ registradoEm ≤ dataMovimento + 8 dias
// (7 retroativos + o resto do dia), basta alargar o TETO da busca por isto.
export const FOLGA_RETROATIVA_MS = (DIAS_RETROATIVOS_MAX + 1) * DIA_MS;

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
