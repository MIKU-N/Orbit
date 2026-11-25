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
  peerId: string;
  name: string;
  size: number;
  mime: string;
  framed: boolean;
  totalChunks: number;
  receivedChunks: number;
  received: number;
  chunks: ArrayBuffer[];
  startedAt: number;
  lastActivityAt: number;
  lastProgressAt: number;
  sampleBytes: number;
  sampleAt: number;
  speedBps: number;
  controlChannel?: RTCDataChannel;
  finished: boolean;
  stallTimer?: number;
}

const MULTI_LANE_THRESHOLD = 8 * 1024 * 1024; // >= 8 MB uses 4 parallel RTCPeerConnection lanes
const MAX_LANES = 4;
const READ_SLAB_SIZE = 4 * 1024 * 1024; // 4 MB sequential disk read slab
const MAX_CHUNK_SIZE = 256 * 1024; // 256 KB max SCTP message size
const DEFAULT_CHUNK_SIZE = 64 * 1024;
const FRAME_HEADER_BYTES = 4; // uint32 LE chunk sequence index
const HIGH_WATER = 8 * 1024 * 1024; // 8 MB per lane
const LOW_WATER = 4 * 1024 * 1024; // 4 MB per lane (prevents pipe starvation on gigabit+ LAN)
const PROGRESS_INTERVAL_MS = 120;
const STALL_TIMEOUT_MS = 25000;

function pickChunkSize(pc: RTCPeerConnection): number {
  const maxMsg = pc.sctp?.maxMessageSize;
  if (!maxMsg || !Number.isFinite(maxMsg) || maxMsg <= 0) {
    return DEFAULT_CHUNK_SIZE;
  }
  return Math.min(MAX_CHUNK_SIZE, Math.max(16 * 1024, Math.floor(maxMsg / 1024) * 1024));
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

function parseChannelLabel(label: string): { transferId: string; lane: number } | null {
  const m = label.match(/^orbit-file:([^:]+):(\d+)$/);
  if (!m) return null;
  return { transferId: m[1], lane: Number(m[2]) || 0 };
}

export class OrbitP2PManager {
  private pcs = new Map<string, RTCPeerConnection>();
  private incoming = new Map<string, IncomingTransfer>();
  private sendSignal: SignalSender;
  private onProgress: (p: TransferProgress | null) => void;
  private onComplete: (info: {
    direction: 'send' | 'receive';
    fileName: string;
    sizeBytes: number;
    speedBps: number;
  }) => void;

  constructor(
    sendSignal: SignalSender,
    onProgress: (p: TransferProgress | null) => void,
    onComplete: (info: {
      direction: 'send' | 'receive';
      fileName: string;
      sizeBytes: number;
      speedBps: number;
    }) => void,
  ) {
    this.sendSignal = sendSignal;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
  }

  private pcKey(peerId: string, lane: number): string {
    return `${peerId}#${lane}`;
  }

  private clearIncomingForPeer(peerId: string) {
    let removedAny = false;
    for (const [k, st] of this.incoming.entries()) {
      if (st.peerId === peerId) {
        if (st.stallTimer !== undefined) window.clearTimeout(st.stallTimer);
        this.incoming.delete(k);
        removedAny = true;
      }
    }
    if (removedAny && this.incoming.size === 0) {
      this.onProgress(null);
    }
  }

  private createPeerConnection(peerId: string, lane = 0, sameLan = false): RTCPeerConnection {
    const key = this.pcKey(peerId, lane);
    const existing = this.pcs.get(key);
    if (existing && !['failed', 'closed', 'disconnected'].includes(existing.connectionState)) {
      return existing;
    }
    if (existing) {
      try {
        existing.close();
      } catch {
        // ignore
      }
      this.pcs.delete(key);
    }

    // Pure host candidates on same LAN avoid external STUN lookup delays
    const pc = new RTCPeerConnection({
      iceServers: sameLan ? [] : [{ urls: 'stun:stun.l.google.com:19302' }],
      iceCandidatePoolSize: sameLan ? 0 : 2,
    });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignal(peerId, { kind: 'ice', lane, sameLan, candidate: ev.candidate });
      }
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        try {
          pc.close();
        } catch {
          // ignore
        }
        if (this.pcs.get(key) === pc) {
          this.pcs.delete(key);
        }
        if (lane === 0) {
          this.clearIncomingForPeer(peerId);
        }
      }
    };
    pc.ondatachannel = (ev) => {
      this.bindReceiveChannel(peerId, ev.channel);
    };
    this.pcs.set(key, pc);
    return pc;
  }

  private armStallWatchdog(key: string, state: IncomingTransfer) {
    if (state.stallTimer !== undefined) {
      window.clearTimeout(state.stallTimer);
    }
    state.stallTimer = window.setTimeout(() => {
      const cur = this.incoming.get(key);
      if (cur && cur === state && !cur.finished) {
        this.incoming.delete(key);
        if (this.incoming.size === 0) {
          this.onProgress(null);
        }
      }
    }, STALL_TIMEOUT_MS);
  }

  private finalizeIncoming(key: string, state: IncomingTransfer) {
    if (state.finished) return;
    state.finished = true;
    if (state.stallTimer !== undefined) {
      window.clearTimeout(state.stallTimer);
      state.stallTimer = undefined;
    }
    this.incoming.delete(key);

    const elapsedSec = Math.max(0.02, (performance.now() - state.startedAt) / 1000);
    const avgSpeed = state.received / elapsedSec;

    try {
      if (state.controlChannel?.readyState === 'open') {
        state.controlChannel.send(JSON.stringify({ type: 'ack', id: state.id }));
      }
    } catch {
      // ignore ack send failure
    }

    const ordered = state.framed
      ? state.chunks.filter((c): c is ArrayBuffer => Boolean(c))
      : state.chunks;
    const blob = new Blob(ordered, { type: state.mime });
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

  private ensureIncoming(
    peerId: string,
    transferId: string,
    dc?: RTCDataChannel,
  ): { key: string; state: IncomingTransfer } {
    const key = `${peerId}:${transferId}`;
    let state = this.incoming.get(key);
    if (!state) {
      const now = performance.now();
      state = {
        id: transferId,
        peerId,
        name: 'orbit-file.bin',
        size: 0,
        mime: 'application/octet-stream',
        framed: true,
        totalChunks: 0,
        receivedChunks: 0,
        received: 0,
        chunks: [],
        startedAt: now,
        lastActivityAt: now,
        lastProgressAt: now,
        sampleBytes: 0,
        sampleAt: now,
        speedBps: 0,
        controlChannel: dc,
        finished: false,
      };
      this.incoming.set(key, state);
    }
    if (dc && !state.controlChannel) {
      state.controlChannel = dc;
    }
    return { key, state };
  }

  private bindReceiveChannel(peerId: string, dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    const parsedLabel = parseChannelLabel(dc.label);
    let currentKey = parsedLabel ? `${peerId}:${parsedLabel.transferId}` : '';

    const handleChunkBuffer = (buf: ArrayBuffer) => {
      if (!currentKey && parsedLabel) {
        currentKey = `${peerId}:${parsedLabel.transferId}`;
      }
      if (!currentKey) return;
      let state = this.incoming.get(currentKey);
      if (!state && parsedLabel) {
        state = this.ensureIncoming(peerId, parsedLabel.transferId, parsedLabel.lane === 0 ? dc : undefined).state;
      }
      if (!state || state.finished) return;

      const now = performance.now();
      state.lastActivityAt = now;
      this.armStallWatchdog(currentKey, state);

      if (state.framed) {
        if (buf.byteLength < FRAME_HEADER_BYTES) return;
        const seq = new DataView(buf, 0, FRAME_HEADER_BYTES).getUint32(0, true);
        const payload = buf.slice(FRAME_HEADER_BYTES);
        if (!state.chunks[seq]) {
          state.receivedChunks += 1;
          state.received += payload.byteLength;
        }
        state.chunks[seq] = payload;
      } else {
        state.chunks.push(buf);
        state.received += buf.byteLength;
      }

      if (
        now - state.lastProgressAt >= PROGRESS_INTERVAL_MS ||
        (state.size > 0 && state.received >= state.size)
      ) {
        const winSec = (now - state.sampleAt) / 1000;
        if (winSec >= 0.3) {
          state.speedBps = (state.received - state.sampleBytes) / winSec;
          state.sampleBytes = state.received;
          state.sampleAt = now;
        } else if (state.speedBps === 0) {
          const totalSec = Math.max(0.02, (now - state.startedAt) / 1000);
          state.speedBps = state.received / totalSec;
        }
        state.lastProgressAt = now;
        const pct =
          state.size > 0 ? Math.min(100, Math.round((state.received / state.size) * 100)) : 100;
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

      if (
        state.framed &&
        state.totalChunks > 0 &&
        state.receivedChunks >= state.totalChunks
      ) {
        this.finalizeIncoming(currentKey, state);
      }
    };

    dc.onclose = () => {
      if (currentKey) {
        const st = this.incoming.get(currentKey);
        if (st && !st.finished && (!parsedLabel || parsedLabel.lane === 0)) {
          if (st.stallTimer !== undefined) window.clearTimeout(st.stallTimer);
          this.incoming.delete(currentKey);
          if (this.incoming.size === 0) {
            this.onProgress(null);
          }
        }
      }
    };

    dc.onerror = () => {
      if (currentKey) {
        const st = this.incoming.get(currentKey);
        if (st && !st.finished) {
          if (st.stallTimer !== undefined) window.clearTimeout(st.stallTimer);
          this.incoming.delete(currentKey);
          if (this.incoming.size === 0) {
            this.onProgress(null);
          }
        }
      }
    };

    dc.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        handleChunkBuffer(ev.data);
        return;
      }

      if (typeof ev.data === 'string') {
        try {
          const ctrl = JSON.parse(ev.data);
          if (ctrl.type === 'meta') {
            const transferId = String(ctrl.id || '');
            const ensured = this.ensureIncoming(peerId, transferId, dc);
            currentKey = ensured.key;
            const st = ensured.state;
            st.name = ctrl.name || 'orbit-file.bin';
            st.size = Number(ctrl.size) || 0;
            st.mime = ctrl.mime || 'application/octet-stream';
            st.framed = Boolean(ctrl.framed);
            st.totalChunks = Number(ctrl.totalChunks) || 0;
            st.controlChannel = dc;
            this.armStallWatchdog(currentKey, st);

            this.onProgress({
              peerId,
              direction: 'receive',
              fileName: st.name,
              percent:
                st.size > 0 ? Math.min(99, Math.round((st.received / st.size) * 100)) : 0,
              speedBps: st.speedBps,
              transferredBytes: st.received,
              totalBytes: st.size,
            });

            if (st.size === 0 || (st.framed && st.totalChunks > 0 && st.receivedChunks >= st.totalChunks)) {
              this.finalizeIncoming(currentKey, st);
            }
          } else if (ctrl.type === 'done') {
            const key = ctrl.id ? `${peerId}:${ctrl.id}` : currentKey;
            const st = this.incoming.get(key);
            if (!st) return;
            if (!st.framed || st.totalChunks === 0 || st.receivedChunks >= st.totalChunks) {
              this.finalizeIncoming(key, st);
            }
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
      lane?: number;
      sameLan?: boolean;
      sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };
    const lane = typeof sig.lane === 'number' && sig.lane >= 0 ? sig.lane : 0;
    const pc = this.createPeerConnection(fromPeerId, lane, Boolean(sig.sameLan));
    if (sig.kind === 'offer' && sig.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(fromPeerId, {
        kind: 'answer',
        lane,
        sameLan: Boolean(sig.sameLan),
        sdp: pc.localDescription,
      });
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

  private async openLaneChannel(
    peerId: string,
    lane: number,
    transferId: string,
    sameLan: boolean,
  ): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel }> {
    const pc = this.createPeerConnection(peerId, lane, sameLan);
    const needsNegotiation = pc.connectionState !== 'connected' || !pc.sctp;
    const dc = pc.createDataChannel(`orbit-file:${transferId}:${lane}`, {
      ordered: lane === 0,
    });
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
      this.sendSignal(peerId, { kind: 'offer', lane, sameLan, sdp: pc.localDescription });
    }

    await openPromise;
    return { pc, dc };
  }

  async sendFile(peerId: string, file: File, opts?: { sameLan?: boolean }) {
    const sameLan = Boolean(opts?.sameLan);
    const laneCount = file.size >= MULTI_LANE_THRESHOLD ? MAX_LANES : 1;
    const transferId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const openedLanes = await Promise.all(
      Array.from({ length: laneCount }, (_, lane) =>
        this.openLaneChannel(peerId, lane, transferId, sameLan),
      ),
    );

    const controlLane = openedLanes[0];
    const maxMsgSize = Math.min(...openedLanes.map((l) => pickChunkSize(l.pc)));
    const payloadChunkSize = Math.max(16 * 1024, maxMsgSize - FRAME_HEADER_BYTES);
    const totalChunks = file.size > 0 ? Math.ceil(file.size / payloadChunkSize) : 0;

    let ackResolve: (() => void) | null = null;
    const ackPromise = new Promise<void>((resolve) => {
      ackResolve = resolve;
    });
    controlLane.dc.onmessage = (ev) => {
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

    controlLane.dc.send(
      JSON.stringify({
        type: 'meta',
        id: transferId,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        lanes: laneCount,
        totalChunks,
        framed: true,
      }),
    );

    const startedAt = performance.now();
    let lastProgressAt = startedAt;
    let sampleAt = startedAt;
    let sampleBytes = 0;
    let speedBps = 0;
    let totalQueuedBytes = 0;

    this.onProgress({
      peerId,
      direction: 'send',
      fileName: file.name,
      percent: 0,
      speedBps: 0,
      transferredBytes: 0,
      totalBytes: file.size,
    });

    const emitSendProgress = (force = false) => {
      const now = performance.now();
      if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      let totalBuffered = 0;
      for (const l of openedLanes) {
        totalBuffered += l.dc.bufferedAmount;
      }
      const delivered = Math.max(0, Math.min(file.size, totalQueuedBytes - totalBuffered));
      const winSec = (now - sampleAt) / 1000;
      if (winSec >= 0.3) {
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
    };

    // Align slab size to a multiple of payloadChunkSize so every slab produces exact chunk indices
    const chunksPerSlab = Math.max(1, Math.floor(READ_SLAB_SIZE / payloadChunkSize));
    const slabByteLen = chunksPerSlab * payloadChunkSize;
    let nextChunkCursor = 0;

    const sendWorker = async (dc: RTCDataChannel) => {
      while (true) {
        const startChunk = nextChunkCursor;
        if (startChunk >= totalChunks) break;
        const endChunk = Math.min(totalChunks, startChunk + chunksPerSlab);
        nextChunkCursor = endChunk;

        const byteStart = startChunk * payloadChunkSize;
        const byteEnd = Math.min(file.size, byteStart + slabByteLen);
        const slab = await file.slice(byteStart, byteEnd).arrayBuffer();
        const slabBytes = new Uint8Array(slab);

        let localPos = 0;
        for (let seq = startChunk; seq < endChunk; seq += 1) {
          if (dc.readyState !== 'open') {
            throw new Error('P2P 通道意外断开');
          }
          if (dc.bufferedAmount >= HIGH_WATER) {
            await waitForBufferedLow(dc, LOW_WATER);
          }
          const len = Math.min(payloadChunkSize, slabBytes.byteLength - localPos);
          const packet = new Uint8Array(FRAME_HEADER_BYTES + len);
          new DataView(packet.buffer).setUint32(0, seq, true);
          packet.set(slabBytes.subarray(localPos, localPos + len), FRAME_HEADER_BYTES);
          dc.send(packet);
          localPos += len;
          totalQueuedBytes += len;
          emitSendProgress(false);
        }
      }

      while (dc.readyState === 'open' && dc.bufferedAmount > 0) {
        await waitForBufferedLow(dc, Math.min(LOW_WATER, Math.floor(dc.bufferedAmount / 2)));
        emitSendProgress(false);
      }
    };

    try {
      await Promise.all(openedLanes.map((l) => sendWorker(l.dc)));

      if (controlLane.dc.readyState === 'open') {
        controlLane.dc.send(JSON.stringify({ type: 'done', id: transferId }));
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
      for (const l of openedLanes) {
        try {
          l.dc.close();
        } catch {
          // ignore
        }
      }
    }
  }

  closeAll() {
    this.pcs.forEach((pc) => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    });
    this.pcs.clear();
    this.incoming.forEach((st) => {
      if (st.stallTimer !== undefined) window.clearTimeout(st.stallTimer);
    });
    this.incoming.clear();
    this.onProgress(null);
  }
}
