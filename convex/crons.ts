import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/*
  Crons. Limpeza diária de sessões expiradas (RF09). Roda de madrugada em Cuiabá
  (08h UTC = 04h UTC−4), horário morto para a fábrica.

  Lembrete: sessão expirada nunca autoriza nada mesmo que o cron não tenha rodado —
  a validação é por `expiraEm` a cada chamada, não pela existência do registro.
*/
const crons = cronJobs();

crons.daily(
  "limpar sessoes expiradas",
  { hourUTC: 8, minuteUTC: 0 },
  internal.manutencao.limparSessoesExpiradas,
);

// Convites de Admin com mais de 7 dias desde o último envio (correção "quatro
// ajustes pontuais", tarefa 1): revoga o token antigo no Clerk. O convite
// continua na lista com o badge "expirado" — só o link para de funcionar.
crons.daily(
  "expirar convites de admin antigos",
  { hourUTC: 8, minuteUTC: 5 },
  internal.admin.administradores.expirarConvitesAntigos,
);

export default crons;
