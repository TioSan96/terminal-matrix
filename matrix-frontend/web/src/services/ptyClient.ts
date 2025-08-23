import { Terminal } from '@xterm/xterm';
import { getAuth } from 'firebase/auth';

export type PtyConnection = {
  dispose: () => void;
};

export type ConnectPtyOptions = {
  term: Terminal;
  onClose?: (reason?: string) => void;
};

function buildWsUrl(idToken: string): string {
  const base = process.env.NEXT_PUBLIC_PTY_WSS_URL;
  if (!base) throw new Error('NEXT_PUBLIC_PTY_WSS_URL not set');
  const transport = process.env.NEXT_PUBLIC_PTY_TOKEN_TRANSPORT || 'query';
  const queryKey = process.env.NEXT_PUBLIC_PTY_TOKEN_QUERY_KEY || 'token';
  if (transport === 'query') {
    const u = new URL(base);
    u.searchParams.set(queryKey, idToken);
    return u.toString();
  }
  // default fallback to query
  const u = new URL(base);
  u.searchParams.set(queryKey, idToken);
  return u.toString();
}

export async function connectPty(opts: ConnectPtyOptions): Promise<PtyConnection> {
  const { term, onClose } = opts;

  const auth = getAuth();
  if (!auth.currentUser) throw new Error('not authenticated');
  const idToken = await auth.currentUser.getIdToken(true);

  const url = buildWsUrl(idToken);
  const ws = new WebSocket(url);

  // track listeners for cleanup
  const disposers: Array<() => void> = [];
  let closed = false;

  // send terminal input to server
  const d1 = term.onData((data) => {
    try {
      ws.send(data);
    } catch {}
  });
  disposers.push(() => {
    try { (d1 as any)?.dispose?.(); } catch {}
  });

  // send terminal resize
  const d2 = term.onResize(({ cols, rows }) => {
    try {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    } catch {}
  });
  disposers.push(() => {
    try { (d2 as any)?.dispose?.(); } catch {}
  });

  // receive data from server
  ws.onmessage = (ev) => {
    try {
      const data = ev.data as any;
      if (typeof data === 'string') {
        // allow control frames
        if (data.startsWith('{') && data.endsWith('}')) {
          try {
            const msg = JSON.parse(data);
            if (msg?.type === 'exit' && !closed) {
              closed = true;
              try { ws.close(); } catch {}
              onClose?.(msg?.reason || '');
              return;
            }
          } catch {
            term.write(data);
          }
        } else {
          term.write(data);
        }
      } else if (data instanceof ArrayBuffer) {
        const text = new TextDecoder().decode(data);
        term.write(text);
      } else {
        // Blob
        (data as Blob).text().then((t) => term.write(t)).catch(() => {});
      }
    } catch {}
  };

  ws.onerror = () => {
    if (!closed) {
      closed = true;
      try { ws.close(); } catch {}
      onClose?.('network error');
    }
  };
  ws.onclose = () => {
    if (!closed) {
      closed = true;
      onClose?.('closed');
    }
  };

  // When the socket opens, request initial size
  ws.onopen = () => {
    try {
      const dims = (term as any)._core?._renderService?._dimensions;
      const cols = (term.cols ?? dims?.actualCellWidth) || 80;
      const rows = (term.rows ?? dims?.actualCellHeight) || 24;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    } catch {}
  };

  const dispose = () => {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch {}
    for (const d of disposers) {
      try { d(); } catch {}
    }
  };

  return { dispose };
}
