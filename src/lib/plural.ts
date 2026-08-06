// "1 contagem" / "3 contagens" — helper único de plural pt-BR (adendo
// "pacote prevalece, quilo agrega", tarefa 6). Antes cada tela escrevia sua
// própria condição (ou esquecia, e "1 contagens" vazava pro Admin).
export function pluralizar(n: number, singular: string, plural: string): string {
  return `${n} ${Math.abs(n) === 1 ? singular : plural}`;
}
