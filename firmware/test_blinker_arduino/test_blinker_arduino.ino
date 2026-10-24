#include <Adafruit_NeoPixel.h>

// ESP32 GPIO 12 TX -> Arduino RX (pin 0)
// ESP32 GPIO 13 RX -> Arduino TX (pin 1)
// Share ground. Letters at 115200: L left, R right, U u-turn, O turn off.
// B holds the brake strip on and b releases it. A turn can stay lit while braking.
// Any letter older than the timeout turns every strip off.

#define LEFT_PIN  6
#define RIGHT_PIN 7
#define BRAKE_PIN 8

#define NUM_LEDS 5  // LEDs per strip
#define BLINK_MS 400
#define COMMAND_TIMEOUT_MS 600

Adafruit_NeoPixel leftStrip(NUM_LEDS, LEFT_PIN, NEO_GRB + NEO_KHZ800);
Adafruit_NeoPixel rightStrip(NUM_LEDS, RIGHT_PIN, NEO_GRB + NEO_KHZ800);
Adafruit_NeoPixel brakeStrip(NUM_LEDS, BRAKE_PIN, NEO_GRB + NEO_KHZ800);

char turn = 'O';
bool brakeOn = false;
unsigned long commandMs = 0;
bool blinkOn = true;
unsigned long blinkMs = 0;

void setColor(Adafruit_NeoPixel &strip, int r, int g, int b) {
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
}

void showCommand(char active, bool on, bool brake) {
  setColor(leftStrip, 0, 0, 0);
  setColor(rightStrip, 0, 0, 0);
  setColor(brakeStrip, 0, 0, 0);
  if ((active == 'L' || active == 'U') && on) {
    setColor(leftStrip, 255, 150, 0);
  } else if (active == 'R' && on) {
    setColor(rightStrip, 255, 150, 0);
  }
  if (brake) {
    setColor(brakeStrip, 255, 0, 0);
  }
}

void setup() {
  Serial.begin(115200);

  leftStrip.begin();
  rightStrip.begin();
  brakeStrip.begin();

  leftStrip.setBrightness(80);
  rightStrip.setBrightness(80);
  brakeStrip.setBrightness(80);

  showCommand('O', false, false);
}

void loop() {
  while (Serial.available() > 0) {
    char next = (char)Serial.read();
    if (next == '\n' || next == '\r') {
      continue;
    }
    if (next == 'L' || next == 'R' || next == 'U' || next == 'O') {
      if (next != turn) {
        blinkOn = true;
        blinkMs = millis();
      }
      turn = next;
      commandMs = millis();
    } else if (next == 'B' || next == 'b') {
      brakeOn = next == 'B';
      commandMs = millis();
    }
  }

  if (millis() - commandMs > COMMAND_TIMEOUT_MS) {
    turn = 'O';
    brakeOn = false;
  }

  bool on = true;
  if (turn == 'L' || turn == 'U' || turn == 'R') {
    if (millis() - blinkMs >= BLINK_MS) {
      blinkOn = !blinkOn;
      blinkMs = millis();
    }
    on = blinkOn;
  }

  static char shown = 0;
  static bool shownOn = false;
  static bool shownBrake = false;
  if (turn != shown || on != shownOn || brakeOn != shownBrake) {
    showCommand(turn, on, brakeOn);
    shown = turn;
    shownOn = on;
    shownBrake = brakeOn;
  }
}
