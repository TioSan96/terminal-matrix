"use client";

import { useEffect, useRef, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  DocumentData,
} from "firebase/firestore";

type Msg = {
  text: string;
  uid: string | null;
  createdAt: Timestamp | { toDate?: () => Date } | null;
};

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  // Ensure anonymous auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) await signInAnonymously(auth).catch(console.error);
      setReady(true);
    });
    return () => unsub();
  }, []);

  // Live query
  useEffect(() => {
    if (!ready) return;
    const q = query(
      collection(db, "rooms/global/messages"),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: Msg[] = [];
      snap.forEach((d) => list.push(d.data() as Msg));
      setMessages(list);
      // scroll to bottom on update
      setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
    });
    return () => unsub();
  }, [ready]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    const uid = auth.currentUser?.uid ?? null;
    await addDoc(collection(db, "rooms/global/messages"), {
      text: t,
      uid,
      createdAt: serverTimestamp(),
    });
    setText("");
  }

  return (
    <div className="min-h-screen p-6 sm:p-10 font-sans">
      <h1 className="text-2xl font-semibold mb-1">Chat de Teste (Firestore)</h1>
      <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-4">
        Sala única: <code>rooms/global/messages</code>
      </p>

      <div className="max-w-2xl">
        <div
          className="border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 h-[360px] overflow-auto p-3 shadow-sm"
          aria-live="polite"
        >
          {messages.map((m, i) => {
            const ts: any = (m as unknown as DocumentData)?.createdAt;
            const d: Date | null = ts?.toDate ? ts.toDate() : null;
            const time = d ? d.toLocaleTimeString() : "—";
            const nick = m.uid ? m.uid.slice(0, 6) : "anon";
            return (
              <div key={i} className="py-0.5 text-sm">
                <strong>[{time}] {nick}</strong>: {m.text}
              </div>
            );
          })}
          <div ref={listEndRef} />
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 border border-neutral-300 dark:border-neutral-600 rounded-md px-3 py-2 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 dark:placeholder-neutral-400 outline-none focus:ring-2 focus:ring-blue-500/50"
            placeholder="Digite uma mensagem"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white shadow"
            onClick={send}
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
