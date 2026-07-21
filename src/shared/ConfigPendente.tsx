/*
  Tela mostrada apenas no setup, enquanto as chaves de Convex e Clerk ainda não
  foram preenchidas em .env.local. Some assim que as duas variáveis existirem.
  Não faz parte do produto final — é um andaime de configuração.
*/
export function ConfigPendente({
  temConvex,
  temClerk,
}: {
  temConvex: boolean;
  temClerk: boolean;
}) {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="border-borda w-full max-w-md rounded-lg border bg-superficie p-6">
        <h1 className="text-lg font-semibold text-texto">Estoque 065</h1>
        <p className="mt-2 text-sm text-texto-suave">
          O app subiu. Falta preencher as chaves de acesso em{" "}
          <code className="font-mono">.env.local</code> para conectar ao backend.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <span className="font-mono">{temConvex ? "✓" : "•"}</span>
            <span className="font-mono">VITE_CONVEX_URL</span>
            <span className="text-texto-suave">
              {temConvex ? "definida" : "faltando"}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span className="font-mono">{temClerk ? "✓" : "•"}</span>
            <span className="font-mono">VITE_CLERK_PUBLISHABLE_KEY</span>
            <span className="text-texto-suave">
              {temClerk ? "definida" : "faltando"}
            </span>
          </li>
        </ul>
      </div>
    </main>
  );
}
