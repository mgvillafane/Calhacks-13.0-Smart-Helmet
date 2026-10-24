# Helmet BLE protocol

The phone is the Bluetooth central. The ESP32-S3 is the peripheral and advertises as `SmartHelmet`. The phone writes the next vibration cue. The ESP32 notifies heading and buttons. The ESP32 does not receive a route or a GPS stream.

Service UUID: `7c1a0001-5e2b-4a6d-8f10-9b3c4d5e6f70`

Cue characteristic (phone writes, with or without response): `7c1a0002-5e2b-4a6d-8f10-9b3c4d5e6f70`

Helmet-state characteristic (ESP32 notifies and allows read): `7c1a0003-5e2b-4a6d-8f10-9b3c4d5e6f70`

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
| 3 | buttons | bit 0 MODE (GPIO 8), bit 1 SOS (GPIO 9), active low |

A valid flag must match the heading. The ESP32 notifies this about 5 times a second. Until the IMU is read, heading is the invalid sentinel.
