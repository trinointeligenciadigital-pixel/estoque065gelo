/*
  Integração Convex <-> Clerk (só o Admin autentica por aqui).
  O domínio do emissor (issuer) do JWT vem do Clerk e é gravado como variável
  de ambiente DO CONVEX, não do frontend:

    npx convex env set CLERK_JWT_ISSUER_DOMAIN https://SEU-DOMINIO.clerk.accounts.dev

  applicationID "convex" precisa bater com o nome do JWT template criado no
  painel do Clerk (Configure > JWT Templates > New > Convex).
*/
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
