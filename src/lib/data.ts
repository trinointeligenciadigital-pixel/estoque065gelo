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

/*
  Data do movimento (RF65). O lançamento manda só o DIA ("AAAA-MM-DD", dia de
  Cuiabá) — o servidor decide o horário e valida os limites de novo
  (convex/lib/data.ts, resolverDataMovimento). Aqui só se monta a escolha.
*/
const DIA_MS = 24 * 60 * 60 * 1000;
export const DIAS_RETROATIVOS_MAX = 7;

// "AAAA-MM-DD" do dia de Cuiabá que contém `ms` ("en-CA" já formata assim).
export function diaDe(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: FUSO_CUIABA });
}

export function hoje(): string {
  return diaDe(Date.now());
}

// "Hoje", "Ontem" ou "sex 23/10". Meio-dia UTC−4 = 16:00 UTC: nunca vira o dia.
export function rotuloDia(dia: string): string {
  if (dia === hoje()) return "Hoje";
  if (dia === diaDe(Date.now() - DIA_MS)) return "Ontem";
  const ms = Date.parse(`${dia}T16:00:00Z`);
  return new Date(ms)
    .toLocaleDateString("pt-BR", { timeZone: FUSO_CUIABA, weekday: "short", day: "2-digit", month: "2-digit" })
    .replace(/\./g, "")
    .replace(",", "");
}

// Os dias que podem ser escolhidos: hoje e os 7 anteriores, do mais novo ao
// mais antigo. Cuiabá não tem horário de verão, então −24h é sempre um dia.
// `desde` (opcional, "AAAA-MM-DD") corta os dias anteriores — ex.: retorno não
// pode ser antes do patrocínio.
export function diasPermitidos(desde?: string): string[] {
  const dias: string[] = [];
  for (let i = 0; i <= DIAS_RETROATIVOS_MAX; i++) {
    const d = diaDe(Date.now() - i * DIA_MS);
    if (desde !== undefined && d < desde) break;
    dias.push(d);
  }
  return dias;
}

// Timestamp do movimento, espelhando o servidor: hoje = o próprio `agora`;
// dia passado = meio-dia de Cuiabá (16:00 UTC). Só para exibir logo após o
// envio (ex.: comprovante na tela de sucesso) sem esperar nova leitura.
export function msDoDia(dia: string, agora: number): number {
  return dia === diaDe(agora) ? agora : Date.parse(`${dia}T16:00:00Z`);
}

// Duas datas caem em dias diferentes de Cuiabá? (data do movimento ≠ registro)
export function diasDiferentes(a: number, b: number): boolean {
  return diaDe(a) !== diaDe(b);
}

// "05/08/2026 · 14:21" — sem segundos (acabamento do adendo PWA): o segundo
// não serve a ninguém que recebe o comprovante. Só para comprovante (venda/
// patrocínio); o Histórico do Admin, que é auditoria, continua com dataHora().
export function dataHoraComprovante(ms: number): string {
  const hhmm = new Date(ms)
    .toLocaleTimeString("pt-BR", { timeZone: FUSO_CUIABA, hour: "2-digit", minute: "2-digit" });
  return `${data(ms)} · ${hhmm}`;
}
