import { useEffect, useRef, useState } from 'react';
import type { PeerInfo } from '../types';
import { OrbitP2PManager, type TransferProgress } from '../lib/webrtc';

interface UseOrbitWSProps {
  enabled: boolean;
  onClipsChanged: () => void;
  onFilesChanged: () => void;
  onToast: (msg: string, warn?: boolean) => void;
}

export function useOrbitWS({
  enabled,
  onClipsChanged,
  onFilesChanged,
  onToast,
}: UseOrbitWSProps) {
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [selfPeerId, setSelfPeerId] = useState<string>('');
  const [wsConnected, setWsConnected] = useState(false);
  const [p2pProgress, setP2pProgress] = useState<TransferProgress | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const p2pRef = useRef<OrbitP2PManager | null>(null);
  const callbacksRef = useRef({ onClipsChanged, onFilesChanged, onToast });
  callbacksRef.current = { onClipsChanged, onFilesChanged, onToast };

  useEffect(() => {
    if (!enabled) {
      setPeers([]);
      setWsConnected(false);
      return;
    }

    let closed = false;
    let retryTimer: number | undefined;
    let attempt = 0;

    const sendSignal = (targetPeerId: string, payload: unknown) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'rtc_signal',
            target_peer_id: targetPeerId,
            payload,
          }),
        );
      }
    };

    const p2p = new OrbitP2PManager(
      sendSignal,
      (prog) => setP2pProgress(prog),
      (msg) => callbacksRef.current.onToast(msg),
    );
    p2pRef.current = p2p;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          switch (msg.type) {
            case 'peers_updated':
              setSelfPeerId(msg.payload?.self_peer_id || '');
              setPeers(Array.isArray(msg.payload?.peers) ? msg.payload.peers : []);
              break;
            case 'clip_updated':
              callbacksRef.current.onClipsChanged();
              break;
            case 'files_updated':
              callbacksRef.current.onFilesChanged();
              break;
            case 'rtc_signal':
              if (msg.from_peer_id) {
                void p2p.handleSignal(msg.from_peer_id, msg.payload);
              }
              break;
          }
        } catch {
          // ignore invalid frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) {
          const delay = Math.min(10000, 1200 * Math.pow(1.5, attempt));
          attempt += 1;
          retryTimer = window.setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      wsRef.current?.close();
      p2p.closeAll();
      p2pRef.current = null;
    };
  }, [enabled]);

  const sendFileP2P = async (peerId: string, file: File) => {
    if (!p2pRef.current) {
      throw new Error('P2P 通道未就绪');
    }
    await p2pRef.current.sendFile(peerId, file);
  };

  return { peers, selfPeerId, wsConnected, p2pProgress, sendFileP2P };
}
