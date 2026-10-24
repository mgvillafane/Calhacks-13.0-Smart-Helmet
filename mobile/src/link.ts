import {
  CUE_CHARACTERISTIC_UUID,
  Cue,
  DEVICE_NAME,
  DIRECTION_NONE,
  SERVICE_UUID,
  HELMET_STATE_CHARACTERISTIC_UUID,
  decodeHelmetState,
  encodeCue,
  sameBytes,
} from "./protocol";

export const RESEND_S = 1;
export const HEADING_FRESH_S = 1;

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
};

export class HelmetLink {
  connected = false;
  headingDeg: number | null = null;
  headingAgeS: number | null = null;
  buttons = 0;
  private headingAtS: number | null = null;
  private lastPayload: Uint8Array | null = null;
  private lastSentS: number | null = null;

  constructor(private radio: Radio) {}

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
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.radio.disconnect();
    this.connected = false;
    this.headingDeg = null;
    this.headingAgeS = null;
    this.headingAtS = null;
    this.buttons = 0;
    this.lastPayload = null;
    this.lastSentS = null;
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
        continue;
      }
    }
    this.expireHeading(nowS);
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
