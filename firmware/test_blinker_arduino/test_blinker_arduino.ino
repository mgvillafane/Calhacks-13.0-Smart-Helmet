#include <Adafruit_NeoPixel.h>

#define LEFT_PIN  6
#define RIGHT_PIN 7
#define BRAKE_PIN 8

#define NUM_LEDS 5  // LEDs per strip

Adafruit_NeoPixel leftStrip(NUM_LEDS, LEFT_PIN, NEO_GRB + NEO_KHZ800);
Adafruit_NeoPixel rightStrip(NUM_LEDS, RIGHT_PIN, NEO_GRB + NEO_KHZ800);
Adafruit_NeoPixel brakeStrip(NUM_LEDS, BRAKE_PIN, NEO_GRB + NEO_KHZ800);

// Set all LEDs in a strip to one color
void setColor(Adafruit_NeoPixel &strip, int r, int g, int b) {
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
}

void setup() {
  leftStrip.begin();
  rightStrip.begin();
  brakeStrip.begin();

  leftStrip.setBrightness(80);
  rightStrip.setBrightness(80);
  brakeStrip.setBrightness(80);

  leftStrip.clear();
  rightStrip.clear();
  brakeStrip.clear();

  leftStrip.show();
  rightStrip.show();
  brakeStrip.show();
}

void loop() {

  // LEFT BLINKER - Yellow
  for (int i = 0; i < 3; i++) {
    setColor(leftStrip, 255, 150, 0);
    delay(400);
    setColor(leftStrip, 0, 0, 0);
    delay(400);
  }

  // RIGHT BLINKER - Yellow
  for (int i = 0; i < 3; i++) {
    setColor(rightStrip, 255, 150, 0);
    delay(400);
    setColor(rightStrip, 0, 0, 0);
    delay(400);
  }

  // BRAKE LIGHT - Red
  setColor(brakeStrip, 255, 0, 0);
  delay(2000);

  setColor(brakeStrip, 0, 0, 0);
  delay(500);
}
