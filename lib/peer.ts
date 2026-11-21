import { createBrowserClient } from "@supabase/ssr";
import { api } from "./shared";
type Payload = Record<string, unknown>;
export interface PeerEvents {
  stream: (stream: MediaStream) => void;
  state: (online: boolean) => void;
  message: (type: string, body: Payload) => Promise<void> | void;
  error: (message: string) => void;
}
async function checksum(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export class BoothPeer {
  private connected = false;
  private updateConnection(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.events.state(connected);
  }
  private db = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  private channel: ReturnType<typeof this.db.channel> | null = null;
  private pc: RTCPeerConnection | null = null;
  private wire: RTCDataChannel | null = null;
  private instance = crypto.randomUUID();
  private remote = "";
  private candidates: RTCIceCandidateInit[] = [];
  private generation = 0;
  private stopped = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastHello = 0;
  private establishing = Promise.resolve();
  private ice: RTCConfiguration = {};
  private input = new MediaStream();
  private chunks = new Map<
    string,
    {
      parts: string[];
      length: number;
      type: string;
      hash: string;
      next: number;
    }
  >();
  private acknowledgements = new Map<string, (ok: boolean) => void>();
  private queue = Promise.resolve();
  private seen = new Set<string>();
  constructor(
    private room: string,
    private host: boolean,
    private events: PeerEvents,
  ) {}
  private signal(type: string, data: unknown, to = this.remote) {
    void this.channel?.send({
      type: "broadcast",
      event: "signal",
      payload: { from: this.instance, to, type, data },
    });
  }
  async start() {
    const [{ servers }, session] = await Promise.all([
      api("ice", { id: this.room }),
      this.db.auth.getSession(),
    ]);
    if (this.stopped) return;
    await this.db.realtime.setAuth(session.data.session?.access_token);
    if (this.stopped) return;
    this.ice = {
      iceServers: servers,
      iceTransportPolicy:
        new URLSearchParams(location.search).get("relay") === "1"
          ? "relay"
          : "all",
    };
    this.channel = this.db.channel("booth:" + this.room, {
      config: { private: true, broadcast: { self: false } },
    });
    this.channel
      .on("broadcast", { event: "signal" }, ({ payload: s }) => {
        if (
          this.stopped ||
          s.from === this.instance ||
          (s.to && s.to !== this.instance)
        )
          return;
        this.establishing = this.establishing
          .then(async () => {
            if (s.type === "hello") {
              this.lastHello = Date.now();
              if (this.remote !== s.from || !this.pc) {
                this.reset();
                this.remote = s.from;
                this.makeConnection();
                this.signal("hello", null);
                if (this.host) await this.offer();
              }
              return;
            }
            if (s.from !== this.remote || !this.pc) return;
            if (s.type === "bye") {
              this.reset();
              this.remote = "";
              return;
            }
            if (s.type === "offer" && !this.host) {
              await this.pc.setRemoteDescription(s.data);
              await this.pc.setLocalDescription(await this.pc.createAnswer());
              this.signal("answer", this.pc.localDescription?.toJSON());
            }
            if (
              s.type === "answer" &&
              this.host &&
              this.pc.signalingState === "have-local-offer"
            )
              await this.pc.setRemoteDescription(s.data);
            if (s.type === "ice") this.candidates.push(s.data);
            if (this.pc.remoteDescription) {
              for (const candidate of this.candidates.splice(0))
                await this.pc.addIceCandidate(candidate);
            }
          })
          .catch(() => this.events.error("Reconnecting to your partner…"));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.signal("hello", null, "");
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => {
            if (this.remote && Date.now() - this.lastHello > 14000) {
              this.reset();
              this.remote = "";
            }
            this.signal("hello", null, "");
          }, 3000);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.reset();
          this.remote = "";
          this.events.error(
            "Signaling unavailable. Check your connection and Realtime configuration.",
          );
        }
      });
  }
  private makeConnection() {
    const pc = new RTCPeerConnection(this.ice);
    this.pc = pc;
    for (const kind of ["video", "audio"])
      pc.addTransceiver(
        this.input.getTracks().find((t) => t.kind === kind) || kind,
        { direction: "sendrecv" },
      );
    const remoteStream = new MediaStream();
    pc.ontrack = (e) => {
      remoteStream.addTrack(e.track);
      this.events.stream(remoteStream);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal("ice", e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (
        pc.connectionState === "connected" &&
        this.wire?.readyState === "open"
      )
        this.updateConnection(true);
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        this.updateConnection(false);
        if (this.host && pc.connectionState === "failed")
          void this.offer(true).catch(() => this.reset());
      }
    };
    if (this.host)
      this.attach(pc.createDataChannel("keepsake", { ordered: true }));
    else pc.ondatachannel = (e) => this.attach(e.channel);
  }
  private async offer(restart = false) {
    const pc = this.pc;
    if (!pc || pc.signalingState !== "stable") return;
    await pc.setLocalDescription(await pc.createOffer({ iceRestart: restart }));
    this.signal("offer", pc.localDescription?.toJSON());
  }
  async tracks(stream: MediaStream) {
    this.input = stream;
    for (const tx of this.pc?.getTransceivers() || []) {
      await tx.sender.replaceTrack(
        stream.getTracks().find((t) => t.kind === tx.receiver.track.kind) ||
          null,
      );
    }
  }
  private attach(dc: RTCDataChannel) {
    this.wire = dc;
    dc.onopen = () => {
      if (this.wire === dc) this.updateConnection(true);
    };
    dc.onclose = () => {
      if (this.wire === dc) this.updateConnection(false);
    };
    let processing = Promise.resolve();
    dc.onmessage = (e) => {
      processing = processing
        .then(async () => {
          if (typeof e.data !== "string" || e.data.length > 20000) return;
          const packet = JSON.parse(e.data),
            id = packet.id;
          if (packet.kind === "ack") {
            this.acknowledgements.get(id)?.(true);
            return;
          }
          if (packet.kind === "small") {
            await this.events.message(packet.type, packet.body);
            return;
          }
          if (packet.kind === "begin") {
            if (
              this.chunks.size < 4 &&
              Number.isInteger(packet.length) &&
              packet.length > 0 &&
              packet.length <= 32_000_000
            )
              this.chunks.set(id, {
                parts: [],
                length: packet.length,
                next: 0,
                type: packet.type,
                hash: packet.hash,
              });
            return;
          }
          const entry = this.chunks.get(id);
          if (!entry) return;
          if (packet.kind === "part") {
            if (
              packet.index !== entry.next ||
              entry.next >= Math.ceil(entry.length / 12000)
            ) {
              this.chunks.delete(id);
              return;
            }
            entry.parts.push(packet.value);
            entry.next++;
            return;
          }
          if (packet.kind === "end") {
            this.chunks.delete(id);
            const value = entry.parts.join("");
            if (
              value.length !== entry.length ||
              (await checksum(value)) !== entry.hash
            )
              return;
            if (!this.seen.has(id)) {
              await this.events.message(entry.type, JSON.parse(value));
              this.seen.add(id);
              if (this.seen.size > 128)
                this.seen.delete(this.seen.values().next().value!);
            }
            dc.send(JSON.stringify({ kind: "ack", id }));
          }
        })
        .catch(() =>
          this.events.error("A transfer was interrupted. Please try again."),
        );
    };
  }
  small(type: string, body: Payload = {}) {
    if (this.wire?.readyState === "open")
      this.wire.send(JSON.stringify({ kind: "small", type, body }));
  }
  send(type: string, body: Payload) {
    const job = this.queue.then(() => this.transfer(type, body));
    this.queue = job.catch(() => {});
    return job;
  }
  private async transfer(type: string, body: Payload) {
    const generation = this.generation;
    const dc = this.wire;
    if (dc?.readyState !== "open")
      throw Error("Reconnect your partner to transfer this keepsake.");
    const value = JSON.stringify(body),
      id = crypto.randomUUID();
    if (value.length > 32_000_000)
      throw Error("This keepsake is too large to transfer.");
    const put = (p: unknown) => {
      if (generation !== this.generation) throw Error("Sharing stopped.");
      dc.send(JSON.stringify(p));
    };
    put({
      kind: "begin",
      id,
      type,
      length: value.length,
      hash: await checksum(value),
    });
    for (let i = 0; i < value.length; i += 12000) {
      const start = Date.now();
      while (dc.bufferedAmount > 192000) {
        if (dc.readyState !== "open" || Date.now() - start > 15000)
          throw Error("Transfer interrupted.");
        await new Promise((r) => setTimeout(r, 16));
      }
      put({
        kind: "part",
        id,
        index: i / 12000,
        value: value.slice(i, i + 12000),
      });
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(false), 20000);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        this.acknowledgements.delete(id);
        if (ok) resolve();
        else reject(Error("Your partner did not acknowledge the transfer."));
      };
      this.acknowledgements.set(id, finish);
      put({ kind: "end", id });
    });
  }
  cancelTransfers() {
    this.generation++;
    this.chunks.clear();
    this.acknowledgements.forEach((f) => f(false));
  }
  private reset() {
    this.cancelTransfers();
    this.candidates = [];
    this.updateConnection(false);
    this.wire?.close();
    this.pc?.close();
    this.pc = null;
    this.wire = null;
    this.chunks.clear();
    this.acknowledgements.forEach((f) => f(false));
  }
  close() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    this.signal("bye", null);
    this.reset();
    if (this.channel) void this.db.removeChannel(this.channel);
    this.input.getTracks().forEach((t) => t.stop());
  }
}
