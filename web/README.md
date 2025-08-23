# Terminal Matrix (Web)

Interface de terminal em Next.js (App Router) com integração Firebase (Auth + Firestore) e UI inspirada no tema Matrix/CRT.

## Principais recursos
- Autenticação por e-mail/senha (Firebase Auth), com verificação de e-mail opcional
- Chat em tempo real (Firestore) com histórico e assinatura de mensagens
- Modo convidado (mensagens locais) e shell autenticado com comandos
- Terminal baseado em xterm.js com ajuste automático de layout (addon fit)
- Organização de código por responsabilidades (components, services, hooks, utils, types)
- Padronização com ESLint + Prettier

### Novidades em v1.1
- Adicionadas variáveis para o terminal remoto: `NEXT_PUBLIC_PTY_WSS_URL`, `NEXT_PUBLIC_PTY_TOKEN_TRANSPORT=query`, `NEXT_PUBLIC_PTY_TOKEN_QUERY_KEY=token`
- Documentação de uso do Gateway WebSocket (WSS), teste com `wscat` e exemplo de proxy (Caddy)
- Logs de autenticação no gateway para facilitar troubleshooting
- Removido conteúdo padrão do template em inglês

## Estrutura do projeto (recorte relevante)
```
web/
├─ src/
│  ├─ app/          # Rotas e handlers (App Router)
│  ├─ components/   # Ex.: TerminalConsole
│  ├─ services/
│  ├─ hooks/
│  ├─ utils/
│  └─ types/
├─ public/
├─ package.json
├─ tsconfig.json     # Aliases @/services/*, @/components/*
├─ .eslintrc.json
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

## Scripts (na pasta `web`)
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

## Licença
MIT
