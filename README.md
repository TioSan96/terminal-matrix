# Terminal Matrix

Interface de terminal em Next.js (App Router) com integração Firebase (Auth + Firestore) e UI inspirada no tema Matrix/CRT.

## Principais recursos
- Autenticação por e-mail/senha (Firebase Auth), com verificação de e-mail opcional
- Chat em tempo real (Firestore) com histórico e assinatura de mensagens
- Modo convidado (mensagens locais) e shell autenticado com comandos
- Terminal baseado em xterm.js com ajuste automático de layout (addon fit)
- Organização de código por responsabilidades (components, services, hooks, utils, types)
- Padronização com ESLint + Prettier

### Novidades em v1.1
- Gateway WebSocket (WSS) ajustado para ler `ORIGIN_ALLOW` do ambiente e liberar `http://localhost:3000` em dev
- Validação de token do Firebase com logs de erro detalhados para facilitar troubleshooting
- Inicialização do Firebase Admin com `projectId` vindo das variáveis de ambiente
- Documentação do deploy do gateway via systemd e de testes com `wscat`
- Removido os slash commands no terminal

## Estrutura do projeto
```
/
├─ firebase.json                # Config Firebase Hosting/Firestore Rules
├─ firestore.rules              # Regras do Firestore
├─ .firebaserc
├─ public/                      # (raiz) assets estáticos do hosting raiz (se necessário)
└─ matrix-frontend/
   └─ web/                      # Aplicação Next.js (Next 14 - App Router)
      ├─ src/
      │  ├─ app/               # Rotas e handlers (App Router)
      │  ├─ components/        # Componentes de UI (ex.: TerminalConsole)
      │  ├─ hooks/
      │  ├─ services/          # Serviços (ex.: Firebase)
      │  ├─ utils/
      │  └─ types/
      ├─ public/               # Assets públicos do app Next
      ├─ package.json
      ├─ tsconfig.json         # Inclui alias @/services/*, @/components/*
      ├─ .eslintrc.json        # ESLint + Prettier integrados
      ├─ .prettierrc
      └─ .prettierignore
```

## Requisitos
- Node.js 18+
- Conta Firebase (projeto com Auth e Firestore)

## Variáveis de ambiente (Next.js)
Crie `matrix-frontend/web/.env.local` com:
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_PTY_WSS_URL=wss://<seu-dominio-ou-ip>/ws
NEXT_PUBLIC_PTY_TOKEN_TRANSPORT=query
NEXT_PUBLIC_PTY_TOKEN_QUERY_KEY=token
```

## Scripts (na pasta `matrix-frontend/web`)
- `npm run dev` — inicia o servidor de desenvolvimento (http://localhost:3000)
- `npm run build` — build de produção
- `npm start` — executa o build
- `npm run lint` — roda o ESLint
- `npm run lint:fix` — tenta corrigir automaticamente
- `npm run format` — formata com Prettier

## Desenvolvimento local
```bash
cd matrix-frontend/web
npm install
npm run dev
```

Abra http://localhost:3000/terminal e, após autenticar, digite `shell` para abrir o terminal remoto.

## Deploy
Há duas rotas principais de deploy: Vercel (recomendado para Next) ou Firebase Hosting com Web Frameworks.

### Opção A: Vercel
1. Conecte o repositório na Vercel
2. Defina a pasta do projeto: `matrix-frontend/web`
3. Configure as variáveis `NEXT_PUBLIC_*`
4. Deploy

### Opção B: Firebase Hosting (Web Frameworks)
1. Instale Firebase CLI (firebase-tools) atualizado
2. Ative "Web Frameworks" durante o setup
3. Aponte o hosting para `matrix-frontend/web`
4. Configure as envs `NEXT_PUBLIC_*` no ambiente (ou `.env.local` em build)
5. `firebase deploy --only hosting`

Obs.: `firestore.rules` já está referenciado em `firebase.json`.

## Gateway WebSocket (WSS)
O gateway valida o ID Token do Firebase e inicia uma sessão de PTY ao conectar no caminho `/ws`.

### Arquivo do gateway
- O gateway roda fora deste repositório (por exemplo, em `/opt/terminalboot-gw/server.js`).
- Recomenda-se versioná-lo em um repositório/dir próprio de infra, mantendo este repo como o frontend.

### Variáveis de ambiente (systemd)
Defina as variáveis no serviço para garantir consistência com o projeto Firebase (ex.: `nome-do-seu-projeto`):

```
[Service]
Environment="FIREBASE_PROJECT_ID..."
Environment="GOOGLE_CLOUD_PROJECT..."
Environment="GCLOUD_PROJECT..."
Environment="ORIGIN_ALLOW=https://nome-do-seu-projeto.web.app,http://localhost:3000"
# Produção (opcional, recomendado se checar revogação de token):
# Environment="GOOGLE_APPLICATION_CREDENTIALS=..."
```

Após editar: `sudo systemctl daemon-reload && sudo systemctl restart terminalboot-gw`.

### Inicialização do Firebase Admin
O gateway inicializa o Admin SDK com `projectId` via env. Para checar revogação de token (`verifyIdToken(token, true)`), use uma Service Account via `GOOGLE_APPLICATION_CREDENTIALS` e `admin.credential.applicationDefault()`.

### Teste com wscat
Use um token ID válido e inclua o header `Origin`:

```bash
TOKEN="<JWT do DevTools>"
wscat -H 'Origin: http://localhost:3000' -c "ws://127.0.0.1:8081/ws?token=${TOKEN}"
```

### Proxy (Caddy) – exemplo
```
@ws {
  path /ws
}

handle @ws {
  reverse_proxy 127.0.0.1:8081 {
    header_up Host {host}
    header_up X-Forwarded-For {remote}
  }
}
```

## Changelog

### v1.1
- Ajuste de `ORIGIN_ALLOW` via env, incluindo `http://localhost:3000` para desenvolvimento
- Logs de autenticação detalhados no gateway (erros de token e origem)
- Inicialização do Firebase Admin com `projectId` do ambiente
- Documentação de systemd, Service Account e testes com `wscat`

### v1.0
- Primeira versão com Next.js (App Router), xterm.js e integração Firebase (Auth/Firestore)

## Licença
MIT
