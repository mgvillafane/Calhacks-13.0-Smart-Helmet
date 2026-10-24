#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Wire.h>

#include "actuators.h"
#include "heading.h"
#include "pins.h"
#include "protocol.h"

#include <string.h>

static const int kMotorPwmChannelLeft = 0;
static const int kMotorPwmChannelFront = 1;
static const int kMotorPwmChannelRight = 2;
static const int kNotifyPeriodMs = 200;
static const int kImuPeriodMs = 20;
static const uint8_t kMpuPwrMgmt1 = 0x6B;
static const uint8_t kMpuAccelOut = 0x3B;
static uint8_t mpuAddress = 0x68;
static bool mpuReady = false;

static bool mpuWrite(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(mpuAddress);
    Wire.write(reg);
    Wire.write(value);
    return Wire.endTransmission() == 0;
}

static bool mpuRead(float *ax, float *ay, float *az, float *gx, float *gy, float *gz) {
    Wire.beginTransmission(mpuAddress);
    Wire.write(kMpuAccelOut);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    if (Wire.requestFrom(mpuAddress, (uint8_t)14) != 14) {
        return false;
    }
    int16_t raw[7];
    for (int index = 0; index < 7; index += 1) {
        raw[index] = (int16_t)((Wire.read() << 8) | Wire.read());
    }
    *ax = raw[0] / 16384.0f;
    *ay = raw[1] / 16384.0f;
    *az = raw[2] / 16384.0f;
    *gx = raw[4] / 131.0f;
    *gy = raw[5] / 131.0f;
    *gz = raw[6] / 131.0f;
    return true;
}

static bool startMpu(void) {
    Wire.begin(PIN_IMU_SDA, PIN_IMU_SCL);
    Wire.setClock(400000);
    for (uint8_t address = 0x68; address <= 0x69; address += 1) {
        mpuAddress = address;
        if (mpuWrite(kMpuPwrMgmt1, 0x00)) {
            return true;
        }
    }
    return false;
}

static BLECharacteristic *helmetStateCharacteristic = nullptr;
static Cue activeCue = {DIRECTION_NONE, 0, 0, 0, 0};
static uint32_t cueReceivedMs = 0;
static bool cueFresh = false;
static bool clientConnected = false;

static uint8_t readButtons(void) {
    uint8_t buttons = 0;
    if (digitalRead(PIN_BUTTON_MODE) == LOW) {
        buttons |= BUTTON_MODE;
    }
    if (digitalRead(PIN_BUTTON_SOS) == LOW) {
        buttons |= BUTTON_SOS;
    }
    return buttons;
}

static void writeMotor(int pin, int channel, uint8_t intensity) {
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    (void)channel;
    ledcWrite(pin, intensity);
#else
    (void)pin;
    ledcWrite(channel, intensity);
#endif
}

// static Rgb lastLeftLeds[LED_PIXELS];
static Rgb lastRightLeds[LED_PIXELS];
static bool ledCacheReady = false;
// GPIO 10 debug: the WS2812 bitstream is too fast to see. The pin is a plain level below.
// static Adafruit_NeoPixel leftStrip(LED_PIXELS, PIN_LED_LEFT, NEO_GRB + NEO_KHZ800);
static Adafruit_NeoPixel rightStrip(LED_PIXELS, PIN_LED_RIGHT, NEO_GRB + NEO_KHZ800);

static void writeMotors(const ActuatorFrame *frame) {
    writeMotor(PIN_MOTOR_LEFT, kMotorPwmChannelLeft, frame->motor_left);
    writeMotor(PIN_MOTOR_FRONT, kMotorPwmChannelFront, frame->motor_front);
    writeMotor(PIN_MOTOR_RIGHT, kMotorPwmChannelRight, frame->motor_right);
}

static void showStrip(Adafruit_NeoPixel *strip, const Rgb *pixels, Rgb *cache) {
    if (ledCacheReady && memcmp(cache, pixels, sizeof(Rgb) * LED_PIXELS) == 0) {
        return;
    }
    for (int index = 0; index < LED_PIXELS; index += 1) {
        strip->setPixelColor(index, pixels[index].r, pixels[index].g, pixels[index].b);
        cache[index] = pixels[index];
    }
    strip->show();
}

static bool leftTurnLevel(uint32_t now) {
    uint32_t age = cueFresh ? now - cueReceivedMs : 0;
    if (!cueFresh || age > CUE_STALE_MS || activeCue.intensity == 0) {
        return false;
    }
    return activeCue.direction == DIRECTION_LEFT || activeCue.direction == DIRECTION_UTURN;
}

static void applyCue(uint32_t now) {
    ActuatorFrame frame;
    uint32_t age = cueFresh ? now - cueReceivedMs : 0;
    if (actuator_frame(&activeCue, age, cueFresh, &frame) != 0) {
        memset(&frame, 0, sizeof(frame));
    }
    writeMotors(&frame);
    // showStrip(&leftStrip, frame.led_left, lastLeftLeds);
    digitalWrite(PIN_LED_LEFT, leftTurnLevel(now) ? HIGH : LOW);
    showStrip(&rightStrip, frame.led_right, lastRightLeds);
    ledCacheReady = true;
}

static void notifyHelmetState(void) {
    ImuSample sample;
    uint16_t decidegrees = 0;
    HelmetState state;
    uint8_t packet[HELMET_STATE_PACKET_LEN];
    memset(&sample, 0, sizeof(sample));
    helmet_state_from_heading(heading_decidegrees(&sample, &decidegrees), decidegrees, readButtons(), &state);
    if (encode_helmet_state(&state, packet) != 0 || helmetStateCharacteristic == nullptr) {
        return;
    }
    helmetStateCharacteristic->setValue(packet, HELMET_STATE_PACKET_LEN);
    if (clientConnected) {
        helmetStateCharacteristic->notify();
    }
}

class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer *server) override {
        (void)server;
        clientConnected = true;
    }

    void onDisconnect(BLEServer *server) override {
        clientConnected = false;
        cueFresh = false;
        applyCue(millis());
        server->startAdvertising();
    }
};

class CueCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *characteristic) override {
        auto value = characteristic->getValue();
        Cue cue;
        if (decode_cue(reinterpret_cast<const uint8_t *>(value.c_str()), value.length(), &cue) != 0) {
            return;
        }
        activeCue = cue;
        cueReceivedMs = millis();
        cueFresh = true;
    }
};

void setup(void) {
    Serial.begin(115200);

    pinMode(PIN_BUTTON_MODE, INPUT_PULLUP);
    pinMode(PIN_BUTTON_SOS, INPUT_PULLUP);

#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    ledcAttach(PIN_MOTOR_LEFT, 5000, 8);
    ledcAttach(PIN_MOTOR_FRONT, 5000, 8);
    ledcAttach(PIN_MOTOR_RIGHT, 5000, 8);
#else
    ledcSetup(kMotorPwmChannelLeft, 5000, 8);
    ledcSetup(kMotorPwmChannelFront, 5000, 8);
    ledcSetup(kMotorPwmChannelRight, 5000, 8);
    ledcAttachPin(PIN_MOTOR_LEFT, kMotorPwmChannelLeft);
    ledcAttachPin(PIN_MOTOR_FRONT, kMotorPwmChannelFront);
    ledcAttachPin(PIN_MOTOR_RIGHT, kMotorPwmChannelRight);
#endif
    // leftStrip.begin();
    pinMode(PIN_LED_LEFT, OUTPUT);
    digitalWrite(PIN_LED_LEFT, LOW);
    rightStrip.begin();
    applyCue(millis());
    mpuReady = startMpu();
    Serial.println(mpuReady ? "MPU6050 ready" : "MPU6050 missing");

    BLEDevice::init(DEVICE_NAME);
    BLEServer *server = BLEDevice::createServer();
    server->setCallbacks(new ServerCallbacks());

    BLEService *service = server->createService(SERVICE_UUID);
    BLECharacteristic *cueCharacteristic = service->createCharacteristic(
        CUE_CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
    );
    cueCharacteristic->setCallbacks(new CueCallbacks());

    helmetStateCharacteristic = service->createCharacteristic(
        HELMET_STATE_CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
    );
    helmetStateCharacteristic->addDescriptor(new BLE2902());

    service->start();
    BLEAdvertising *advertising = BLEDevice::getAdvertising();
    advertising->addServiceUUID(SERVICE_UUID);
    advertising->setScanResponse(true);
    BLEDevice::startAdvertising();
    Serial.println("SmartHelmet advertising");
}

void loop(void) {
    static uint32_t lastNotifyMs = 0;
    static uint32_t lastImuMs = 0;
    uint32_t now = millis();
    applyCue(now);
    if (mpuReady && now - lastImuMs >= kImuPeriodMs) {
        float ax;
        float ay;
        float az;
        float gx;
        float gy;
        float gz;
        if (mpuRead(&ax, &ay, &az, &gx, &gy, &gz)) {
            Serial.printf("imu,%lu,%.4f,%.4f,%.4f,%.2f,%.2f,%.2f\n", now, ax, ay, az, gx, gy, gz);
        }
        lastImuMs = now;
    }
    if (now - lastNotifyMs >= kNotifyPeriodMs) {
        notifyHelmetState();
        lastNotifyMs = now;
    }
}
