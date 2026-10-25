import {
  AUDIO_CHARACTERISTIC_UUID,
  AudioPacket,
  BUTTON_TALK,
  CUE_CHARACTERISTIC_UUID,
  Cue,
  DEVICE_NAME,
  DIRECTION_NONE,
  SERVICE_UUID,
  HELMET_STATE_CHARACTERISTIC_UUID,
  SENSOR_CHARACTERISTIC_UUID,
  SensorSample,
  decodeAudioPacket,
  decodeHelmetState,
  decodeSensorSample,
  encodeCue,
  sameBytes,
} from "./protocol";

export const RESEND_S = 1;
export const HEADING_FRESH_S = 1;
export const MAX_AUDIO_GAP_PACKETS = 25;

export type Advertisement = { name: string; address: string };

export function advertisementFromScan(device: {
  id: string;
  name: string | null;
  localName: string | null;
  serviceUUIDs: string[] | null;
}): Advertisement | null {
  const name = (device.name || device.localName || "").trim();
  const advertisesHelmet = (device.serviceUUIDs ?? []).some((uuid) => uuid.toLowerCase() === SERVICE_UUID);
  if (name !== DEVICE_NAME && !advertisesHelmet) return null;
  return { name: DEVICE_NAME, address: device.id };
}

export type Radio = {
  scan: () => Promise<Advertisement[]>;
  connect: (address: string) => Promise<void>;
  disconnect: () => Promise<void>;
  writeWithoutResponse: (characteristicUuid: string, payload: Uint8Array) => Promise<void>;
  subscribe: (characteristicUuid: string) => Promise<void>;
  takeNotifications: (characteristicUuid: string) => Promise<Uint8Array[]>;
  read?: (characteristicUuid: string) => Promise<Uint8Array | null>;
};

export class HelmetLink {
  connected = false;
  headingDeg: number | null = null;
  headingAgeS: number | null = null;
  buttons = 0;
  sensors: SensorSample | null = null;
  private headingAtS: number | null = null;
  private lastPayload: Uint8Array | null = null;
  private lastSentS: number | null = null;
  private audio: Uint8Array[] = [];
  private audioSequence: number | null = null;
  private reading = false;

  constructor(private radio: Radio) {}

  get talk(): boolean {
    return (this.buttons & BUTTON_TALK) !== 0;
  }

  get buttonPressed(): boolean {
    return this.buttons !== 0;
  }

  takeAudio(): Uint8Array {
    const parts = this.audio.splice(0);
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  async scan(): Promise<Advertisement | null> {
    for (const advertisement of await this.radio.scan()) {
      if (advertisement.name === DEVICE_NAME) return advertisement;
    }
    return null;
  }

  async connect(advertisement: Advertisement): Promise<void> {
    if (advertisement.name !== DEVICE_NAME) throw new Error(`expected ${DEVICE_NAME}`);
    await this.radio.connect(advertisement.address);
    await this.radio.subscribe(HELMET_STATE_CHARACTERISTIC_UUID);
    try {
      await this.radio.subscribe(SENSOR_CHARACTERISTIC_UUID);
    } catch {
      this.sensors = null;
    }
    try {
      await this.radio.subscribe(AUDIO_CHARACTERISTIC_UUID);
    } catch {
      this.audio = [];
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.radio.disconnect();
    this.connected = false;
    this.headingDeg = null;
    this.headingAgeS = null;
    this.headingAtS = null;
    this.buttons = 0;
    this.sensors = null;
    this.lastPayload = null;
    this.lastSentS = null;
    this.audio = [];
    this.audioSequence = null;
  }

  async send(cue: Cue, nowS: number): Promise<void> {
    this.requireConnected();
    const payload = encodeCue(cue);
    const repeat = cue.direction !== DIRECTION_NONE && this.lastSentS !== null && nowS - this.lastSentS >= RESEND_S;
    if (!sameBytes(this.lastPayload, payload) || repeat) {
      await this.radio.writeWithoutResponse(CUE_CHARACTERISTIC_UUID, payload);
      this.lastPayload = payload;
      this.lastSentS = nowS;
    }
  }

  async poll(nowS: number): Promise<void> {
    this.requireConnected();
    for (const packet of await this.radio.takeNotifications(HELMET_STATE_CHARACTERISTIC_UUID)) {
      this.applyHelmetState(packet, nowS);
    }
    // Overlapping polls skip the read so queued reads cannot leave the button state seconds behind.
    if (this.radio.read && !this.reading) {
      this.reading = true;
      try {
        const packet = await this.radio.read(HELMET_STATE_CHARACTERISTIC_UUID);
        if (packet) this.applyHelmetState(packet, nowS);
      } catch {
        // A missed read leaves the last notified button state in place.
      } finally {
        this.reading = false;
      }
    }
    for (const packet of await this.radio.takeNotifications(SENSOR_CHARACTERISTIC_UUID)) {
      try {
        this.sensors = decodeSensorSample(packet);
      } catch {
        continue;
      }
    }
    for (const packet of await this.radio.takeNotifications(AUDIO_CHARACTERISTIC_UUID)) {
      try {
        this.acceptAudio(decodeAudioPacket(packet));
      } catch {
        continue;
      }
    }
    this.expireHeading(nowS);
  }

  private applyHelmetState(packet: Uint8Array, nowS: number): void {
    try {
      const state = decodeHelmetState(packet);
      this.buttons = state.buttons;
      if (state.headingValid) {
        this.headingDeg = state.headingDecidegrees / 10;
        this.headingAtS = nowS;
      } else {
        this.headingDeg = null;
        this.headingAgeS = null;
        this.headingAtS = null;
      }
    } catch {
      // A bad packet leaves the last good button state in place.
    }
  }

  private acceptAudio(packet: AudioPacket): void {
    if (this.audioSequence !== null) {
      const missing = (packet.sequence - this.audioSequence - 1) & 0xff;
      if (missing > 0 && missing <= MAX_AUDIO_GAP_PACKETS) this.audio.push(new Uint8Array(missing * packet.pcm.length));
    }
    this.audioSequence = packet.sequence;
    this.audio.push(packet.pcm);
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error("helmet is not connected");
  }

  private expireHeading(nowS: number): void {
    if (this.headingAtS === null) return;
    const age = nowS - this.headingAtS;
    if (age > HEADING_FRESH_S) {
      this.headingDeg = null;
      this.headingAgeS = null;
      this.headingAtS = null;
      return;
    }
    this.headingAgeS = age;
  }
}
