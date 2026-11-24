export interface TransferProgress {
  peerId: string;
  direction: 'send' | 'receive';
  fileName: string;
  percent: number;
  speedBps: number;
}

type SignalSender = (targetPeerId: string, payload: unknown) => void;

interface IncomingTransfer {
  name: string;
  size: number;
  mime: string;
  received: number;
  chunks: ArrayBuffer[];
  startedAt: number;
}

const CHUNK_SIZE = 64 * 1024;
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;

export class OrbitP2PManager {
  private pcs = new Map<string, RTCPeerConnection>();
  private incoming = new Map<string, IncomingTransfer>();
  private sendSignal: SignalSender;
  private onProgress: (p: TransferProgress | null) => void;
  private onComplete: (msg: string) => void;

  constructor(
    sendSignal: SignalSender,
    onProgress: (p: TransferProgress | null) => void,
    onComplete: (msg: string) => void,
  ) {
    this.sendSignal = sendSignal;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.pcs.get(peerId);
    if (existing) {
      return existing;
    }
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignal(peerId, { kind: 'ice', candidate: ev.candidate });
      }
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        pc.close();
        this.pcs.delete(peerId);
      }
    };
    pc.ondatachannel = (ev) => {
      this.bindReceiveChannel(peerId, ev.channel);
    };
    this.pcs.set(peerId, pc);
    return pc;
  }

  private bindReceiveChannel(peerId: string, dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    let currentKey = '';

    dc.onmessage = async (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const ctrl = JSON.parse(ev.data);
          if (ctrl.type === 'meta') {
            currentKey = `${peerId}:${ctrl.id}`;
            this.incoming.set(currentKey, {
              name: ctrl.name || 'orbit-file.bin',
              size: Number(ctrl.size) || 0,
              mime: ctrl.mime || 'application/octet-stream',
              received: 0,
              chunks: [],
              startedAt: performance.now(),
            });
          } else if (ctrl.type === 'done') {
            const state = this.incoming.get(currentKey);
            if (!state) return;
            this.incoming.delete(currentKey);
            const blob = new Blob(state.chunks, { type: state.mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = state.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            this.onProgress(null);
            this.onComplete(`已通过 P2P 接收文件：${state.name}`);
          }
        } catch {
          // ignore malformed control message
        }
        return;
      }

      const state = this.incoming.get(currentKey);
      if (!state) return;
      const buf = ev.data instanceof Blob ? await ev.data.arrayBuffer() : (ev.data as ArrayBuffer);
      state.chunks.push(buf);
      state.received += buf.byteLength;
      const elapsedSec = Math.max(0.05, (performance.now() - state.startedAt) / 1000);
      const pct = state.size > 0 ? Math.min(100, Math.round((state.received / state.size) * 100)) : 100;
      this.onProgress({
        peerId,
        direction: 'receive',
        fileName: state.name,
        percent: pct,
        speedBps: state.received / elapsedSec,
      });
    };
  }

  async handleSignal(fromPeerId: string, rawPayload: unknown) {
    const sig = rawPayload as {
      kind?: string;
      sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };
    const pc = this.createPeerConnection(fromPeerId);
    if (sig.kind === 'offer' && sig.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(fromPeerId, { kind: 'answer', sdp: pc.localDescription });
    } else if (sig.kind === 'answer' && sig.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
    } else if (sig.kind === 'ice' && sig.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
      } catch {
        // ignore stale ICE
      }
    }
  }

  async sendFile(peerId: string, file: File) {
    const pc = this.createPeerConnection(peerId);
    const dc = pc.createDataChannel('orbit-file', { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW_WATER;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(peerId, { kind: 'offer', sdp: pc.localDescription });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('P2P 连接超时，对方可能不在同一网络')), 15000);
      dc.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      dc.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('DataChannel 打开失败'));
      };
    });

    const transferId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    dc.send(
      JSON.stringify({
        type: 'meta',
        id: transferId,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
      }),
    );

    const startedAt = performance.now();
    let offset = 0;

    while (offset < file.size) {
      if (dc.bufferedAmount > HIGH_WATER) {
        await new Promise<void>((res) => {
          const handler = () => {
            dc.removeEventListener('bufferedamountlow', handler);
            res();
          };
          dc.addEventListener('bufferedamountlow', handler);
        });
      }
      const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      dc.send(chunk);
      offset += chunk.byteLength;
      const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
      this.onProgress({
        peerId,
        direction: 'send',
        fileName: file.name,
        percent: Math.min(100, Math.round((offset / file.size) * 100)),
        speedBps: offset / elapsedSec,
      });
    }

    dc.send(JSON.stringify({ type: 'done', id: transferId }));
    setTimeout(() => {
      try {
        dc.close();
      } catch {
        // ignore
      }
      this.onProgress(null);
      this.onComplete(`P2P 直传完成：${file.name}`);
    }, 300);
  }

  closeAll() {
    this.pcs.forEach((pc) => pc.close());
    this.pcs.clear();
  }
}
