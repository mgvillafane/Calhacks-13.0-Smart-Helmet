import { PermissionsAndroid, Platform } from "react-native";
import { Advertisement, Radio } from "./link";
import { HELMET_STATE_CHARACTERISTIC_UUID, SERVICE_UUID } from "./protocol";

type Subscription = { remove: () => void };
type Characteristic = { value: string | null };
type Device = {
  id: string;
  name: string | null;
  localName: string | null;
  discoverAllServicesAndCharacteristics: () => Promise<Device>;
  writeCharacteristicWithoutResponseForService: (service: string, characteristic: string, value: string) => Promise<unknown>;
  monitorCharacteristicForService: (
    service: string,
    characteristic: string,
    listener: (error: Error | null, characteristic: Characteristic | null) => void,
  ) => Subscription;
  cancelConnection: () => Promise<unknown>;
};

type Manager = {
  startDeviceScan: (
    uuids: string[] | null,
    options: null,
    listener: (error: Error | null, device: Device | null) => void,
  ) => void;
  stopDeviceScan: () => void;
  connectToDevice: (id: string) => Promise<Device>;
  destroy: () => void;
};

const SCAN_MS = 8000;

export async function createPhoneRadio(): Promise<Radio> {
  await requestBluetoothPermissions();
  let BleManager: new () => Manager;
  try {
    BleManager = require("react-native-ble-plx").BleManager;
  } catch {
    throw new Error("Bluetooth needs an Android development build. Expo Go cannot open the helmet radio.");
  }
  const manager = new BleManager();
  let device: Device | null = null;
  let subscription: Subscription | null = null;
  let notes: Uint8Array[] = [];

  return {
    scan: () =>
      new Promise((resolve, reject) => {
        const found = new Map<string, Advertisement>();
        const timer = setTimeout(() => {
          manager.stopDeviceScan();
          resolve([...found.values()]);
        }, SCAN_MS);
        try {
          manager.startDeviceScan([SERVICE_UUID], null, (error, scanned) => {
            if (error) {
              clearTimeout(timer);
              manager.stopDeviceScan();
              reject(error);
              return;
            }
            if (!scanned) return;
            const name = scanned.name || scanned.localName || "";
            if (name) found.set(scanned.id, { name, address: scanned.id });
          });
        } catch (error) {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("Bluetooth needs an Android development build. Expo Go cannot open the helmet radio."));
        }
      }),
    async connect(address: string) {
      device = await manager.connectToDevice(address);
      device = await device.discoverAllServicesAndCharacteristics();
    },
    async disconnect() {
      subscription?.remove();
      subscription = null;
      notes = [];
      if (device) await device.cancelConnection();
      device = null;
    },
    async writeWithoutResponse(characteristicUuid: string, payload: Uint8Array) {
      if (!device) throw new Error("helmet is not connected");
      await device.writeCharacteristicWithoutResponseForService(SERVICE_UUID, characteristicUuid, bytesToBase64(payload));
    },
    async subscribe(characteristicUuid: string) {
      if (!device) throw new Error("helmet is not connected");
      subscription?.remove();
      subscription = device.monitorCharacteristicForService(SERVICE_UUID, characteristicUuid, (error, characteristic) => {
        if (error || !characteristic?.value || characteristicUuid !== HELMET_STATE_CHARACTERISTIC_UUID) return;
        notes.push(base64ToBytes(characteristic.value));
      });
    },
    async takeNotifications(characteristicUuid: string) {
      if (characteristicUuid !== HELMET_STATE_CHARACTERISTIC_UUID) return [];
      const ready = notes;
      notes = [];
      return ready;
    },
    destroy: () => manager.destroy(),
  } as Radio & { destroy: () => void };
}

async function requestBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const permissions = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const result = await PermissionsAndroid.requestMultiple(permissions);
  const denied = permissions.some((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied) throw new Error("Android needs Bluetooth and location permission before it can find SmartHelmet.");
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    out += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return out;
}

function base64ToBytes(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/=+$/, "");
  const out: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index]);
    const b = alphabet.indexOf(clean[index + 1]);
    const c = alphabet.indexOf(clean[index + 2] ?? "A");
    const d = alphabet.indexOf(clean[index + 3] ?? "A");
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((triple >> 16) & 255);
    if (index + 2 < clean.length) out.push((triple >> 8) & 255);
    if (index + 3 < clean.length) out.push(triple & 255);
  }
  return Uint8Array.from(out);
}
