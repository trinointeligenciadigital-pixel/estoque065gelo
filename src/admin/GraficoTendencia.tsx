import { useId, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { formatarPeso } from "../lib/formato.ts";
import { suavizar, useEntrada } from "./movimento.ts";

/*
  Gráfico de tendência Produção × Saídas por dia — SVG desenhado à mão, sem
  biblioteca, para não pesar no PWA e seguir a estética plana do sistema.

  Movimento (uma ideia só: "o nível sobe"): ao abrir, e ao trocar o período, as
  curvas se erguem da linha de base numa onda da esquerda para a direita e, no fim,
  um toque marca o dia mais recente. Depois disso o gráfico é estável: mostrar/
  esconder uma série reescala as curvas com transição, e o cursor desliza de um dia
  para o outro em vez de pular. Quem pede menos movimento vê tudo já no lugar.

  Interações (só as que ajudam a decidir): passar o mouse mostra o dia com os dois
  pesos; clicar fixa o tooltip (útil no toque e para ler o número exato); a legenda
  liga/desliga cada série. Sem zoom.

  As coordenadas são calculadas num viewBox fixo; o SVG escala para a largura do
  cartão. O tooltip é HTML posicionado por porcentagem (o viewBox escala uniforme).
*/

export type PontoTendencia = {
  dia: number; // início do dia local (Cuiabá) em ms UTC
  producaoKg: number;
  saidasKg: number;
};

const CUIABA_OFFSET_MS = -4 * 60 * 60 * 1000;
const W = 720;
const H = 190; // achatado: menos alto em telas largas (a altura é fixa por proporção)
const PAD = { top: 14, right: 18, bottom: 26, left: 46 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

// Arredonda o topo do eixo Y para um número redondo (tarefa 6): sem isso as
// guias saíam com o valor exato do dado (ex.: 0 / 59,8 / 120), decimal e sem
// nenhum apelo visual de escala. Sobe até o próximo múltiplo de uma casa
// abaixo da ordem de grandeza do valor — 119,6 vira 120, não 100 nem 200.
function eixoYArredondado(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const passo = Math.pow(10, exp - 1);
  return Math.ceil(v / passo) * passo;
}

// Rótulo compacto das linhas-guia do eixo Y — só aqui, porque gridline é
// referência de escala, não leitura exata (essa vai por formatarPeso, no
// tooltip e no aria-label).
function rotuloEixoY(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: n >= 100 ? 0 : 1 });
}
function rotuloDia(ms: number): string {
  const d = new Date(ms + CUIABA_OFFSET_MS);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function diaSemana(ms: number): string {
  return DIA_SEMANA[new Date(ms + CUIABA_OFFSET_MS).getUTCDay()] ?? "";
}

/*
  Curva suave que nunca passa dos dados (interpolação monótona, a mesma ideia do
  d3.curveMonotoneX): entre dois dias a linha não faz "barriga" nem afunda abaixo
  de zero. Devolve os segmentos "C ..." — o "M" inicial é montado por quem chama.
  A estrutura do caminho depende só da quantidade de pontos, o que permite ao
  navegador animar a troca de um caminho para outro.
*/
function segmentosSuaves(pts: [number, number][]): string {
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let d = "";
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C ${(x0 + h).toFixed(1)} ${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)} ${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

// `d` como propriedade CSS deixa o navegador animar a troca de caminho (Chrome,
// Firefox); onde não há suporte (Safari) a troca é seca, sem quebrar nada.
function estiloCaminho(d: string, animar: boolean): CSSProperties {
  return { d: `path("${d}")`, transition: animar ? "d 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease-out" : "none" } as CSSProperties;
}

export function GraficoTendencia({
  serie,
  hrefDoDia,
}: {
  serie: PontoTendencia[];
  // Ao fixar um dia (clicar), o balão mostra um link para este endereço — usado
  // para abrir o Histórico já filtrado naquela data.
  hrefDoDia?: (diaMs: number) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const idBase = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [fixado, setFixado] = useState<number | null>(null);
  const [mostrar, setMostrar] = useState({ producao: true, saidas: true });

  const n = serie.length;
  const ativo = fixado ?? hover;
  // A entrada recomeça quando o período muda (n muda) — é o momento de "reler" o gráfico.
  const { t, pronto } = useEntrada(n);

  if (n < 2) {
    return (
      <p className="py-10 text-center text-[13px] text-texto-suave">
        Selecione <span className="font-medium text-texto">7 dias</span> ou{" "}
        <span className="font-medium text-texto">30 dias</span> para ver a tendência.
      </p>
    );
  }

  // Sem nenhum movimento no período: um gráfico com duas linhas em zero é um vazio
  // alto e sem informação. Mostra uma mensagem curta até haver lançamentos.
  const semMovimento = serie.every((p) => p.producaoKg === 0 && p.saidasKg === 0);
  if (semMovimento) {
    return (
      <p className="py-10 text-center text-[13px] text-texto-suave">
        Nenhuma produção ou saída nos últimos {n} dias. O gráfico ganha forma assim que os
        lançamentos do dia a dia começarem.
      </p>
    );
  }

  const maxYBruto = Math.max(
    1,
    ...serie.map((p) => Math.max(mostrar.producao ? p.producaoKg : 0, mostrar.saidas ? p.saidasKg : 0)),
  );
  const maxY = eixoYArredondado(maxYBruto);

  const xFor = (i: number) => PAD.left + (i / (n - 1)) * PLOT_W;
  const base = PAD.top + PLOT_H;
  // Cada ponto sobe com um pequeno atraso proporcional à posição: a onda varre o
  // gráfico da esquerda para a direita enquanto as curvas se erguem.
  const subida = (i: number) => (pronto ? 1 : suavizar((t - 0.45 * (i / (n - 1))) / 0.55));
  const yFor = (v: number, i = n - 1) => base - (v / maxY) * PLOT_H * subida(i);

  const pontos = (chave: "producaoKg" | "saidasKg"): [number, number][] =>
    serie.map((p, i) => [xFor(i), yFor(p[chave], i)]);
  const linha = (chave: "producaoKg" | "saidasKg") => {
    const pts = pontos(chave);
    return `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}${segmentosSuaves(pts)}`;
  };
  const area = (chave: "producaoKg" | "saidasKg") => {
    const pts = pontos(chave);
    return `M ${pts[0][0].toFixed(1)} ${base} L ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}${segmentosSuaves(pts)} L ${pts[n - 1][0].toFixed(1)} ${base} Z`;
  };

  // Rótulos do eixo X: todos até 10 dias; a cada ~5 quando há 30.
  const passoX = n <= 10 ? 1 : Math.ceil(n / 6);

  // 3 linhas-guia horizontais: 0, meio, máximo.
  const guias = [0, maxY / 2, maxY];

  function moverMouse(e: React.MouseEvent<SVGSVGElement>) {
    if (fixado !== null) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((vx - PAD.left) / PLOT_W) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }
  function clicar(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((vx - PAD.left) / PLOT_W) * (n - 1))));
    setFixado((f) => (f === i ? null : i));
    setHover(i);
  }

  const total = serie.reduce(
    (a, p) => ({ producao: a.producao + p.producaoKg, saidas: a.saidas + p.saidasKg }),
    { producao: 0, saidas: 0 },
  );

  const series = [
    { chave: "producaoKg" as const, cor: "var(--color-entrada)", ativa: mostrar.producao, tracejada: false, id: `${idBase}-p` },
    { chave: "saidasKg" as const, cor: "var(--color-saida)", ativa: mostrar.saidas, tracejada: true, id: `${idBase}-s` },
  ];

  return (
    <div className="relative mx-auto max-w-[860px]">
      {/* Legenda / liga-desliga série */}
      <div className="mb-3 flex items-center gap-2">
        <SerieToggle
          cor="var(--color-entrada)"
          rotulo="Produção"
          ativo={mostrar.producao}
          onClick={() => setMostrar((m) => ({ ...m, producao: !m.producao }))}
        />
        <SerieToggle
          cor="var(--color-saida)"
          rotulo="Saídas"
          ativo={mostrar.saidas}
          onClick={() => setMostrar((m) => ({ ...m, saidas: !m.saidas }))}
        />
        {fixado !== null ? (
          <button
            onClick={() => {
              setFixado(null);
              setHover(null);
            }}
            className="ml-auto text-[11px] font-medium text-texto-fraco hover:text-texto"
          >
            soltar ✕
          </button>
        ) : null}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label={`Tendência de ${n} dias. Produção total ${formatarPeso(total.producao)}, saídas total ${formatarPeso(total.saidas)}.`}
        onMouseMove={moverMouse}
        onMouseLeave={() => fixado === null && setHover(null)}
        onClick={clicar}
      >
        <defs>
          {/* Véu de área: mesma cor da série, só some de cima para baixo (sem trocar de matiz). */}
          {series.map((s) => (
            <linearGradient key={s.id} id={s.id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.cor} stopOpacity={s.tracejada ? 0.07 : 0.18} />
              <stop offset="1" stopColor={s.cor} stopOpacity={0.01} />
            </linearGradient>
          ))}
        </defs>

        {/* guias horizontais + rótulos Y — deslizam quando a escala muda */}
        {guias.map((v, i) => (
          <g
            key={i}
            style={{ transform: `translateY(${(PAD.top + PLOT_H - (v / maxY) * PLOT_H).toFixed(1)}px)`, transition: pronto ? "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)" : "none" }}
          >
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={0}
              y2={0}
              stroke="var(--color-borda)"
              strokeWidth={1}
              strokeDasharray={i === 0 ? "0" : "3 3"}
            />
            <text x={PAD.left - 8} y={3} textAnchor="end" className="font-numero" fontSize={10} fill="var(--color-texto-fraco)">
              {rotuloEixoY(v)}
            </text>
          </g>
        ))}

        {/* rótulos X */}
        {serie.map((p, i) =>
          i % passoX === 0 || i === n - 1 ? (
            <text key={i} x={xFor(i)} y={H - 10} textAnchor="middle" className="font-numero" fontSize={10} fill="var(--color-texto-fraco)">
              {rotuloDia(p.dia)}
            </text>
          ) : null,
        )}

        {/* áreas + linhas — série escondida some com fade, sem sair da árvore */}
        {series.map((s) => (
          <g key={s.chave} style={{ opacity: s.ativa ? 1 : 0, transition: "opacity 0.3s ease-out" }} aria-hidden={!s.ativa}>
            <path d={area(s.chave)} fill={`url(#${s.id})`} style={estiloCaminho(area(s.chave), pronto)} />
            <path
              d={linha(s.chave)}
              fill="none"
              stroke={s.cor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.tracejada ? "5 3" : undefined}
              style={estiloCaminho(linha(s.chave), pronto)}
            />
            {/* Marca do dia mais recente: entra depois que a curva termina de subir,
                com um único toque que se expande e some. */}
            {pronto ? (
              <g style={{ transform: `translate(${xFor(n - 1)}px, ${yFor(serie[n - 1][s.chave])}px)`, transition: "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }}>
                <circle r={3.5} fill={s.cor} className="grafico-ping" />
                <circle r={3} fill={s.cor} stroke="var(--color-superficie)" strokeWidth={1.5} className="grafico-ponta" />
              </g>
            ) : null}
          </g>
        ))}

        {/* guia vertical + pontos do dia ativo — deslizam entre os dias */}
        {ativo !== null ? (
          <g>
            <g style={{ transform: `translateX(${xFor(ativo)}px)`, transition: "transform 0.15s ease-out" }}>
              <line x1={0} x2={0} y1={PAD.top} y2={base} stroke="var(--color-borda-forte)" strokeWidth={1} />
            </g>
            {series.map((s) =>
              s.ativa ? (
                <circle
                  key={s.chave}
                  r={3.5}
                  fill={s.cor}
                  stroke="var(--color-superficie)"
                  strokeWidth={1.5}
                  style={{ transform: `translate(${xFor(ativo)}px, ${yFor(serie[ativo][s.chave], ativo)}px)`, transition: "transform 0.15s ease-out" }}
                />
              ) : null,
            )}
          </g>
        ) : null}
      </svg>

      {/* Tooltip HTML posicionado por % (o viewBox escala uniforme) */}
      {ativo !== null ? (
        <div
          className={`animate-menu-entra absolute top-9 z-10 -translate-x-1/2 rounded-lg border border-borda bg-superficie px-3 py-2 transition-[left] duration-150 ease-out ${
            fixado !== null ? "pointer-events-auto" : "pointer-events-none"
          }`}
          style={{ left: `${Math.min(88, Math.max(12, (xFor(ativo) / W) * 100))}%` }}
        >
          <div className="mb-1 text-[11px] font-semibold text-texto">
            {rotuloDia(serie[ativo].dia)} <span className="font-normal text-texto-fraco">· {diaSemana(serie[ativo].dia)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px]">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-entrada)" }} />
            <span className="text-texto-suave">Produção</span>
            <span className="ml-auto pl-3 font-numero tabular-nums font-semibold text-texto">{formatarPeso(serie[ativo].producaoKg)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px]">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-saida)" }} />
            <span className="text-texto-suave">Saídas</span>
            <span className="ml-auto pl-3 font-numero tabular-nums font-semibold text-texto">{formatarPeso(serie[ativo].saidasKg)}</span>
          </div>
          {fixado !== null && hrefDoDia ? (
            <Link
              to={hrefDoDia(serie[ativo].dia)}
              className="mt-2 block border-t border-borda pt-1.5 text-[11px] font-medium text-acento hover:underline"
            >
              Ver lançamentos deste dia →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SerieToggle({ cor, rotulo, ativo, onClick }: { cor: string; rotulo: string; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${
        ativo ? "border-borda-forte text-texto" : "border-borda text-texto-fraco line-through"
      }`}
    >
      <span className="h-2 w-2 rounded-full transition-colors" style={{ background: ativo ? cor : "var(--color-borda-forte)" }} />
      {rotulo}
    </button>
  );
}
