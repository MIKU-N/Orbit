import { useEffect, useRef, useState } from 'react';
import { setClientPeerId } from '../api/client';
import type { ClipItem, PeerInfo, StagedFile } from '../types';
import { OrbitP2PManager, type TransferProgress } from '../lib/webrtc';

export interface P2PCompleteInfo {
  direction: 'send' | 'receive';
  fileName: string;
  sizeBytes: number;
  speedBps: number;
}

export interface WSMutationEvent<T> {
  action?: string;
  id?: number;
  notify?: boolean;
  sender_peer_id?: string;
  target_peer_id?: string;
  clip?: T extends ClipItem ? ClipItem : never;
  file?: T extends StagedFile ? StagedFile : never;
}

interface UseOrbitWSProps {
  enabled: boolean;
  onClipsChanged: (event?: WSMutationEvent<ClipItem>) => void;
  onFilesChanged: (event?: WSMutationEvent<StagedFile>) => void;
  onP2PComplete: (info: P2PCompleteInfo) => void;
}

export function useOrbitWS({
  enabled,
  onClipsChanged,
  onFilesChanged,
  onP2PComplete,
}: UseOrbitWSProps) {
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [selfPeerId, setSelfPeerId] = useState<string>('');
  const [wsConnected, setWsConnected] = useState(false);
  const [p2pProgress, setP2pProgress] = useState<TransferProgress | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const p2pRef = useRef<OrbitP2PManager | null>(null);
  const peersRef = useRef<PeerInfo[]>([]);
  peersRef.current = peers;
  const callbacksRef = useRef({ onClipsChanged, onFilesChanged, onP2PComplete });
  callbacksRef.current = { onClipsChanged, onFilesChanged, onP2PComplete };

  useEffect(() => {
    setClientPeerId(selfPeerId);
  }, [selfPeerId]);

  useEffect(() => {
    if (!enabled) {
      setPeers([]);
      setSelfPeerId('');
      setClientPeerId('');
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
      (info) => callbacksRef.current.onP2PComplete(info),
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
            case 'peers_updated': {
              const pid = msg.payload?.self_peer_id || '';
              setSelfPeerId(pid);
              setClientPeerId(pid);
              setPeers(Array.isArray(msg.payload?.peers) ? msg.payload.peers : []);
              break;
            }
            case 'clip_updated':
              callbacksRef.current.onClipsChanged(msg.payload);
              break;
            case 'files_updated':
              callbacksRef.current.onFilesChanged(msg.payload);
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
    const targetPeer = peersRef.current.find((p) => p.peer_id === peerId);
    await p2pRef.current.sendFile(peerId, file, { sameLan: Boolean(targetPeer?.same_lan) });
  };

  return { peers, selfPeerId, wsConnected, p2pProgress, sendFileP2P };
}
