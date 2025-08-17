'use client';
import { useEffect, useRef } from 'react';

export default function MatrixBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      if (!canvas) return;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    const cell = 14;
    ctx.font = '14px monospace';
    ctx.textBaseline = 'top';

    function frame() {
      if (cancelled) return;
      const cols = Math.ceil(canvas.clientWidth / cell);
      const rows = Math.ceil(canvas.clientHeight / cell);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (Math.random() < 0.5) continue;
          const n = Math.floor(Math.random() * 10).toString();
          const g = 180 + Math.floor(Math.random() * 75);
          ctx.fillStyle = `rgb(0, ${g}, 100)`;
          ctx.fillText(n, x * cell, y * cell);
        }
      }
      requestAnimationFrame(frame);
    }
    const raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#000' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
