import { useRef, useState } from "react";
import { Link } from "react-router-dom";

/*
  Gráfico de tendência Produção × Saídas por dia — SVG desenhado à mão, sem
  biblioteca, para não pesar no PWA e seguir a estética plana/mono do sistema.

  Interações (só as que ajudam a decidir): passar o mouse mostra o dia com os dois
  pesos; clicar fixa o tooltip (útil no toque e para ler o número exato); a legenda
  liga/desliga cada série. Sem zoom, sem animação decorativa.

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

function fmtKg(n: number): string {
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
  const [hover, setHover] = useState<number | null>(null);
  const [fixado, setFixado] = useState<number | null>(null);
  const [mostrar, setMostrar] = useState({ producao: true, saidas: true });

  const n = serie.length;
  const ativo = fixado ?? hover;

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

  const maxY = Math.max(
    1,
    ...serie.map((p) => Math.max(mostrar.producao ? p.producaoKg : 0, mostrar.saidas ? p.saidasKg : 0)),
  );

  const xFor = (i: number) => PAD.left + (i / (n - 1)) * PLOT_W;
  const yFor = (v: number) => PAD.top + PLOT_H - (v / maxY) * PLOT_H;
  const base = PAD.top + PLOT_H;

  const linha = (chave: "producaoKg" | "saidasKg") =>
    serie.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p[chave]).toFixed(1)}`).join(" ");
  const area = (chave: "producaoKg" | "saidasKg") =>
    `M ${xFor(0).toFixed(1)} ${base} ` +
    serie.map((p, i) => `L ${xFor(i).toFixed(1)} ${yFor(p[chave]).toFixed(1)}`).join(" ") +
    ` L ${xFor(n - 1).toFixed(1)} ${base} Z`;

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
        aria-label={`Tendência de ${n} dias. Produção total ${fmtKg(total.producao)} kg, saídas total ${fmtKg(total.saidas)} kg.`}
        onMouseMove={moverMouse}
        onMouseLeave={() => fixado === null && setHover(null)}
        onClick={clicar}
      >
        {/* guias horizontais + rótulos Y */}
        {guias.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="var(--color-borda)"
              strokeWidth={1}
              strokeDasharray={i === 0 ? "0" : "3 3"}
            />
            <text x={PAD.left - 8} y={yFor(v) + 3} textAnchor="end" className="font-mono" fontSize={10} fill="var(--color-texto-fraco)">
              {fmtKg(v)}
            </text>
          </g>
        ))}

        {/* rótulos X */}
        {serie.map((p, i) =>
          i % passoX === 0 || i === n - 1 ? (
            <text key={i} x={xFor(i)} y={H - 10} textAnchor="middle" className="font-mono" fontSize={10} fill="var(--color-texto-fraco)">
              {rotuloDia(p.dia)}
            </text>
          ) : null,
        )}

        {/* áreas + linhas */}
        {mostrar.producao ? (
          <>
            <path d={area("producaoKg")} fill="var(--color-entrada)" opacity={0.08} />
            <path d={linha("producaoKg")} fill="none" stroke="var(--color-entrada)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        ) : null}
        {mostrar.saidas ? (
          <>
            <path d={area("saidasKg")} fill="var(--color-saida)" opacity={0.08} />
            <path d={linha("saidasKg")} fill="none" stroke="var(--color-saida)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 3" />
          </>
        ) : null}

        {/* guia vertical + pontos do dia ativo */}
        {ativo !== null ? (
          <g>
            <line x1={xFor(ativo)} x2={xFor(ativo)} y1={PAD.top} y2={base} stroke="var(--color-borda-forte)" strokeWidth={1} />
            {mostrar.producao ? (
              <circle cx={xFor(ativo)} cy={yFor(serie[ativo].producaoKg)} r={3.5} fill="var(--color-entrada)" stroke="var(--color-superficie)" strokeWidth={1.5} />
            ) : null}
            {mostrar.saidas ? (
              <circle cx={xFor(ativo)} cy={yFor(serie[ativo].saidasKg)} r={3.5} fill="var(--color-saida)" stroke="var(--color-superficie)" strokeWidth={1.5} />
            ) : null}
          </g>
        ) : null}
      </svg>

      {/* Tooltip HTML posicionado por % (o viewBox escala uniforme) */}
      {ativo !== null ? (
        <div
          className={`absolute top-9 z-10 -translate-x-1/2 rounded-lg border border-borda bg-superficie px-3 py-2 shadow-sm ${
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
            <span className="ml-auto pl-3 font-mono font-semibold text-texto">{fmtKg(serie[ativo].producaoKg)} kg</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px]">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-saida)" }} />
            <span className="text-texto-suave">Saídas</span>
            <span className="ml-auto pl-3 font-mono font-semibold text-texto">{fmtKg(serie[ativo].saidasKg)} kg</span>
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
      <span className="h-2 w-2 rounded-full" style={{ background: ativo ? cor : "var(--color-borda-forte)" }} />
      {rotulo}
    </button>
  );
}
