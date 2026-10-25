# Helmet BLE protocol

The phone is the Bluetooth central. The ESP32-S3 is the peripheral and advertises as `SmartHelmet`. The phone writes the next vibration cue. The ESP32 notifies heading, buttons, and a debug sensor sample. The ESP32 does not receive a route or a GPS stream.

Service UUID: `7c1a0001-5e2b-4a6d-8f10-9b3c4d5e6f70`

Cue characteristic (phone writes, with or without response): `7c1a0002-5e2b-4a6d-8f10-9b3c4d5e6f70`

Helmet-state characteristic (ESP32 notifies and allows read): `7c1a0003-5e2b-4a6d-8f10-9b3c4d5e6f70`

Sensor characteristic (ESP32 notifies): `7c1a0004-5e2b-4a6d-8f10-9b3c4d5e6f70`

Audio characteristic (ESP32 notifies): `7c1a0005-5e2b-4a6d-8f10-9b3c4d5e6f70`

Multi-byte numbers are little-endian. Version is `1`.

## Cue, 8 bytes

| Offset | Field | Values |
| --- | --- | --- |
| 0 | version | 1 |
| 1 | direction | 0 none, 1 left, 2 front, 3 right, 4 u-turn |
| 2 | intensity | 0–255 PWM duty |
| 3–4 | pulse period ms | uint16 |
| 5–6 | distance m | uint16 |
| 7 | flags | bit 0 arrived, bit 1 off-route, bit 2 rerouting |

Unknown versions, directions, or flag bits are rejected. A cue older than 2 seconds, or a dropped connection, stops the motors.

Left, front, and right each pulse one motor: GPIO 17, 18, and 21. A u-turn alternates left and right. Heading is not decided on the ESP32.

## Helmet state, 4 bytes

| Offset | Field | Values |
| --- | --- | --- |
| 0–1 | heading | uint16 decidegrees, 0–3599, or `0xFFFF` when invalid |
| 2 | valid | 1 when heading is 0–3599, otherwise 0 |
| 3 | buttons | bit 0 MODE (GPIO 8), bit 1 SOS (GPIO 9), bit 2 TALK. TALK stays set after a press of GPIO 7 until the next press |

A valid flag must match the heading. The ESP32 notifies this about 5 times a second. Until the IMU is read, heading is the invalid sentinel.

## Sensor sample, 20 bytes

| Offset | Field | Values |
| --- | --- | --- |
| 0 | version | 1 |
| 1 | flags | bit 0 IMU ok, bit 1 microphone ok |
| 2–3 | ax | int16 milli-g |
| 4–5 | ay | int16 milli-g |
| 6–7 | az | int16 milli-g |
| 8–9 | gx | int16 tenths of a degree per second |
| 10–11 | gy | int16 tenths of a degree per second |
| 12–13 | gz | int16 tenths of a degree per second |
| 14–15 | mic peak | int16, loudest recent INMP441 sample scaled down |
| 16–19 | reserved | 0 |

Unknown versions or flag bits are rejected. The ESP32 notifies this about 10 times a second. Full 16 kHz audio does not fit on this notify. The debug page shows the six IMU numbers and a level bar from the peak.

## Audio, 3–242 bytes

| Offset | Field | Values |
| --- | --- | --- |
| 0 | version | 1 |
| 1 | sequence | uint8, +1 per packet, wraps at 255 |
| 2… | samples | 1–240 G.711 mu-law bytes, 16 kHz mono |

The ESP32 streams the helmet INMP441 here while the TALK bit is set and a phone is connected: 16 KB/s, about 67 packets a second. The phone asks for a 247-byte MTU so a full packet fits one notify. A sequence gap is filled with silence so the audio keeps its timing. The first press sets TALK and the phone starts a turn from that helmet audio. The next press clears TALK, and the phone sends the audio and starts the search. Letting go of the switch does not stop the microphone. Unknown versions or empty packets are rejected.
