'use client';
import { useEffect, useRef, useState } from 'react';

interface IntroOverlayProps {
  onFinish: () => void;
  durationMs?: number; // ignorado; o tempo é controlado pela sequência
}

export default function IntroOverlay({ onFinish }: IntroOverlayProps) {
  const [visible, setVisible] = useState(true);
  const textRef = useRef<HTMLDivElement | null>(null);
  const textSpanRef = useRef<HTMLSpanElement | null>(null);
  const cursorRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);
  const rainStopRef = useRef<null | (() => void)>(null);
  const finishedRef = useRef(false);
  // tempos (ms) — sinta-se livre para pedir ajustes finos
  const TYPE_SPEED = 90; // por caractere (um pouco mais rápido)
  const PAUSE_AFTER_TYPE = 1200;
  const FADE_MS = 1600;
  const PAUSE_AFTER_ERASE = 700;
  const PRE_WAIT_MS = 7000; // pausa inicial apenas com cursor
  const RAIN_MS = 3200;

  useEffect(() => {
    let cancelled = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // permite pular a intro via ESC
    function skipIntro() {
      if (finishedRef.current) return;
      finishedRef.current = true;
      cancelled = true;
      rainStopRef.current?.();
      if (cursorRef.current) cursorRef.current.style.display = 'none';
      setVisible(false);
      onFinishRef.current();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Atalho difícil: Ctrl+Shift+L para pular a intro
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyL' || e.key.toLowerCase() === 'l')) {
        e.preventDefault();
        e.stopPropagation();
        skipIntro();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // digitação lenta e estável
    async function type(str: string, speed = TYPE_SPEED) {
      if (!textRef.current) return;
      // interrompe qualquer fade anterior
      textRef.current.style.transition = '';
      textRef.current.style.opacity = '1';
      if (textSpanRef.current) textSpanRef.current.textContent = '';
      // durante a digitação, cursor deve ficar fixo (sem blink)
      if (cursorRef.current) {
        cursorRef.current.style.animation = 'none';
        cursorRef.current.style.opacity = '1';
      }
      for (const ch of str) {
        if (cancelled) return;
        // garante existência do span de texto
        if (!textSpanRef.current) return;
        textSpanRef.current.textContent += ch;
        // eslint-disable-next-line no-await-in-loop
        await sleep(speed);
        if (cancelled) return;
      }
      // terminou de digitar: volta a piscar
      if (cursorRef.current) {
        cursorRef.current.style.animation = 'introCursorBlink 1s step-end infinite';
      }
    }
    // apagar por fade, não por backspace
    async function erase(fadeMs = FADE_MS) {
      const el = textRef.current;
      if (!el) return;
      // força reflow para garantir início da transição
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.offsetHeight;
      el.style.transition = `opacity ${fadeMs}ms ease`;
      el.style.opacity = '0';
      await new Promise<void>((resolve) => {
        let done = false;
        const to = setTimeout(() => {
          if (done) return;
          done = true;
          resolve();
        }, fadeMs + 50);
        const handler = () => {
          if (done) return;
          done = true;
          clearTimeout(to);
          resolve();
        };
        el.addEventListener('transitionend', handler, { once: true });
      });
      if (textSpanRef.current) textSpanRef.current.textContent = '';
      // restaurar para próxima frase
      el.style.transition = '';
      el.style.opacity = '1';
    }

    function startDigitsRain(durationMs = RAIN_MS) {
      if (cancelled) return () => {};
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const resize = () => {
        canvas.width = Math.floor(canvas.clientWidth * dpr);
        canvas.height = Math.floor(canvas.clientHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      const onResize = () => resize();
      window.addEventListener('resize', onResize);

      const cell = 14; // tamanho do bloco
      const cols = Math.ceil(canvas.clientWidth / cell);
      const rows = Math.ceil(canvas.clientHeight / cell);

      ctx.font = '14px monospace';
      ctx.textBaseline = 'top';

      const start = performance.now();
      function frame(now: number) {
        if (cancelled) return;
        const t = now - start;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            // densidade cresce com o tempo
            const prob = Math.min(1, t / durationMs) * 0.9;
            if (Math.random() < prob) {
              const n = Math.floor(Math.random() * 10).toString();
              // leve variação de brilho
              const g = 180 + Math.floor(Math.random() * 75);
              ctx.fillStyle = `rgb(0, ${g}, 100)`;
              ctx.fillText(n, x * cell, y * cell);
            }
          }
        }
        // nos últimos 600ms, desenha um bloco de 9 dígitos no canto superior direito
        if (durationMs - t < 600) {
          const block = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
          const x = canvas.clientWidth - cell * 9 - 12;
          const y = 8;
          ctx.fillStyle = 'rgb(0, 255, 140)';
          for (let i = 0; i < block.length; i++) {
            ctx.fillText(block[i], x + i * cell, y);
          }
        }
        if (!cancelled && t < durationMs) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      return () => {
        window.removeEventListener('resize', onResize);
      };
    }

    async function run() {
      // pausa inicial: só o cursor aparece
      await sleep(PRE_WAIT_MS);
      if (cancelled) return;
      const messages = [
        'Call trans opt: received. 9-18-99 14:32:21 REC:Log>',
        'WARNING: carrier anomaly',
        'Trace program: running',
      ];
      for (const m of messages) {
        await type(m);
        await sleep(PAUSE_AFTER_TYPE);
        await erase(FADE_MS);
        await sleep(PAUSE_AFTER_ERASE);
        if (cancelled) return;
      }
      // após a última frase, ocultar o cursor para não sobrepor a chuva
      if (cursorRef.current) cursorRef.current.style.display = 'none';
      const stop = startDigitsRain(RAIN_MS);
      rainStopRef.current = stop;
      await sleep(RAIN_MS);
      stop?.();
      if (!cancelled && !finishedRef.current) {
        finishedRef.current = true;
        setVisible(false);
        onFinishRef.current();
      }
    }

    // dar um tick para estabilizar montagem em StrictMode
    const to = setTimeout(() => {
      if (!cancelled) run();
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(to);
      const el = textRef.current;
      if (el) {
        el.style.transition = '';
        el.style.opacity = '1';
      }
      rainStopRef.current?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!visible) return null;

  return (
    <div style={styles.container}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <div ref={textRef} style={styles.type}>
        <span ref={textSpanRef} />
        <span ref={cursorRef} className="intro-cursor" />
      </div>
      <style jsx global>{`
        @keyframes glow {
          0% {
            opacity: 0.7;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0.7;
          }
        }
        @keyframes introCursorBlink {
          0%,
          49% {
            opacity: 1;
          }
          50%,
          100% {
            opacity: 0;
          }
        }
        .intro-cursor {
          display: inline-block;
          width: 10px;
          height: 1.2em; /* ligeiramente mais alto */
          background: rgb(220, 255, 235); /* branco esverdeado suave */
          box-shadow:
            0 0 10px rgba(0, 255, 140, 1),
            0 0 3px rgba(255, 255, 255, 0.85);
          margin-left: 4px;
          vertical-align: bottom;
          /* blink + glow constante */
          animation: introCursorBlink 1s step-end infinite;
        }
      `}</style>
    </div>
  );
}

const styles: { [k: string]: React.CSSProperties } = {
  container: {
    position: 'fixed',
    inset: 0,
    background: '#000',
    color: '#00ff9c',
    zIndex: 9999,
    overflow: 'hidden',
    fontFamily: 'monospace',
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
  type: {
    position: 'absolute',
    top: 24,
    left: 24,
    color: '#00ff9c',
    textShadow: '0 0 6px rgba(0,255,156,0.6)',
    fontSize: 16,
    letterSpacing: 0.5,
    animation: 'glow 1.2s ease-in-out infinite',
    pointerEvents: 'none',
    userSelect: 'none',
  },
};
