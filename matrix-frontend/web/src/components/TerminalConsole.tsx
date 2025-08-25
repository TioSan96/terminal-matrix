'use client';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getAuth, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import { useRouter, usePathname } from 'next/navigation';
import {
  initializeFirebase,
  isFirebaseConfigured,
  authSignIn,
  authSignUp,
  onAuthChanged,
  signOutUser,
  isAdminUser,
  subscribeToMessages,
  sendMessage,
  fetchRecentMessages,
  resendEmailVerification,
  reloadCurrentUser,
} from '@/services/firebase';
import { connectPty } from '@/services/ptyClient';

// Theme global Matrix/CRT (sincronizado com globals.css)
// Inclui mapeamento ANSI para evitar verde mais escuro quando usamos \u001b[32m.
const termTheme = {
  background: '#000000',
  foreground: '#00ff9c',
  cursor: '#00ff9c',
  // ANSI palette mapping
  green: '#00ff9c',
  brightGreen: '#00ff9c',
} as const;

// Exibir logs de debug apenas quando explicitamente habilitado via env
const DEBUG =
  process.env.NEXT_PUBLIC_TERMINAL_DEBUG === '1' ||
  process.env.NEXT_PUBLIC_TERMINAL_DEBUG === 'true';

const DEFAULT_HOST = 'matrix';
const GUEST_HOST = 'matrix';

// Mede RTT até o servidor via endpoint local /api/ping
async function measurePing(): Promise<number> {
  const start =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  try {
    const res = await fetch('/api/ping', { cache: 'no-store' });
    // ler body para completar totalmente a resposta
    try {
      await res.json();
    } catch {}
  } catch (e) {
    // mesmo em erro de rede, reporta tentativa
  }
  const end =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  return Math.max(0, Math.round(end - start));
}

function inferEmailAndDisplay(input: string) {
  const trimmed = input.trim();
  if (trimmed.includes('@')) {
    const email = trimmed;
    const display = trimmed.split('@')[0] || 'user';
    return { email, display };
  }
  return { email: usernameToEmail(trimmed), display: trimmed };
}

function usernameToEmail(username: string) {
  return `${username}@private.local`;
}

type StartupMode = 'normal' | 'guestFailure' | 'authSplash' | 'noIntro' | 'chat';

export default function TerminalConsole({ startupMode = 'normal' }: { startupMode?: StartupMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ username: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // conexão PTY ativa (quando usuário roda "shell" no /terminal autenticado)
  const ptyConnRef = useRef<null | { dispose: () => void }>(null);
  const chatUnsubRef = useRef<null | (() => void)>(null);
  // áudio e animação ASCII
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const asciiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const asciiPlayingRef = useRef<boolean>(false);
  // shell autenticado pré-chat (em /terminal antes de entrar no chat)
  const authShellRef = useRef<boolean>(false);
  // evita eco duplicado quando a assinatura é recriada
  const printedIdsRef = useRef<Set<string>>(new Set());
  // mantém apenas um listener de teclado ativo por vez
  const keyListenerRef = useRef<{ dispose: () => void } | null>(null);
  // refs para evitar closures com estado desatualizado
  const currentUserRef = useRef<{ username: string } | null>(null);
  const isAdminRef = useRef<boolean>(false);
  const guestModeRef = useRef<boolean>(false);
  // lock para fluxos interativos (evita entrada de novos comandos até concluir)
  const promptLockRef = useRef<boolean>(false);
  // suprime UI de login durante a sequência de guestFailure
  const suppressLoginUIRef = useRef<boolean>(false);
  // controle de blink do cursor (pausado durante digitação)
  const cursorIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // guarda para evitar processar login duas vezes
  const authHandledRef = useRef<boolean>(false);
  // flag para saber se o sign-out foi solicitado explicitamente pelo usuário
  const logoutRequestedRef = useRef<boolean>(false);
  // controle para pular a sequência de digitação inicial em modo guest
  const typingCancelRef = useRef<boolean>(false);
  const startupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupSkippableRef = useRef<boolean>(false);
  // turbo: acelera toda a tipagem restante (sem quebrar layout)
  const turboTypingRef = useRef<boolean>(false);

  function setCursorPaused(paused: boolean) {
    const el = termRef.current?.element as HTMLDivElement | undefined;
    if (!el) return;
    if (paused) el.classList.add('cursor-paused');
    else el.classList.remove('cursor-paused');
  }

  // valida usernames: 3-20, [a-z0-9_-], não pode ser 'guest'
  function isValidUsername(name: string) {
    const n = (name || '').trim();
    if (n.toLowerCase() === 'guest') return false;
    return /^[a-z0-9_-]{3,20}$/.test(n);
  }

  async function enforceUsernameSetup(): Promise<string> {
    return new Promise((resolve) => {
      promptLockRef.current = true;
      writeln('set a username to continue. allowed: a-z, 0-9, _ and - (3-20).');
      const ask = () => {
        inputPrompt('username: ', async (nameIn) => {
          const candidate = (nameIn || '').trim();
          if (!isValidUsername(candidate)) {
            writeln('invalid username. allowed: a-z, 0-9, _ and - (3-20), not "guest".');
            return ask();
          }
          try {
            const u = getAuth().currentUser;
            if (!u) throw new Error('session expired');
            await updateProfile(u, { displayName: candidate });
            currentUserRef.current = { username: candidate };
            setCurrentUser({ username: candidate });
            const admin = isAdminUser(candidate);
            isAdminRef.current = admin;
            setIsAdmin(admin);
            writeln(`username set to ${candidate}${admin ? ' (admin)' : ''}`);
            promptLockRef.current = false;
            resolve(candidate);
          } catch (e: any) {
            writeln(`username error: ${e?.message || e}`);
            ask();
          }
        });
      };
      ask();
    });
  }

  // Ajuste seguro do terminal ao container (evita erro do renderer no dev)
  function safeFit() {
    try {
      const t = termRef.current;
      const f = fitRef.current;
      const c = containerRef.current;
      if (!t || !f || !c) return;
      // container precisa ter dimensões válidas
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!t.element || w <= 0 || h <= 0) return;
      f.fit();
    } catch {}
  }

  // fetch public IP (simple memoized)
  let clientIpCache: string | null = null;
  async function getClientIp(): Promise<string> {
    if (clientIpCache) return clientIpCache;
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      clientIpCache = String(data.ip || 'unknown');
      return clientIpCache;
    } catch (e) {
      // fallback endpoint
      try {
        const res2 = await fetch('https://ifconfig.me/ip');
        if (!res2.ok) throw new Error(`status ${res2.status}`);
        const txt = (await res2.text()).trim();
        clientIpCache = txt || 'unknown';
        return clientIpCache;
      } catch (e2: any) {
        throw e2;
      }
    }
  }

  // helper: digitar texto com efeito typewriter
  async function typeLine(text: string, speed = 12) {
    // foca o terminal e fixa o cursor durante digitação programática
    termRef.current?.focus();
    setCursorPaused(true);
    for (const ch of text.split('')) {
      write(ch);
      // aguarda ligeiramente (zero quando turbo)
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, turboTypingRef.current ? 0 : speed));
    }
    writeln('');
    setCursorPaused(false);
  }
  // hard clear: limpa tela e scrollback, volta ao topo
  function hardClear() {
    try {
      const t = termRef.current;
      if (!t || !t.element) return;
      t.write('\x1b[3J\x1b[H\x1b[2J');
    } catch {}
  }

  // sequência padrão do boot guest (linhas e entrada no prompt)
  async function runGuestStartupSequence() {
    // manter cursor visível
    termRef.current?.focus();
    writeln('System Failure...');
    writeln('Error checking login status.');
    // ativa modo guest sem cabeçalho e sem iniciar prompt ainda
    enterGuestMode(false, false);
    // sequência de entrada no chat escrita lentamente (linhas 3 e 4)
    writeln('returning to the terminal...');
    // no modo terminal-like não mostramos dicas de comandos com barra
    // agora sim, inicia o modo chat com prompt
    suppressLoginUIRef.current = false;
    enterChatMode(false);
    // garante que o cursor volte a piscar no prompt
    setCursorPaused(false);
    // se estava em modo turbo, desativa ao final
    turboTypingRef.current = false;
  }

  // -------- AUTH SPLASH + AUTH SHELL (pré-chat) --------
  async function runAuthStartupSequence() {
    termRef.current?.focus();
    writeln('System Failure...');
    writeln('Error checking login status.');
    writeln('returning to the terminal...');
    // sem dicas de slash commands no terminal-like
    enterAuthShell();
  }

  // Sequência de boot digitada específica do /terminal (sem intro)
  async function runTerminalBootSequence() {
    termRef.current?.focus();
    turboTypingRef.current = false; // garantir velocidade constante
    writeln('Initializing matrix console...');
    writeln('--------------------------------');
    writeln('');
    writeln('Connected to the system...');
    writeln('login status ok.');
    // sem banner de comandos
  }

  function enterAuthShell() {
    // garante que nenhum fluxo interativo anterior mantenha o lock
    promptLockRef.current = false;
    authShellRef.current = true;
    guestModeRef.current = false;
    // Evita banner redundante quando estamos no /terminal com noIntro
    const silentBanner = pathname === '/terminal' && startupMode === 'noIntro';
    if (!silentBanner) {
      writeln('');
      writeln('authenticated shell');
      if (pathname === '/terminal' && isAdminRef.current) {
        writeln('type "shell" to start a real session.');
      }
      writeln('');
    }
    authShellInputLoop();
  }

  function authShellInputLoop() {
    if (promptLockRef.current) return;
    setCursorPaused(false);
    inputPrompt(promptPrefix(), async (line) => {
      const text = line.trim();
      if (!text) return authShellInputLoop();
      // Terminal-like: sem barra. Comandos suportados: shell (no /terminal), clear, ping, username, logout, chat
      if (text.startsWith('music')) {
        const parts = text.split(' ').filter(Boolean);
        const urlArg = parts[1];
        const url = urlArg || process.env.NEXT_PUBLIC_MUSIC_URL || '/music/wake-up-matrix.mp3';
        await startMusicWithAscii(url);
        return; // ficará aguardando Ctrl+C
      }
      if (text === 'help') {
        writeln('available commands:');
        writeln('help        - show this help');
        writeln('clear       - clear screen');
        writeln('ping        - measure latency (RTT)');
        writeln('music       - play "Wake Up (The Matrix)" with ASCII visualizer (Ctrl+C to stop)');
        writeln('username <new> - change your username');
        writeln('logout      - sign out');
        if (pathname === '/terminal') {
          writeln('chat        - open chat page');
          if (isAdminRef.current) {
            writeln('shell       - start a real session (admin only)');
          }
        }
        return authShellInputLoop();
      }
      if (pathname === '/terminal' && text === 'shell') {
        if (!isAdminRef.current) {
          writeln('bash: shell: command not found');
          return authShellInputLoop();
        }
        // iniciar PTY real
        if (!termRef.current) return;
        // encerra qualquer listener de prompt ativo
        try { keyListenerRef.current?.dispose?.(); } catch {}
        keyListenerRef.current = null;
        promptLockRef.current = true;
        writeln('[connecting shell...]');
        try {
          const conn = await connectPty({
            term: termRef.current,
            onClose: (reason?: string) => {
              try { writeln(`\r\n[shell closed] ${reason || ''}`); } catch {}
              ptyConnRef.current = null;
              promptLockRef.current = false;
              authShellInputLoop();
            },
          });
          ptyConnRef.current = conn;
          // agora o controle de I/O fica com o PTY até fechar
          return;
        } catch (e: any) {
          writeln(`[shell error] ${e?.message || e}`);
          promptLockRef.current = false;
          return authShellInputLoop();
        }
      }
      if (text === 'clear') {
        hardClear();
        return authShellInputLoop();
      }
      if (text === 'ping') {
        const rtt = await measurePing();
        writeln(`pong: ${rtt} ms`);
        return authShellInputLoop();
      }
      if (text.startsWith('username ')) {
        const candidate = text.slice('username '.length).trim();
        if (!candidate) {
          promptLockRef.current = false;
          await enforceUsernameSetup();
          return authShellInputLoop();
        }
        if (!isValidUsername(candidate)) {
          writeln('invalid username. allowed: a-z, 0-9, _ and - (3-20), not "guest".');
          return authShellInputLoop();
        }
        try {
          const u = getAuth().currentUser;
          if (!u) throw new Error('session expired');
          await updateProfile(u, { displayName: candidate });
          currentUserRef.current = { username: candidate };
          setCurrentUser({ username: candidate });
          const admin = isAdminUser(candidate);
          isAdminRef.current = admin;
          setIsAdmin(admin);
          writeln(`username changed to ${candidate}${admin ? ' (admin)' : ''}`);
        } catch (e: any) {
          writeln(`username error: ${e?.message || e}`);
        }
        return authShellInputLoop();
      }
      if (text === 'logout') {
        promptLockRef.current = true;
        try { keyListenerRef.current?.dispose?.(); } catch {}
        logoutRequestedRef.current = true;
        await signOutUser();
        return;
      }
      if (text === 'chat') {
        authShellRef.current = false;
        writeln('opening chat page...');
        router.push('/terminal/chat');
        return;
      }
      // fallback terminal-like
      writeln(`bash: ${text}: command not found`);
      return authShellInputLoop();
    });
  }

  // auth + firebase init
  useEffect(() => {
    // Em noIntro (home ou terminal), não mostrar UI de login nem logs verbosos
    if (startupMode === 'noIntro') {
      suppressLoginUIRef.current = true;
    }
    // No /terminal/chat com modo chat, aguardar onAuthChanged para decidir fluxo (auth vs guest)
    if (pathname === '/terminal/chat' && startupMode === 'chat') {
      suppressLoginUIRef.current = true;
    }
    initializeFirebase();
    // Intro desejada: se startupMode for 'guestFailure', sempre executa sequência e entra como guest
    if (startupMode === 'guestFailure') {
      suppressLoginUIRef.current = true;
      startupSkippableRef.current = true;
      const id = setTimeout(async () => {
        await runGuestStartupSequence();
        startupSkippableRef.current = false;
      }, 300);
      startupTimerRef.current = id;
      return () => clearTimeout(id);
    }
    if (!isFirebaseConfigured()) {
      // Sem config do Firebase, cair para guest
      suppressLoginUIRef.current = true;
      startupSkippableRef.current = true;
      const id = setTimeout(async () => {
        await runGuestStartupSequence();
        startupSkippableRef.current = false;
      }, 300);
      startupTimerRef.current = id;
      return () => clearTimeout(id);
    }
    const dispose = onAuthChanged(async (u) => {
      try {
        if (u) {
          const silent = suppressLoginUIRef.current;
          if (DEBUG && !silent) writeln('[debug] onAuthChanged: authenticated');
          if (authHandledRef.current) return;
          authHandledRef.current = true;
          if (!u.emailVerified && !silent) {
            writeln('warning: account not verified. proceed with limited features.');
          }
          // força definir username se inexistente
          if (!u.displayName) {
            await enforceUsernameSetup();
          }
          const uname = getAuth().currentUser?.displayName || u.email?.split('@')[0] || 'user';
          setCurrentUser({ username: uname });
          currentUserRef.current = { username: uname };
          const admin = isAdminUser(uname);
          isAdminRef.current = admin;
          setIsAdmin(admin);
          if (!(pathname === '/terminal' && startupMode === 'noIntro')) {
            writeLine(`\r\n[auth] logged in as ${uname}${admin ? ' (admin)' : ''}`);
            writeLine('you have successfully connected to the network');
          }
          // Entrar no modo apropriado; se não estiver em /terminal ou /terminal/chat, redirecionar para /terminal
          if (pathname !== '/terminal' && pathname !== '/terminal/chat') {
            router.push('/terminal');
          } else if (startupMode === 'authSplash') {
            await runAuthStartupSequence();
          } else if (startupMode === 'noIntro') {
            await runTerminalBootSequence();
            enterAuthShell();
          } else if (pathname === '/terminal/chat' && startupMode === 'chat') {
            await showChatWelcome(true);
            enterChatMode(false);
          } else if (pathname?.startsWith('/terminal')) {
            enterChatMode();
            setCursorPaused(false);
          } else {
            // Home (ou outras): comportamento tipo shell autenticado
            enterAuthShell();
          }
        } else {
          if (DEBUG && !suppressLoginUIRef.current) writeln('[debug] onAuthChanged: null user');
          authHandledRef.current = false;
          setCurrentUser(null);
          currentUserRef.current = null;
          setIsAdmin(false);
          isAdminRef.current = false;
          // limpa dedupe quando saindo da conta
          printedIdsRef.current = new Set();
          // Se o logout foi solicitado pelo usuário, entramos em modo guest
          if (logoutRequestedRef.current) {
            // encerra qualquer assinatura de chat autenticado
            try {
              chatUnsubRef.current?.();
            } catch {}
            chatUnsubRef.current = null;
            writeln('you have successfully disconnected from the network');
            // ativa modo guest e inicia terminal guest
            enterGuestMode(true, true);
            logoutRequestedRef.current = false;
            if (pathname && pathname === '/terminal') router.push('/');
          } else {
            // sessão expirou ou sign-out externo
            if (pathname === '/terminal/chat' && startupMode === 'chat') {
              // permanecer na página de chat em modo guest, com banner
              suppressLoginUIRef.current = true;
              await showChatWelcome(false);
              enterGuestMode(false, true);
            } else if (startupMode === 'noIntro') {
              // Home/terminal em noIntro: restaurar efeito de mensagens
              suppressLoginUIRef.current = true;
              if (pathname === '/terminal') {
                // no /terminal: entra como guest direto
                enterGuestMode(true, true);
              } else {
                // home (/) ou outras rotas: roda sequência com typewriter
                await runGuestStartupSequence();
              }
            } else {
              showLogin();
            }
          }
        }
      } catch (e: any) {
        writeln(`[auth handler error] ${e?.message || e}`);
        showLogin();
      }
    });
    return () => dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // listener para atalho Ctrl+Shift+L: pular sequência de digitação em modo guest
  useEffect(() => {
    function skipGuestIntro() {
      if (!startupSkippableRef.current) return;
      // Interrompe qualquer timer pendente e entra direto no guest chat
      if (startupTimerRef.current) {
        clearTimeout(startupTimerRef.current);
        startupTimerRef.current = null;
      }
      turboTypingRef.current = false;
      try {
        hardClear();
      } catch {}
      // Ativa modo guest e inicia o chat imediatamente
      suppressLoginUIRef.current = true;
      enterGuestMode(true, true);
      setCursorPaused(false);
      startupSkippableRef.current = false;
    }
    const onKey = (ev: KeyboardEvent) => {
      // Desabilita o atalho durante a intro (Initializing/System Failure...)
      if (startupSkippableRef.current) return;
      if (ev.ctrlKey && ev.code === 'KeyL') {
        // Ctrl+L ou Ctrl+Shift+L
        ev.preventDefault();
        skipGuestIntro();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // init terminal
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    const term = new Terminal({
      cursorStyle: 'block',
      cursorBlink: false,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      theme: termTheme as any,
      allowProposedApi: true,
    });
    term.open(containerRef.current);
    termRef.current = term;
    // carregar addon de ajuste automático ao container
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    // aguarda próximo tick para garantir renderer inicializado
    setTimeout(() => safeFit(), 0);
    // reagir a resize da janela
    const onResize = () => {
      // usa rAF para não forçar layout em bursts
      requestAnimationFrame(() => {
        safeFit();
      });
    };
    window.addEventListener('resize', onResize);
    setReady(true);

    // Escreve as linhas de boot apenas fora dos modos noIntro e chat
    if (startupMode !== 'noIntro' && startupMode !== 'chat') {
      term.write('\u001b[32m'); // green
      term.writeln('Initializing matrix console...');
      term.writeln('--------------------------------');
      term.writeln('');
    }

    return () => {
      window.removeEventListener('resize', onResize);
      try {
        // Desativa blink para evitar animation frame após o dispose
        term.options = { ...term.options, cursorBlink: false } as any;
      } catch {}
      try {
        // Melhor esforço: força um refresh para estabilizar antes do dispose
        term.refresh(0, 0);
      } catch {}
      try {
        term.dispose();
      } finally {
        termRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ready || !termRef.current) return;
    if (!currentUser && isFirebaseConfigured() && !suppressLoginUIRef.current) {
      showLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // -------- LOGIN INLINE --------
  function showLogin() {
    if (!termRef.current) return;
    promptLockRef.current = true; // impede múltiplos prompts em paralelo
    writeln('login: enter your email.');
    inputPrompt('email: ', (emailIn) => {
      const email = (emailIn || '').trim();
      const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
      if (!emailOk) {
        writeln('invalid email: please provide a valid address like user@example.com');
        // volta ao prompt guest para permitir /register ou tentar novamente
        promptLockRef.current = false;
        return returnToGuest();
      }
      inputPassword('password: ', async (pwdIn) => {
        try {
          const display = email.split('@')[0] || 'user';
          await authSignIn(email, pwdIn, display);
          writeLine('[auth] login successful, initializing...');
          // recarrega e garante transição imediata ao shell autenticado
          await reloadCurrentUser();
          const u = getAuth().currentUser;
          if (!u) throw new Error('authentication not ready');
          if (!u.emailVerified) {
            writeln('warning: account not verified. proceed with limited features.');
          }
          if (!u.displayName) {
            await enforceUsernameSetup();
          }
          const uname = getAuth().currentUser?.displayName || display;
          currentUserRef.current = { username: uname };
          setCurrentUser({ username: uname });
          const admin = isAdminUser(uname);
          isAdminRef.current = admin;
          setIsAdmin(admin);
          guestModeRef.current = false;
          authShellRef.current = true;
          authHandledRef.current = true;
          // libera qualquer lock de prompt deixado pelo fluxo de login
          promptLockRef.current = false;
          // entrar no modo apropriado conforme a rota atual, sem redirecionar
          if (pathname === '/terminal/chat' && startupMode === 'chat') {
            await showChatWelcome(true);
            enterChatMode(false);
          } else if (pathname && pathname.startsWith('/terminal')) {
            enterAuthShell();
          } else {
            // home (/) ou outras rotas
            enterAuthShell();
          }
        } catch (e: any) {
          writeln(`auth error: ${e?.message || e}`);
          // volta ao prompt guest para permitir /register
          promptLockRef.current = false;
          return returnToGuest();
        } finally {
          // sucesso cai no auth shell; em erro já retornamos ao guest acima
        }
      });
    });
  }

  function write(text: string) {
    try {
      const t = termRef.current;
      if (!t || !t.element) return;
      t.write(text);
    } catch {}
  }
  function writeln(text: string) {
    try {
      const t = termRef.current;
      if (!t || !t.element) return;
      t.writeln(text);
    } catch {}
  }
  function clear() {
    try {
      const t = termRef.current;
      if (!t || !t.element) return;
      t.clear();
    } catch {}
  }
  function writeLine(text: string) {
    writeln(text);
  }

  // -------- MUSIC + ASCII VISUALIZER --------
  async function startMusicWithAscii(url: string) {
    if (!termRef.current) return;
    try {
      // bloquear prompt
      promptLockRef.current = true;
      // preparar áudio
      let audio = audioRef.current;
      if (!audio) return writeln('audio element not ready');
      // configurar fonte
      audio.src = url;
      audio.crossOrigin = 'anonymous';
      await audio.play().catch((e: any) => {
        writeln(`[audio] failed to play: ${e?.message || e}`);
        throw e;
      });

      // WebAudio graph
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(ctx.destination);

      const buf = new Uint8Array(analyser.frequencyBinCount);
      asciiPlayingRef.current = true;
      writeln('music: press Ctrl+C to stop and return to home...');
      // listener de Ctrl+C
      try { keyListenerRef.current?.dispose?.(); } catch {}
      const onData = termRef.current.onData((d: string) => {
        if (d === '\x03') {
          stopMusicWithAscii(true);
        }
      });
      keyListenerRef.current = { dispose: () => { try { onData.dispose(); } catch {} } } as any;

      // Barra única baseada na média do espectro
      if (asciiTimerRef.current) clearInterval(asciiTimerRef.current);
      asciiTimerRef.current = setInterval(() => {
        if (!asciiPlayingRef.current || !termRef.current) return;
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) sum += buf[i];
        const avg = sum / buf.length; // 0..255
        const cols = Math.max(10, Math.min(120, Math.floor((avg / 255) * 120)));
        const bar = '#'.repeat(cols);
        write('\r');
        write('\x1b[2K'); // clear line
        write(bar);
      }, 80);
    } catch (e: any) {
      writeln(`[music] error: ${e?.message || e}`);
      promptLockRef.current = false;
    }
  }

  function stopMusicWithAscii(navigateHome = false) {
    try {
      asciiPlayingRef.current = false;
      if (asciiTimerRef.current) {
        clearInterval(asciiTimerRef.current);
        asciiTimerRef.current = null;
      }
      try { keyListenerRef.current?.dispose?.(); } catch {}
      keyListenerRef.current = null;
      const a = audioRef.current;
      if (a) {
        try { a.pause(); } catch {}
        try { a.currentTime = 0; } catch {}
      }
      // Linha simples: apenas quebra de linha antes da mensagem
      writeln('\n[music stopped]');
    } finally {
      promptLockRef.current = false;
      if (navigateHome) {
        try { router.push('/'); } catch {}
        // fallback: rearmar prompt caso a navegação não ocorra
        ensurePromptReady(400);
        try { setTimeout(() => { termRef.current?.focus(); }, 20); } catch {}
      } else {
        ensurePromptReady(400);
        try { setTimeout(() => { termRef.current?.focus(); }, 20); } catch {}
      }
    }
  }

  // -------- INPUT HELPERS --------
  function inputPrompt(label: string, cb: (v: string) => void) {
    const term = termRef.current;
    if (!term) return; // terminal desmontado
    write(label);
    let buffer = '';
    // garante que não haja dois listeners simultâneos
    keyListenerRef.current?.dispose?.();
    const keyListener = term.onKey((e: { key: string; domEvent: KeyboardEvent }) => {
      // pausa blink ao digitar e retoma após idle
      setCursorPaused(true);
      if (cursorIdleTimerRef.current) clearTimeout(cursorIdleTimerRef.current);
      cursorIdleTimerRef.current = setTimeout(() => setCursorPaused(false), 600);
    });
    const dataListener = term.onData((data: string) => {
      if (data === '\r') {
        writeln('');
        try {
          keyListener.dispose();
        } catch {}
        try {
          dataListener.dispose();
        } catch {}
        keyListenerRef.current = null;
        cb(buffer);
        return;
      }
      if (data === '\x7f') {
        // Backspace
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          write('\b \b');
        }
        return;
      }
      // ignora controle não imprimível
      if (data >= ' ' && data !== '\x7f') {
        buffer += data;
        write(data);
      }
    });
    keyListenerRef.current = {
      dispose: () => {
        try {
          keyListener.dispose();
        } catch {}
        try {
          dataListener.dispose();
        } catch {}
      },
    } as any;
  }

  function inputPassword(label: string, cb: (v: string) => void) {
    const term = termRef.current;
    if (!term) return; // terminal desmontado
    write(label);
    let buffer = '';
    // garante que não haja dois listeners simultâneos
    keyListenerRef.current?.dispose?.();
    const keyListener = term.onKey(() => {
      setCursorPaused(true);
      if (cursorIdleTimerRef.current) clearTimeout(cursorIdleTimerRef.current);
      cursorIdleTimerRef.current = setTimeout(() => setCursorPaused(false), 600);
    });
    const dataListener = term.onData((data: string) => {
      if (data === '\r') {
        writeln('');
        try {
          keyListener.dispose();
        } catch {}
        try {
          dataListener.dispose();
        } catch {}
        keyListenerRef.current = null;
        cb(buffer);
        return;
      }
      if (data === '\x7f') {
        // Backspace
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          write('\b \b');
        }
        return;
      }
      if (data >= ' ' && data !== '\x7f') {
        buffer += data;
        write('*'); // mask password
      }
    });
    keyListenerRef.current = {
      dispose: () => {
        try {
          keyListener.dispose();
        } catch {}
        try {
          dataListener.dispose();
        } catch {}
      },
    } as any;
  }

  // Mensagem de boas-vindas estilo "weechat" para o modo chat
  async function showChatWelcome(authenticated: boolean) {
    writeln('');
    writeln('================================ matrix chat ================================');
    writeln('welcome. type /help for commands. messages appear as they arrive.');
    writeln('---------------------------------------------------------------------------');
    try {
      const recent = await fetchRecentMessages(5);
      if (recent.length) {
        writeln('recent messages:');
        for (const m of recent) {
          const h = new Date(m.createdAt || Date.now()).toTimeString().slice(0, 8);
          writeln(`[${h}] ${m.username}: ${m.text}`);
        }
      } else {
        writeln('no recent messages.');
      }
    } catch (e: any) {
      writeln(`[welcome] failed to load recent messages: ${e?.message || e}`);
    }
    writeln('');
    if (!authenticated) {
      writeln('guest mode: your messages are local only. type /login to authenticate.');
      writeln('');
    }
  }

  // Helper para voltar ao prompt guest liberando o lock
  function returnToGuest() {
    promptLockRef.current = false;
    guestInputLoop();
  }

  // Garante que o prompt esteja ativo (rearma listener se necessário)
  function ensurePromptReady(maxMs = 2000) {
    const start = Date.now();
    function tick() {
      if (!termRef.current) return; // desmontado
      if (promptLockRef.current) return; // não rearmar enquanto em subfluxo
      if (!keyListenerRef.current) {
        try {
          termRef.current?.focus();
        } catch {}
        if (authShellRef.current) authShellInputLoop();
        else if (guestModeRef.current) guestInputLoop();
        else chatInputLoop();
        return;
      }
      if (Date.now() - start < maxMs) setTimeout(tick, 120);
    }
    setTimeout(tick, 60);
  }

  // -------- CHAT MODE --------
  async function enterChatMode(showHeader: boolean = true) {
    if (!termRef.current) return;
    if (showHeader) {
      writeln('');
      writeln('entering chat mode...');
      writeln('type your message and press Enter.');
      writeln('');
    }
    if (guestModeRef.current) {
      // modo convidado: sem Firestore, apenas eco local
      chatUnsubRef.current?.();
      guestInputLoop();
      return;
    }

    // subscribe messages (modo autenticado)
    try {
      // aguarda auth estar disponível para evitar condição de corrida
      const auth = getAuth();
      let tries = 0;
      while (!auth.currentUser && tries < 40) {
        // ~2s
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 50));
        tries += 1;
      }
      if (!auth.currentUser) {
        throw new Error('authentication not ready');
      }
      if (!auth.currentUser.emailVerified) {
        writeln('warning: account not verified. proceeding with chat.');
      }
      chatUnsubRef.current?.();
      // reinicia o conjunto de dedupe ao entrar no chat autenticado
      printedIdsRef.current.clear();
      chatUnsubRef.current = subscribeToMessages(
        (msg: { username: string; text: string; createdAt: number; id?: string }) => {
          // dedupe por id quando disponível (Firestore doc id pode ser adicionado pelo subscriber)
          // fallback: dedupe simples por hash do conteúdo + timestamp
          const key = (msg as any).id || `${msg.username}|${msg.text}|${msg.createdAt}`;
          if (printedIdsRef.current.has(key)) return;
          printedIdsRef.current.add(key);
          const ts = new Date(msg.createdAt || Date.now());
          const h = ts.toTimeString().slice(0, 8);
          // limpa a linha atual do prompt e imprime a mensagem sem linha em branco extra
          write('\r\x1b[2K'); // CR + clear line
          writeln(`[${h}] ${msg.username}: ${msg.text}`);
          ensurePromptReady(1200);
        },
      );
    } catch (e: any) {
      writeln(`[chat subscribe error] ${e?.message || e}`);
    }

    chatInputLoop();
  }

  function promptPrefix() {
    const uname = currentUserRef.current?.username || (guestModeRef.current ? 'guest' : 'user');
    const host = guestModeRef.current ? GUEST_HOST : DEFAULT_HOST;
    return `${uname}@${host}:~$ `;
  }

  function chatInputLoop() {
    if (promptLockRef.current) return; // não iniciar novo prompt durante subfluxo
    // aguardando entrada: cursor deve piscar
    setCursorPaused(false);
    inputPrompt(promptPrefix(), async (line) => {
      const text = line.trim();
      if (!text) return chatInputLoop();

      if (text.startsWith('/')) {
        const [cmd, ...rest] = text.slice(1).split(' ');
        switch (cmd) {
          case 'help': {
            writeln('authenticated commands:');
            writeln('/help      - list available commands');
            writeln('/ping      - measure latency (RTT)');
            writeln('/exitchat  - leave chat and return to /terminal');
            writeln('/logout    - sign out and return to home');
            writeln('/username <new> - change your username');
            writeln('/clear     - clear screen (admin only)');
            break;
          }
          case 'ping': {
            const rtt = await measurePing();
            writeln(`pong: ${rtt} ms`);
            return chatInputLoop();
          }
          case 'exitchat': {
            writeln('leaving chat and returning to /terminal...');
            // mantém sessão; apenas troca de rota
            router.push('/terminal');
            return;
          }
          case 'username': {
            const candidate = (rest.join(' ') || '').trim();
            if (!candidate) {
              promptLockRef.current = false;
              await enforceUsernameSetup();
              return chatInputLoop();
            }
            if (!isValidUsername(candidate)) {
              writeln('invalid username. allowed: a-z, 0-9, _ and - (3-20), not "guest".');
              return chatInputLoop();
            }
            try {
              const u = getAuth().currentUser;
              if (!u) throw new Error('session expired');
              await updateProfile(u, { displayName: candidate });
              currentUserRef.current = { username: candidate };
              setCurrentUser({ username: candidate });
              const admin = isAdminUser(candidate);
              isAdminRef.current = admin;
              setIsAdmin(admin);
              writeln(`username changed to ${candidate}${admin ? ' (admin)' : ''}`);
            } catch (e: any) {
              writeln(`username error: ${e?.message || e}`);
            }
            return chatInputLoop();
          }
          case 'ping': {
            writeln('Pong');
            break;
          }
          case 'logout': {
            // pausa prompt e remove listeners antes do signOut
            promptLockRef.current = true;
            try {
              keyListenerRef.current?.dispose?.();
            } catch {}
            logoutRequestedRef.current = true;
            await signOutUser();
            return; // onAuthChanged tratará transição e redirecionamento
          }
          case 'clear':
            if (!isAdminRef.current) {
              writeln('permission denied');
            } else {
              hardClear();
            }
            break;
          default:
            writeln(`unknown command: /${cmd}`);
        }
        return chatInputLoop();
      }

      const uname = currentUserRef.current?.username;
      if (!uname) {
        writeln('send error: session expired, please login again');
        return showLogin();
      }
      try {
        // Apaga a linha do prompt anterior para mensagens normais (sem comando),
        // mantendo o terminal limpo: apenas a linha cronológica do chat será exibida.
        // Subimos 1 linha (onde está o prompt), limpamos e retornamos.
        write('\x1b[1A'); // cursor up 1
        write('\x1b[2K\r'); // clear entire line + CR
        await sendMessage(uname, text);
      } catch (e: any) {
        writeln(`send error: ${e?.message || e}`);
      }
      // Aguarda o snapshot ecoar a mensagem para então repropor/garantir o prompt
      setTimeout(() => ensurePromptReady(1500), 50);
    });
  }

  // -------- GUEST MODE --------
  function enterGuestMode(showHeader = true, autoStart: boolean = true) {
    guestModeRef.current = true;
    currentUserRef.current = { username: 'guest' };
    setCurrentUser({ username: 'guest' });
    setIsAdmin(false);
    isAdminRef.current = false;
    if (showHeader) {
      writeln('');
      writeln('guest session started');
      writeln('type help for tips, or login to access more features');
      writeln('');
    }
    if (autoStart) enterChatMode(showHeader);
  }

  function showGuestHelp() {
    writeln('no built-in commands. try:');
    writeln('- clear  : clear screen');
    writeln('- ping   : measure latency');
    writeln('- music  : play "Wake Up (The Matrix)" with ASCII visualizer (Ctrl+C to stop)');
    writeln('others will behave like a shell.');
  }

  function guestInputLoop() {
    if (promptLockRef.current) return; // não iniciar novo prompt durante subfluxo
    // aguardando entrada: cursor deve piscar
    setCursorPaused(false);
    inputPrompt(promptPrefix(), async (line) => {
      const text = line.trim();
      if (!text) return guestInputLoop();
      // Terminal-like: aceitar comandos sem barra
      if (text === 'clear') {
        hardClear();
        return guestInputLoop();
      }
      if (text === 'ping') {
        const rtt = await measurePing();
        writeln(`pong: ${rtt} ms`);
        return guestInputLoop();
      }
      if (text === 'login') {
        showLogin();
        return;
      }
      if (text.startsWith('music')) {
        const parts = text.split(' ').filter(Boolean);
        const urlArg = parts[1];
        const url = urlArg || process.env.NEXT_PUBLIC_MUSIC_URL || '/music/wake-up-matrix.mp3';
        await startMusicWithAscii(url);
        return; // aguardando Ctrl+C
      }
      if (text === 'help') {
        showGuestHelp();
        return guestInputLoop();
      }
      // inputPrompt already printed a newline on Enter
      writeln(`bash: ${text}: command not found`);
      return guestInputLoop();
    });
  }

  return (
    <>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        onClick={() => {
          termRef.current?.focus();
          setCursorPaused(false);
        }}
        onTouchStart={() => {
          termRef.current?.focus();
          setCursorPaused(false);
        }}
      />
      {/* Invisible reCAPTCHA host for Phone Auth */}
      <div id="recaptcha-container" style={{ display: 'none' }} />
      {/* Hidden audio element for music playback */}
      <audio ref={audioRef} style={{ display: 'none' }} preload="auto" />
      <style jsx global>{`
        /* Cursor bloco com glow e blink (1s) estilo Matrix: some completamente no off */
        @keyframes termCursorBlink {
          0%,
          49% {
            opacity: 1;
          }
          50%,
          100% {
            opacity: 0;
          }
        }
        .xterm .xterm-cursor-block {
          background: rgb(240, 255, 240) !important; /* quase branco esverdeado */
          box-shadow:
            0 0 10px rgba(0, 255, 140, 1),
            0 0 3px rgba(255, 255, 255, 0.85);
        }
        /* piscar sempre que não estiver pausado */
        .xterm .xterm-cursor-block {
          animation: termCursorBlink 1s step-end infinite;
        }
        /* estado pausado: cursor fixo (sem blink) */
        .xterm.cursor-paused .xterm-cursor-block {
          animation: none !important;
          opacity: 1 !important;
        }
        /* Visual igual ao overlay */
        .xterm {
          background: #000 !important;
        }
        .xterm .xterm-rows {
          color: #00ff9c !important;
          text-shadow: 0 0 6px rgba(0, 255, 156, 0.6);
          letter-spacing: 0.5px;
          font-size: 16px; /* desktop padrão */
        }
        /* Ajustes responsivos para telas menores */
        @media (max-width: 900px) {
          .xterm .xterm-rows {
            font-size: 14px;
          }
        }
        @media (max-width: 600px) {
          .xterm .xterm-rows {
            font-size: 12px;
          }
        }
        @media (max-width: 420px) {
          .xterm .xterm-rows {
            font-size: 11px;
          }
        }
      `}</style>
    </>
  );
}
