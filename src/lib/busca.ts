// Normaliza pra comparação de busca: minúsculas, sem acento. "maca" encontra
// "Maçã Verde" porque os dois viram "maca"/"maca verde".
export function normalizarBusca(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
