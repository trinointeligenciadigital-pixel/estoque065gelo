/*
  Existem produtos homônimos em câmaras diferentes por desenho (ex.: "Cubo" na
  Cubo/Escama e "Cubo" na Conteiner) — nome repetido dentro da MESMA câmara é
  que é bloqueado (convex/admin/produtos.ts). Este rótulo é o que distingue os
  dois em qualquer lugar que liste produtos: nunca mostrar nome de produto sem
  a câmara ao lado.
*/
export function rotuloProduto(nome: string, camaraNome: string): string {
  return `${nome} · ${camaraNome}`;
}
