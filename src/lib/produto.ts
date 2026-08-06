/*
  Existem produtos homônimos em câmaras diferentes por desenho (ex.: "Cubo" na
  Cubo/Escama e "Cubo" na Conteiner) — nome repetido dentro da MESMA câmara é
  que é bloqueado (convex/admin/produtos.ts). O sufixo de câmara só entra no
  rótulo quando existe de fato um homônimo em OUTRA câmara (correção "pacote
  prevalece, quilo agrega", tarefa 6) — sem isso, "Morango · Saborizado" repetia
  a câmara que já aparece como tag ao lado, sem precisar desambiguar nada.
*/
export function rotuloProduto(nome: string, camaraNome: string, mostrarCamara = true): string {
  return mostrarCamara ? `${nome} · ${camaraNome}` : nome;
}

// Nomes (normalizados) que aparecem em mais de uma câmara — só esses precisam
// do sufixo de câmara para não ficarem ambíguos numa lista de produtos.
export function nomesHomonimos<T extends { nome: string; camaraId: string }>(
  produtos: T[],
): Set<string> {
  const camarasPorNome = new Map<string, Set<string>>();
  for (const p of produtos) {
    const chave = p.nome.trim().toLowerCase();
    const camaras = camarasPorNome.get(chave) ?? new Set<string>();
    camaras.add(p.camaraId);
    camarasPorNome.set(chave, camaras);
  }
  const homonimos = new Set<string>();
  for (const [chave, camaras] of camarasPorNome) {
    if (camaras.size > 1) homonimos.add(chave);
  }
  return homonimos;
}
