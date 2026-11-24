export interface TransferProgress {
  peerId: string;
  direction: 'send' | 'receive';
  fileName: string;
  percent: number;
  speedBps: number;
  transferredBytes: number;
  totalBytes: number;
}

type SignalSender = (targetPeerId: string, payload: unknown) => void;

interface IncomingTransfer {
  id: string;
  name: string;
  size: number;
  mime: string;
  received: number;
  chunks: ArrayBuffer[];
  startedAt: number;
  lastProgressAt: number;
  sampleBytes: number;
  sampleAt: number;
  speedBps: number;
}

const READ_SLAB_SIZE = 4 * 1024 * 1024; // 4 MB double-buffered disk read slab
const MAX_CHUNK_SIZE = 256 * 1024; // 256 KB max SCTP message size
const DEFAULT_CHUNK_SIZE = 64 * 1024;
const HIGH_WATER = 8 * 1024 * 1024; // 8 MB SCTP send buffer high-water mark
const LOW_WATER = 2 * 1024 * 1024; // 2 MB SCTP send buffer low-water mark
const PROGRESS_INTERVAL_MS = 120; // Throttle UI updates to ~8 fps to keep main thread free

function pickChunkSize(pc: RTCPeerConnection): number {
  const maxMsg = pc.sctp?.maxMessageSize;
  if (!maxMsg || !Number.isFinite(maxMsg) || maxMsg <= 0) {
    return DEFAULT_CHUNK_SIZE;
  }
  const safe = Math.min(MAX_CHUNK_SIZE, Math.max(16 * 1024, Math.floor(maxMsg / 1024) * 1024));
  return safe;
}

function waitForBufferedLow(dc: RTCDataChannel, threshold: number): Promise<void> {
  if (dc.bufferedAmount <= threshold || dc.readyState !== 'open') {
    return Promise.resolve();
  }
  dc.bufferedAmountLowThreshold = threshold;
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      dc.removeEventListener('bufferedamountlow', onLow);
      dc.removeEventListener('close', onClose);
      dc.removeEventListener('error', onErr);
    };
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error('P2P 传输连接已断开'));
    };
    const onErr = () => {
      cleanup();
      reject(new Error('P2P 传输发生错误'));
    };
    dc.addEventListener('bufferedamountlow', onLow);
    dc.addEventListener('close', onClose);
    dc.addEventListener('error', onErr);
    if (dc.bufferedAmount <= threshold) {
      cleanup();
      resolve();
    }
  });
}

export class OrbitP2PManager {
  private pcs = new Map<string, RTCPeerConnection>();
  private incoming = new Map<string, IncomingTransfer>();
  private sendSignal: SignalSender;
  private onProgress: (p: TransferProgress | null) => void;
  private onComplete: (info: { direction: 'send' | 'receive'; fileName: string; sizeBytes: number; speedBps: number }) => void;

  constructor(
    sendSignal: SignalSender,
    onProgress: (p: TransferProgress | null) => void,
    onComplete: (info: { direction: 'send' | 'receive'; fileName: string; sizeBytes: number; speedBps: number }) => void,
  ) {
    this.sendSignal = sendSignal;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.pcs.get(peerId);
    if (existing && !['failed', 'closed', 'disconnected'].includes(existing.connectionState)) {
      return existing;
    }
    if (existing) {
      try {
        existing.close();
      } catch {
        // ignore
      }
      this.pcs.delete(peerId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      iceCandidatePoolSize: 4,
    });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignal(peerId, { kind: 'ice', candidate: ev.candidate });
      }
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        try {
          pc.close();
        } catch {
          // ignore
        }
        if (this.pcs.get(peerId) === pc) {
          this.pcs.delete(peerId);
        }
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

    const handleChunkBuffer = (buf: ArrayBuffer) => {
      const state = this.incoming.get(currentKey);
      if (!state) return;
      state.chunks.push(buf);
      state.received += buf.byteLength;

      const now = performance.now();
      if (now - state.lastProgressAt >= PROGRESS_INTERVAL_MS || (state.size > 0 && state.received >= state.size)) {
        const winSec = (now - state.sampleAt) / 1000;
        if (winSec >= 0.35) {
          state.speedBps = (state.received - state.sampleBytes) / winSec;
          state.sampleBytes = state.received;
          state.sampleAt = now;
        } else if (state.speedBps === 0) {
          const totalSec = Math.max(0.02, (now - state.startedAt) / 1000);
          state.speedBps = state.received / totalSec;
        }
        state.lastProgressAt = now;
        const pct = state.size > 0 ? Math.min(100, Math.round((state.received / state.size) * 100)) : 100;
        this.onProgress({
          peerId,
          direction: 'receive',
          fileName: state.name,
          percent: pct,
          speedBps: state.speedBps,
          transferredBytes: state.received,
          totalBytes: state.size,
        });
      }
    };

    dc.onclose = () => {
      if (currentKey && this.incoming.has(currentKey)) {
        this.incoming.delete(currentKey);
        this.onProgress(null);
      }
    };

    // Synchronous hot path for ArrayBuffer binary frames to eliminate per-chunk Promise overhead
    dc.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        handleChunkBuffer(ev.data);
        return;
      }

      if (typeof ev.data === 'string') {
        try {
          const ctrl = JSON.parse(ev.data);
          if (ctrl.type === 'meta') {
            const now = performance.now();
            currentKey = `${peerId}:${ctrl.id}`;
            const size = Number(ctrl.size) || 0;
            const name = ctrl.name || 'orbit-file.bin';
            this.incoming.set(currentKey, {
              id: String(ctrl.id || ''),
              name,
              size,
              mime: ctrl.mime || 'application/octet-stream',
              received: 0,
              chunks: [],
              startedAt: now,
              lastProgressAt: now,
              sampleBytes: 0,
              sampleAt: now,
              speedBps: 0,
            });
            this.onProgress({
              peerId,
              direction: 'receive',
              fileName: name,
              percent: 0,
              speedBps: 0,
              transferredBytes: 0,
              totalBytes: size,
            });
          } else if (ctrl.type === 'done') {
            const state = this.incoming.get(currentKey);
            if (!state) return;
            this.incoming.delete(currentKey);
            currentKey = '';

            const elapsedSec = Math.max(0.02, (performance.now() - state.startedAt) / 1000);
            const avgSpeed = state.received / elapsedSec;

            try {
              if (dc.readyState === 'open') {
                dc.send(JSON.stringify({ type: 'ack', id: state.id }));
              }
            } catch {
              // ignore ack send failure
            }

            const blob = new Blob(state.chunks, { type: state.mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = state.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 15000);

            this.onProgress(null);
            this.onComplete({
              direction: 'receive',
              fileName: state.name,
              sizeBytes: state.received || state.size,
              speedBps: avgSpeed,
            });
          }
        } catch {
          // ignore malformed control message
        }
        return;
      }

      if (ev.data instanceof Blob) {
        void ev.data.arrayBuffer().then(handleChunkBuffer);
      }
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
    const needsNegotiation = pc.connectionState !== 'connected' || !pc.sctp;
    const dc = pc.createDataChannel(`orbit-file-${Date.now()}`, { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW_WATER;

    const openPromise = new Promise<void>((resolve, reject) => {
      if (dc.readyState === 'open') {
        resolve();
        return;
      }
      const timeout = window.setTimeout(
        () => reject(new Error('P2P 连接超时，对方可能不在同一网络')),
        15000,
      );
      dc.onopen = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      dc.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('DataChannel 打开失败'));
      };
    });

    if (needsNegotiation) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal(peerId, { kind: 'offer', sdp: pc.localDescription });
    }

    await openPromise;

    const chunkSize = pickChunkSize(pc);
    const transferId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    let ackResolve: (() => void) | null = null;
    const ackPromise = new Promise<void>((resolve) => {
      ackResolve = resolve;
    });
    dc.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'ack' && msg.id === transferId && ackResolve) {
            ackResolve();
          }
        } catch {
          // ignore
        }
      }
    };

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
    let lastProgressAt = startedAt;
    let sampleAt = startedAt;
    let sampleBytes = 0;
    let speedBps = 0;

    this.onProgress({
      peerId,
      direction: 'send',
      fileName: file.name,
      percent: 0,
      speedBps: 0,
      transferredBytes: 0,
      totalBytes: file.size,
    });

    const readSlab = (start: number) =>
      file.slice(start, Math.min(file.size, start + READ_SLAB_SIZE)).arrayBuffer();

    let offset = 0;
    let nextSlabOffset = 0;
    let currentSlabPromise: Promise<ArrayBuffer> | null =
      file.size > 0 ? readSlab(0) : null;
    nextSlabOffset = Math.min(file.size, READ_SLAB_SIZE);

    try {
      while (currentSlabPromise) {
        const slab = await currentSlabPromise;
        // Double-buffer: overlap next 4 MB disk read with current network transmission
        if (nextSlabOffset < file.size) {
          currentSlabPromise = readSlab(nextSlabOffset);
          nextSlabOffset = Math.min(file.size, nextSlabOffset + READ_SLAB_SIZE);
        } else {
          currentSlabPromise = null;
        }

        let pos = 0;
        const slabLen = slab.byteLength;
        while (pos < slabLen) {
          if (dc.readyState !== 'open') {
            throw new Error('P2P 通道意外断开');
          }
          if (dc.bufferedAmount >= HIGH_WATER) {
            await waitForBufferedLow(dc, LOW_WATER);
          }
          const end = Math.min(slabLen, pos + chunkSize);
          const len = end - pos;
          dc.send(new Uint8Array(slab, pos, len));
          pos = end;
          offset += len;

          const now = performance.now();
          if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
            const delivered = Math.max(0, offset - dc.bufferedAmount);
            const winSec = (now - sampleAt) / 1000;
            if (winSec >= 0.35) {
              speedBps = Math.max(0, (delivered - sampleBytes) / winSec);
              sampleBytes = delivered;
              sampleAt = now;
            } else if (speedBps === 0) {
              speedBps = delivered / Math.max(0.02, (now - startedAt) / 1000);
            }
            lastProgressAt = now;
            this.onProgress({
              peerId,
              direction: 'send',
              fileName: file.name,
              percent: file.size > 0 ? Math.min(99, Math.round((delivered / file.size) * 100)) : 100,
              speedBps,
              transferredBytes: delivered,
              totalBytes: file.size,
            });
          }
        }
      }

      // Wait until SCTP send queue fully drains before sending completion marker
      while (dc.readyState === 'open' && dc.bufferedAmount > 0) {
        await waitForBufferedLow(dc, Math.min(LOW_WATER, Math.floor(dc.bufferedAmount / 2)));
        const now = performance.now();
        if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          const delivered = Math.max(0, file.size - dc.bufferedAmount);
          const totalSec = Math.max(0.02, (now - startedAt) / 1000);
          lastProgressAt = now;
          this.onProgress({
            peerId,
            direction: 'send',
            fileName: file.name,
            percent: file.size > 0 ? Math.min(99, Math.round((delivered / file.size) * 100)) : 100,
            speedBps: speedBps || delivered / totalSec,
            transferredBytes: delivered,
            totalBytes: file.size,
          });
        }
      }

      if (dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'done', id: transferId }));
        await Promise.race([
          ackPromise,
          new Promise<void>((r) => window.setTimeout(r, 4000)),
        ]);
      }

      const avgSpeed = file.size / Math.max(0.02, (performance.now() - startedAt) / 1000);
      this.onProgress(null);
      this.onComplete({
        direction: 'send',
        fileName: file.name,
        sizeBytes: file.size,
        speedBps: avgSpeed,
      });
    } catch (err) {
      this.onProgress(null);
      throw err;
    } finally {
      try {
        dc.close();
      } catch {
        // ignore
      }
    }
  }

  closeAll() {
    this.pcs.forEach((pc) => pc.close());
    this.pcs.clear();
    this.incoming.clear();
  }
}
