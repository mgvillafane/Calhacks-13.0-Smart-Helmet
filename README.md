# Smart Helmet | KiCad prototype schematic

Editable **KiCad 8-format** self-contained module-wiring schematic with custom embedded symbols.
Open `Helmet_Navigation.kicad_sch` in KiCad Schematic Editor. The file is
a logical **wiring harness / module schematic**, not a routed PCB or Gerber set.
The generated syntax and connections were checked programmatically,
but a KiCad GUI import and electrical-rules check were not available
in the generation environment. Run ERC and review connections before assembly.

## Selected architecture

- Power: FKE8002 USB power bank (regulated 5V), USB breakout, F1 1.5A PTC, SW1 switch.
- Controller: ESP32-S3-DevKitC-1 (N16R8) on 5V; onboard 3.3V regulator feeds sensors.
- Navigation: the phone owns GPS and routing. It writes an 8-byte vibration cue to the ESP32-S3 over BLE. The ESP32 notifies heading and button state. No separate GNSS chip.
- IMU: the current firmware reads an MPU6050 at 3.3V over I2C. The original
  schematic models an LSM6DSOX + LIS3MDL breakout; that needs a different driver.
- Microphone: INMP441 I2S breakout at **3.3V only**; L/R tied GND.
- Motors: 3 x 3V ERM coin motors on a dedicated, preadjusted 3.0V buck rail.
- Motor switches: 3 x AO3400A (SOT-23 G1/S2/D3), 3 x 100-ohm series
  gate resistors, 3 x 100k gate pull-downs, 3 x 1N5819 flyback diodes
  (stripe/cathode to +3V0_MOT, other end to MOSFET drain/motor -).
- Blinkers: 2 x 3-pixel WS2812B RGB sections, each at 5V, using the first
  two channels of a SN74AHCT125 3.3-to-5V data buffer with 330-ohm
  series resistor per data line. Unused buffer channels properly disabled.
- Two optional GPIO buttons: MODE and SOS, normally open to ground.
- 5V/3.0V rail bulk capacitors and local IC supply bypass capacitors are shown.

## GPIO wiring

| ESP32-S3 GPIO | Wiring |
| --- | --- |
| 4 / 5 / 6 | IMU SDA / SCL / INT1 |
| 8 / 9 | MODE / SOS pushbuttons (firmware internal pull-ups) |
| 10 / 11 | LED left / right via SN74AHCT125 |
| 14 / 15 / 16 | I2S microphone SCK / WS / SD |
| 17 / 18 / 21 | Haptic left / front / right MOSFET gates |

## Wiring and power checks

1. All supply rails share **common GND**, including power bank, ESP32,
   buck output, strips, microphone and haptic MOSFET sources.
2. **Do not connect 5V to the INMP441 VDD or an ESP32 GPIO**.
3. Set and measure the adjustable motor buck to **3.0V** before installation.
4. AO3400A pin numbering is **1 Gate, 2 Source, 3 Drain**; verify your
   particular purchased part and any MOSFET *module* pinout.
5. A 1N5819 diode **cathode stripe goes to motor +**, anode to motor -.
6. On-board I2C pull-ups usually exist on the selected Adafruit breakout.
   Check your exact board; add two 4.7k pull-ups to 3.3V if absent.
7. Place 100nF bypass capacitors near devices, 470uF at LED strip 5V inputs.
8. Avoid powering the ESP32-S3 DevKit through its USB port while externally
   driving its 5V header, unless the board power-path arrangement is verified.
9. Size fuse, switch, regulator, wire gauge, and connectors to *measured*
   LED full-load plus vibration motor **startup/stall** current.
10. The selected 9-DoF breakout's exact INT1 pin exposure varies; if not
    exposed, leave GPIO6 unused and poll via I2C. Confirm module markings.
11. If your ESP32-S3 board variant uses different header assignments, adapt
    GPIOs in firmware and this schematic before wiring. GPIO numbers are
    logical names, **not physical header position numbers**.

**Safety:** Prototype indicators are not certified bicycle/road turn signals.
Do not cut, drill, modify the protective helmet shell, or compromise fit.
Secure and weatherproof wiring outside the helmet's protective structure;​
test collision-alert thresholds carefully to avoid false reassurance.

## Install

Expo Go cannot install the app. `react-native-ble-plx` and `@rnmapbox/maps` are native modules, so each phone needs its own build. Only one phone connects to the helmet at a time.

Android is one arm64 release APK. Allow install from unknown sources, then open the APK. Android 12 and newer also ask for Nearby devices.

An iPhone needs Xcode and a free Apple ID. That install lasts about 7 days. A paid Apple Developer account can use TestFlight instead.

The Mapbox token must list the Android `applicationId` and the iOS bundle id. The token is not in git. OpenRouteService is not used. Street routes and the map come from OpenStreetMap, with no routing key.

Flash the helmet from `firmware/` with `pio run -t upload` for the `esp32-s3-devkitc-1` environment. The board advertises as `SmartHelmet`.

## Live IMU graph and brake sensitivity

From the repository root, install the plotter's serial dependency and start it:

```powershell
python -m pip install -r firmware/requirements.txt
python firmware/imu_live.py --list-ports
python firmware/imu_live.py --port COM7
```

Open **http://127.0.0.1:8765**. Replace `COM7` with the ESP32's port. Omitting
`--port` selects a single Espressif USB device automatically, without selecting
the blinker Arduino. Close other serial monitors before connecting. Use
`--csv imu-session.csv` to record the full session, or download the last 30 seconds
from the graph. `--demo` previews the charts with clearly marked synthetic data.
The plot also accepts older firmware's raw acceleration and gyro stream; flash
the updated firmware to see its actual brake decision and motion measurements.

The brake detector learns gravity and gyro bias during **0.5 seconds held still**
after startup. It follows gravity using all three gyro axes, removes vertical
acceleration, and integrates the horizontal acceleration vector over **300 ms**.
This gives a short-window velocity-change magnitude, without assuming a forward
axis or the sign of the sensor mounting. It is not an absolute speed estimate.
Individual impacts are capped, opposite vibrations cancel, and rotation faster
than **35 degrees/second** suppresses new triggers.

Sensitivity is configured in `firmware/include/brake.h`:

| Setting | Value |
| --- | --- |
| Turn on | 0.08g rolling average, with sustained horizontal motion for 80 ms |
| Release | 0.035g, with 250 ms of consecutive calm samples |
| Integration window | 300 ms |
| Startup calibration | 500 ms held still |

The lower threshold detects gentler changes than the previous 0.20g detector.
The rolling window also adds delay; this is not an 80 ms total response time.
**Without a forward direction or a velocity reference, speeding up and sustained
sideways acceleration can also activate this motion-based brake estimate.**
Gravity compensation and head-motion rejection reduce false triggers but do not
replace a calibrated vehicle-speed signal. A failed IMU read releases the brake
and requires calibration again.

The ESP32 sends `B` (braking) or `b` (released) over **GPIO12 TX to Arduino RX0**
at 115200 baud, refreshing every 200 ms. The Arduino sketch in
`firmware/test_blinker_arduino/` controls the brake strip through **Arduino D8**.

Plot checks: `python -B -m unittest discover -s firmware/host -p test_imu_live.py`.
The existing C host suite includes mounting, sensitivity, vibration, tilt,
sampling-gap, and sensor-failure cases for the detector:

```sh
clang -std=c11 -Wall -Wextra -Werror -I firmware/include firmware/src/actuators.c firmware/src/heading.c firmware/src/protocol.c firmware/src/blinker.c firmware/src/brake.c firmware/src/mic.c firmware/host/test_helmet.c -lm -o helmet-check
```

Run the resulting `helmet-check` executable to execute those checks.

## Files

- `PLAN.md` - navigation app plan: phone routing, helmet vibration cues, deploy, and prize-track options.
- `shared/cue-protocol.md` - BLE packet layout between the phone and the ESP32-S3.
- `firmware/` - ESP32-S3 peripheral. It advertises as `SmartHelmet`, accepts the cue, and pulses the motors.
- `Helmet_Navigation.kicad_sch` - editable self-contained KiCad schematic.
- `Helmet_Wiring_Overview.pdf` - 2-page overview and GPIO map.
- `BOM_and_Pin_Map.csv` - parts, values, wiring notes.
- `tools/build_helmet.py` - reproducible source generator.

## Reference material

- Espressif: https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html
- Texas Instruments SN74AHCT125: https://www.ti.com/product/SN74AHCT125
- AOS AO3400A: https://www.aosmd.com/res/data_sheets/AO3400A.pdf
- ST/Adafruit 9DoF breakout: https://learn.adafruit.com/st-9-dof-combo/lsm6dsox-lis3mdl-pinouts
- TDK INMP441: https://www.invensense.tdk.com/en-us/download-resource/ds-inmp441-00-inmp441-datasheet
- WS2812B: https://cdn-shop.adafruit.com/datasheets/WS2812B.pdf
