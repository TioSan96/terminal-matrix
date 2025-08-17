'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { initializeFirebase, isFirebaseConfigured, onAuthChanged } from '@/services/firebase';

const TerminalConsole = dynamic(() => import('@/components/TerminalConsole'), { ssr: false });

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    initializeFirebase();
    if (!isFirebaseConfigured()) return; // sem config, fica na home como guest
    const off = onAuthChanged((u) => {
      if (u) router.replace('/terminal');
    });
    return () => off?.();
  }, [router]);
  return (
    <div className="screen">
      <TerminalConsole startupMode="noIntro" />
    </div>
  );
}
