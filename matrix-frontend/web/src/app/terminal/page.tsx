'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { initializeFirebase, isFirebaseConfigured, onAuthChanged } from '@/services/firebase';

const TerminalConsole = dynamic(() => import('@/components/TerminalConsole'), { ssr: false });

export default function TerminalPage() {
  const router = useRouter();
  useEffect(() => {
    initializeFirebase();
    if (!isFirebaseConfigured()) {
      router.replace('/');
      return;
    }
    const off = onAuthChanged((u) => {
      if (!u) router.replace('/');
    });
    return () => off?.();
  }, [router]);
  // Terminal sem overlay/intro, com fundo sólido (sem chuva de números)
  return (
    <div className="screen terminal-fixed">
      <TerminalConsole startupMode="noIntro" />
    </div>
  );
}
