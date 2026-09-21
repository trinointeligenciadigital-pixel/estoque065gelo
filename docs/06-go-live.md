# Estoque 065 — Roteiro de Go-Live

Passo a passo para colocar o sistema no ar na 065 Gelo. Feito para ser executado por
você, sem programação. Faça na ordem. Onde precisar rodar um comando, ele está em
`bloco de código` — é só colar no terminal, na pasta do projeto.

---

## Parte 1 — Colocar no ar (uma vez)

### 1.1 Backend em produção (Convex)

Até agora usamos o ambiente de **desenvolvimento**. Produção é separado.

```
npx convex deploy
```

Na primeira vez ele cria o ambiente de produção e mostra a URL dele
(algo como `https://<nome>.convex.cloud`). **Guarde essa URL** — o site vai apontar
para ela.

Depois configure a chave de login no ambiente de produção:

```
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://devoted-pipefish-40.clerk.accounts.dev --prod
```

E configure a **chave secreta do Clerk** — sem ela, convidar administradores pelo
painel não funciona (o convite usa a API do Clerk por trás):

```
npx convex env set CLERK_SECRET_KEY <chave-secreta-de-producao> --prod
```

> **Onde pegar a chave:** no painel do Clerk (dashboard.clerk.com), no aplicativo do
> Estoque 065, em **API Keys**, copie a **Secret key** do ambiente de **produção**
> (começa com `sk_live_...`). Troque `<chave-secreta-de-producao>` por ela no comando
> acima. Essa chave é secreta — não a compartilhe nem a coloque no site (frontend).

### 1.2 Trancar o cadastro no Clerk (CRÍTICO)

> **Por que:** hoje qualquer pessoa que conseguir fazer login vira Admin. Antes de
> divulgar o endereço, isso precisa ser fechado, senão é uma porta aberta.

1. Entre no painel do Clerk (dashboard.clerk.com), no aplicativo do Estoque 065.
2. Faça **você mesmo o primeiro login** de Admin no site, para criar sua conta.
3. No Clerk, em **User & Authentication → Restrictions** (ou "Sign-up"), **desligue o
   cadastro público** ("Sign-up" / "Allow sign-ups"). Deixe só **sign-in**.
4. Para liberar outro Admin no futuro: você o convida pelo próprio painel do Clerk
   (Invitations), não pela tela pública.

### 1.3 O site (frontend)

Publique em Netlify ou Vercel (qualquer um). Configuração:

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Variáveis de ambiente** (as de produção):
  - `VITE_CONVEX_URL` = a URL de produção do passo 1.1
  - `VITE_CLERK_PUBLISHABLE_KEY` = a chave publishable de produção do Clerk
- **Redirecionamento de rotas (SPA):** todas as rotas devem cair no `index.html`.
  No Netlify, crie um arquivo `public/_redirects` com a linha `/* /index.html 200`.
  Na Vercel isso já é automático para apps Vite.

Ao final, abra o endereço no computador e confirme que a tela de login do Admin
aparece.

### 1.4 Publicação automática (Netlify + Convex, uma vez)

Depois de configurado, todo envio (`git push`) para a branch `main` publica **o servidor
(Convex de produção) e o site**, sozinhos e na ordem certa. O arquivo `netlify.toml`, na
raiz do projeto, já traz essa receita — falta só ligar o Netlify ao GitHub e dar a chave.

1. **Chave de publicação do Convex.** No painel do Convex (dashboard.convex.dev), abra o
   projeto → escolha o ambiente **Production** → **Settings → Deploy Keys** → gere uma
   *Production Deploy Key* e copie. Ela é secreta: não cole em chat nem no código.
2. **Variáveis no Netlify.** No site, em **Site configuration → Environment variables**,
   crie:
   - `CONVEX_DEPLOY_KEY` = a chave do passo 1. Marque como **secreta** e deixe valer só
     para **Production** (pré-visualizações nunca devem receber essa chave).
   - `VITE_CLERK_PUBLISHABLE_KEY` = a chave publishable do Clerk **que o sistema já usa hoje**
     (`pk_test_...`, da instância de desenvolvimento — veja a nota abaixo).
   - Não precisa criar `VITE_CONVEX_URL`: a publicação a preenche sozinha.
3. **Ligar ao GitHub.** Em **Site configuration → Build & deploy → Continuous
   deployment → Link repository**, escolha GitHub, o repositório `estoque065gelo` e a
   branch `main`. As configurações de build vêm do `netlify.toml`; não precisa digitar
   nada.
4. **Teste.** Faça qualquer envio para a `main` e acompanhe em **Deploys** no Netlify. O
   log mostra primeiro "Deploying Convex functions" e depois o build do site.

> **Clerk sem domínio próprio.** O Clerk só cria uma instância de *produção* para um
> domínio que você registrou (ex.: `estoque.suaempresa.com.br`); endereços `*.netlify.app`
> ou `*.vercel.app` não servem. Enquanto o site ficar no endereço do Netlify, continue
> usando a instância de **desenvolvimento** do Clerk (chaves `pk_test_` / `sk_test_`, as
> mesmas de hoje): funciona normalmente para poucos administradores, mas tem limite de
> usuários e mostra o aviso "development keys" no console do navegador. Isso vale
> também para o `CLERK_SECRET_KEY` do passo 1.1 (use a `sk_test_`). Quando a 065 Gelo
> tiver um domínio próprio, aponte-o para o Netlify, crie a instância de produção no
> Clerk e troque só essas chaves (e o `CLERK_JWT_ISSUER_DOMAIN` no Convex de produção).
> Com cadastro público aberto qualquer login vira Admin — o passo 1.2 vale nos dois casos.

Se a publicação falhar, o site **continua na versão anterior** (o Netlify só troca quando
o build termina certo). Para voltar atrás: **Deploys →** versão anterior **→ Publish
deploy**. Atenção: isso volta o site, mas **não desfaz** funções do servidor já publicadas
no Convex; por isso, mudanças no servidor devem ser compatíveis com o site antigo por um
tempo (só acrescentar, não remover).

> **Depois de definir o endereço final, trocar o link do convite (uma vez):** o link
> que os administradores convidados recebem por e-mail está fixo no código, ainda
> apontando para o site de teste. Peça para trocar o `APP_URL` em
> `convex/admin/administradores.ts` pelo endereço de produção que você publicou aqui.
> Se esquecer, quem for convidado recebe um link para o site de teste e cria a senha
> no lugar errado.

---

## Parte 2 — Preparar os dados (no sistema, como Admin)

Faça nesta ordem, porque cada passo depende do anterior.

### 2.1 Câmaras
- **Câmaras → Nova câmara.** Crie a de **Saborizado** e a de **Cubo/Escamado**.
- Em cada uma, **Ver QR → Imprimir**. Cole o QR na porta da câmara correspondente.
  (Reimprimir depois não muda o QR — pode reimprimir à vontade.)

### 2.2 Produtos e formatos
- **Produtos → Novo produto.** Para cada **sabor** (Morango, Uva…), categoria
  *Saborizado*, câmara Saborizado. Para *Cubo* e *Escamado*, câmara Cubo/Escamado.
  A câmara é definida agora e **não muda depois**.
- Em cada produto, **Formatos → Novo formato**, com o peso e o **estoque mínimo
  daquele tamanho de pacote**:
  - Saborizado: pacote **5,7 kg**.
  - Cubo: **2 kg** e **4 kg** (dois formatos).
  - Escamado: pacote **20 kg**.
  - O estoque mínimo é por tamanho: ex. "cubo 2 kg, mínimo 50 pacotes". 0 = sem alerta.
  - Peso variável (granel) só se algum produto for vendido a quilo solto.

### 2.3 Veículos
- **Veículos → Novo.** Placa, modelo e motorista padrão de cada veículo próprio.

### 2.4 Colaboradores
- **Colaboradores → Novo.** Nome, câmaras permitidas e permissões (produção, saída,
  contar). Preencha o WhatsApp.
- **Gerar PIN** → o PIN aparece **uma única vez**. Use **Enviar por WhatsApp** (ou
  copie a mensagem) para mandar ao colaborador. Se perder, é só gerar outro — gerar
  um novo **derruba a sessão** e invalida o PIN anterior.

### 2.5 CONTAGEM INICIAL (obrigatória)

> **É ela que define o estoque de partida.** Sem isso, todo saldo nasce errado
> (o sistema começa do zero). Faça em **todas as câmaras** antes de operar de verdade.

Como o mesmo usuário não pode abrir e aprovar a própria contagem (regra de
segurança), o jeito mais simples:

1. O **colaborador** (com permissão de contar) escaneia o QR da câmara, entra com o
   PIN, e faz **Contar → Iniciar contagem**. Conta tudo, formato por formato, e
   **Fecha a contagem**.
2. Você, como **Admin**, vai em **Contagens → Conferir → Aprovar**. Como o estoque
   do sistema estava zerado, a divergência é o próprio contado — a aprovação lança
   isso como saldo inicial.
3. Repita para cada câmara.

(Se preferir fazer você mesmo a contagem, precisa de um **segundo Admin** para
aprovar — a regra vale inclusive entre dois Admins.)

---

## Parte 3 — Treinar a equipe

- **Lançar:** escanear o QR da câmara → PIN → Produção / Saída / Ver saldo / Contar.
  Sempre esperar o "registrado com sucesso" (o sistema é online; se travar a
  internet, o lançamento não some nem duplica — pode repetir sem medo).
- **Desligamento de colaborador:** ao sair da empresa, o Admin **desativa** o
  colaborador (Colaboradores → Editar → desmarcar Ativo). Isso derruba a sessão dele
  na hora. Isso precisa virar rotina — a trava existe no sistema, mas alguém tem que
  acionar.

---

## Checklist final (critérios de aceite do PRD, §10)

- [ ] 1. Nenhum campo `saldo` existe; todo saldo é somado do histórico
- [ ] 2. Nenhuma movimentação é editável ou apagável, por ninguém
- [ ] 3. Colaborador lança sem sair da câmara do QR escaneado
- [ ] 4. Saída acima do saldo é bloqueada, sem saldo negativo
- [ ] 5. Contagem fechada não altera o estoque sem a aprovação do Admin
- [ ] 6. Quem abre a contagem não aprova
- [ ] 7. Retorno nunca soma mais do que saiu no patrocínio
- [ ] 8. Painel mostra saldo por sabor e por categoria (em peso)
- [ ] 9. Duplo-toque não duplica lançamento
- [ ] 10. Badge de estoque abaixo do mínimo na tela inicial do Admin
- [ ] 11. PIN individual; novo PIN derruba a sessão na hora
- [ ] 12. Colaborador consulta saldo via QR + PIN, sem gerar movimentação
- [ ] 13. Contagem compara divergência por formato

## Observações

- **Fuso:** todas as datas e horas aparecem no horário de Cuiabá (UTC−4).
- **Limpeza automática:** um robô diário (04h de Cuiabá) apaga sessões vencidas.
  Mesmo que ele não rode, uma sessão vencida já não autoriza nada.
- **Instalar no celular:** ao abrir o endereço no Chrome do Android, aparece a opção
  "Adicionar à tela inicial" — vira um ícone (065) como um aplicativo.
