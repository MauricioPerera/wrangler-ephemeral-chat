# 💬 Ephemeral Chat

🌐 [Español](./README.md) · [English](./README.en.md) · **Português**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/MauricioPerera/wrangler-ephemeral-chat)

🌐 **[Landing page](https://mauricioperera.github.io/wrangler-ephemeral-chat/)** — apresentação visual do projeto, disponível em español / English / português.

Um chat em tempo real que é implantado em segundos numa **conta temporária da Cloudflare**, sem precisar de login, e **se autodestrói sozinho** quando essa conta expira (~1 hora).

Construído sobre [Durable Objects](https://developers.cloudflare.com/durable-objects/) (WebSockets + SQLite) e a flag [`wrangler deploy --temporary`](https://developers.cloudflare.com/workers/platform/claim-deployments/).

Irmão de [wrangler-ephemeral-whiteboard](https://github.com/MauricioPerera/wrangler-ephemeral-whiteboard) ([landing page](https://mauricioperera.github.io/wrangler-ephemeral-whiteboard/)) — mesmo padrão, mas para desenhar em vez de conversar — e [wrangler-ephemeral-airdrop](https://github.com/MauricioPerera/wrangler-ephemeral-airdrop) ([landing page](https://mauricioperera.github.io/wrangler-ephemeral-airdrop/)) — para compartilhar um arquivo via QR/link sem que quem recebe tenha estado conectado antes.

## Como funciona

- `wrangler deploy --temporary` cria uma conta temporária da Cloudflare (sem login), implanta o Worker e te dá uma URL pública em `workers.dev`.
- Essa conta — e tudo que ela contém: o Worker, o chat, as mensagens — vive por **~60 minutos**. Se ninguém a reivindicar (abrindo a claim URL que o wrangler imprime e completando o login), a Cloudflare a apaga automaticamente. Não há nada para limpar.
- O chat em si roda em um único Durable Object com estado em SQLite: mensagens, configuração da sala e convites.

## Requisitos

- Node.js
- Wrangler **4.102.0 ou superior**
- **Não estar logado** no Wrangler (`wrangler logout` se já tiver sessão) — `--temporary` só funciona sem credenciais existentes

## Deploy

```bash
git clone https://github.com/MauricioPerera/wrangler-ephemeral-chat.git
cd wrangler-ephemeral-chat
npm install
npx wrangler deploy --temporary
```

A saída te dá a URL do chat e uma **claim URL**. Compartilhe a URL do chat com quem você quiser convidar. Se quiser ficar com o Worker permanentemente, abra a claim URL e complete o login da Cloudflare antes da hora acabar — se não fizer nada, tudo se apaga sozinho.

### Deploy permanente (opcional)

Se preferir que não expire, rode `wrangler login` e depois `npx wrangler deploy` em vez de `--temporary`.

Você também pode usar o botão **Deploy to Cloudflare** acima: ele clona o repositório para sua conta do GitHub/GitLab, provisiona os recursos necessários (o Durable Object) e implanta na sua conta da Cloudflare, com CI/CD (Workers Builds) para futuros pushes. Diferente do `--temporary`, esse caminho exige login na Cloudflare e o Worker **não expira** — é a via para ficar com o chat permanentemente sem passar pela CLI. Mais informações: [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/).

## Funcionalidades

- **Chat em tempo real** via WebSockets (Hibernation API dos Durable Objects)
- **Histórico persistente** (últimas 50 mensagens por sala, no SQLite do próprio Durable Object)
- **Identidade por mensagem**: nome + cor por usuário
- **Modo aberto / fechado**: qualquer um com o link (aberto) vs. só convidados (fechado)
- **Admin**: quem conecta primeiro com `?admin=1` vira admin; recebe um link com token para reconectar como admin depois
- **Convites de uso único**: o admin gera links `?invite=<token>` que são consumidos no primeiro uso
- **Banner de contagem regressiva**: mostra quanto falta (aproximado) para a conta temporária expirar
- **UI mobile-friendly**: tela cheia no celular, balões de chat, escape de HTML (sem XSS)

## Uso

1. Abra a URL do deploy → tela de login, coloque um nome.
2. Para ser admin da sala: adicione `?admin=1` na URL na primeira vez que entrar. Guarde o link com seu token de admin mostrado no painel — você vai precisar dele para voltar a entrar como admin.
3. No painel admin: alterne entre sala aberta/fechada, e gere convites (um link por pessoa, de uso único).

## Estrutura

```
src/index.js       — Worker + Durable Object (ChatRoom) + UI embutida
wrangler.jsonc      — config do Worker e binding do Durable Object
```

Todo o frontend vive embutido como HTML/CSS/JS dentro do próprio Worker — sem build step, sem assets externos.

## Limitações (herdadas das contas temporárias da Cloudflare)

- Durable Objects, KV, D1, Hyperdrive, Queues e certificados mTLS são suportados em contas temporárias — **R2 e Vectorize não**.
- O timer de 60 minutos é fixo a partir da criação da conta, não se estende com atividade.
- Os tokens da conta temporária não têm todas as permissões de uma conta real.

Mais informações: [Claim deployments · Cloudflare Workers docs](https://developers.cloudflare.com/workers/platform/claim-deployments/)

## Você é um agente de IA?

Veja [AGENTS.md](./AGENTS.md) para instruções de deploy autônomo com `wrangler --temporary`: requisitos, comandos exatos, gotchas reais (credenciais em cache, subcomandos não suportados, verificação pós-deploy) e o que reportar ao usuário.
