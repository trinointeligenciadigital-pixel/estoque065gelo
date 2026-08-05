/*
  Protocolo curto e legível em voz alta (adendo PWA, tarefa 4) — 8 caracteres
  hexadecimais maiúsculos derivados de uma semente. Para lançamentos normais a
  semente é a própria chaveIdempotencia (um UUID real do cliente — determinístico,
  então repetir a mesma chamada por retry gera o MESMO protocolo). Para estorno e
  ajuste, cuja chaveIdempotencia não é um UUID legível ("estorno:<id>",
  "ajuste:<contagem>:<item>"), quem chama passa uma semente própria (um
  crypto.randomUUID() fresco, ou o loteId do grupo).
*/
export function protocoloDe(semente: string): string {
  return semente.slice(0, 8).toUpperCase();
}
