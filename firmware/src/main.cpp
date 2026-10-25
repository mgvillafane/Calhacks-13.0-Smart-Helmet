#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <BLE2902.h>
#include <ESP_I2S.h>
#include <driver/i2s_std.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Wire.h>

#include "actuators.h"
#include "blinker.h"
#include "brake.h"
#include "heading.h"
#include "mic.h"
#include "pins.h"
#include "protocol.h"
#include "telemetry.h"

#include <math.h>
#include <string.h>

static const int kMotorPwmChannelLeft = 0;
static const int kMotorPwmChannelFront = 1;
static const int kMotorPwmChannelRight = 2;
static const int kNotifyPeriodMs = 200;
static const int kSensorPeriodMs = 100;
static const int kImuPeriodMs = 20;
static const uint32_t kTalkDebounceMs = 30;
static const uint16_t kBleMtu = 247;
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

static I2SClass microphone;
static bool micReady = false;

static bool startMicrophone(void) {
    microphone.setPins(PIN_I2S_SCK, PIN_I2S_WS, -1, PIN_I2S_SD);
    return microphone.begin(I2S_MODE_STD, 16000, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO);
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
static BLECharacteristic *sensorCharacteristic = nullptr;
static BLECharacteristic *audioCharacteristic = nullptr;
static SensorSample latestSensors = {};
static volatile int32_t micPeak = 0;
static volatile bool talkClosed = false;
static Cue activeCue = {DIRECTION_NONE, 0, 0, 0, 0};
static uint32_t cueReceivedMs = 0;
static bool cueFresh = false;
static bool clientConnected = false;
static volatile uint32_t cuesReceived = 0;
static uint32_t staleStops = 0;
static uint32_t brakeCount = 0;

static uint8_t readButtons(void) {
    uint8_t buttons = 0;
    if (digitalRead(PIN_BUTTON_MODE) == LOW) {
        buttons |= BUTTON_MODE;
    }
    if (digitalRead(PIN_BUTTON_SOS) == LOW) {
        buttons |= BUTTON_SOS;
    }
    if (talkClosed) {
        buttons |= BUTTON_TALK;
    }
    return buttons;
}

static void writeMotor(int pin, int channel, uint8_t intensity) {
    // GPIO 18 is the DevKit UART1 RX function. LEDC never took that pin, so the
    // front gate stayed quiet while left and right PWM still ran. A plain level
    // turns the MOSFET fully on for the cue's on-phase.
    if (pin == PIN_MOTOR_FRONT) {
        static int8_t driven = -1;
        int8_t level = intensity == 0 ? 0 : 1;
        (void)channel;
        if (driven == level) {
            return;
        }
        pinMode(PIN_MOTOR_FRONT, OUTPUT);
        digitalWrite(PIN_MOTOR_FRONT, level == 0 ? LOW : HIGH);
        driven = level;
        return;
    }
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

static void sendBlinker(uint32_t now, bool braking) {
    static uint8_t lastTurn = 0;
    static uint8_t lastBrake = 0;
    static uint32_t lastSentMs = 0;
    uint32_t age = cueFresh ? now - cueReceivedMs : 0;
    uint8_t turn = blinker_command(&activeCue, age, cueFresh);
    uint8_t brake = braking ? BLINKER_BRAKE : BLINKER_RELEASE;
    if (turn == lastTurn && brake == lastBrake && now - lastSentMs < kNotifyPeriodMs) {
        return;
    }
    Serial1.write(turn);
    Serial1.write(brake);
    lastTurn = turn;
    lastBrake = brake;
    lastSentMs = now;
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

static int16_t clampI16(int value) {
    if (value > 32767) {
        return 32767;
    }
    if (value < -32768) {
        return -32768;
    }
    return (int16_t)value;
}

static void rememberImu(float ax, float ay, float az, float gx, float gy, float gz) {
    latestSensors.imu_ok = true;
    latestSensors.ax_mg = clampI16((int)lroundf(ax * 1000.0f));
    latestSensors.ay_mg = clampI16((int)lroundf(ay * 1000.0f));
    latestSensors.az_mg = clampI16((int)lroundf(az * 1000.0f));
    latestSensors.gx_dps10 = clampI16((int)lroundf(gx * 10.0f));
    latestSensors.gy_dps10 = clampI16((int)lroundf(gy * 10.0f));
    latestSensors.gz_dps10 = clampI16((int)lroundf(gz * 10.0f));
}

static void notifySensors(void) {
    uint8_t packet[SENSOR_PACKET_LEN];
    latestSensors.mic_ok = micReady;
    latestSensors.mic_peak = clampI16((int)micPeak);
    micPeak = 0;
    if (encode_sensor_sample(&latestSensors, packet) != 0 || sensorCharacteristic == nullptr) {
        return;
    }
    sensorCharacteristic->setValue(packet, SENSOR_PACKET_LEN);
    if (clientConnected) {
        sensorCharacteristic->notify();
    }
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

// Runs in its own task so a slow loop pass (Wi-Fi telemetry, NeoPixels) cannot
// overflow the I2S DMA buffers mid-sentence. INMP441 with L/R grounded fills
// the left (even) slot of each stereo frame.
static void streamMicrophone(void *unused) {
    static int32_t slots[512];
    int16_t pending[AUDIO_MAX_SAMPLES];
    uint8_t packet[AUDIO_PACKET_MAX_LEN];
    size_t pendingCount = 0;
    uint8_t sequence = 0;
    MicFilter filter = {};
    (void)unused;
    for (;;) {
        size_t bytes = 0;
        i2s_channel_read(microphone.rxChan(), slots, sizeof(slots), &bytes, pdMS_TO_TICKS(100));
        bool streaming = talkClosed && clientConnected && audioCharacteristic != nullptr;
        size_t count = bytes / sizeof(int32_t);
        for (size_t index = 0; index + 1 < count; index += 2) {
            int16_t sample = mic_pcm16(&filter, slots[index]);
            int32_t level = sample < 0 ? -(int32_t)sample : sample;
            if (level > micPeak) {
                micPeak = level;
            }
            if (!streaming) {
                continue;
            }
            pending[pendingCount] = sample;
            pendingCount += 1;
            if (pendingCount == AUDIO_MAX_SAMPLES) {
                int length = encode_audio_packet(sequence, pending, pendingCount, packet);
                if (length > 0) {
                    audioCharacteristic->setValue(packet, (size_t)length);
                    audioCharacteristic->notify();
                }
                sequence += 1;
                pendingCount = 0;
            }
        }
        if (!streaming) {
            pendingCount = 0;
        }
    }
}

static void updateTalkSwitch(uint32_t now) {
    static bool reading = false;
    static uint32_t changedMs = 0;
    bool closed = digitalRead(PIN_TALK_SWITCH) == LOW;
    if (closed != reading) {
        reading = closed;
        changedMs = now;
    }
    if (reading != talkClosed && now - changedMs >= kTalkDebounceMs) {
        talkClosed = reading;
        notifyHelmetState();
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
        cuesReceived = cuesReceived + 1;
    }
};

void setup(void) {
    Serial.begin(115200);
    // With USB plugged in and no reader, a blocking print stalls the loop and the blinker UART.
    Serial.setTxTimeoutMs(0);
    Serial1.begin(115200, SERIAL_8N1, PIN_BLINKER_RX, PIN_BLINKER_TX);

    pinMode(PIN_BUTTON_MODE, INPUT_PULLUP);
    pinMode(PIN_BUTTON_SOS, INPUT_PULLUP);
    pinMode(PIN_TALK_SWITCH, INPUT_PULLUP);
    pinMode(PIN_MOTOR_FRONT, OUTPUT);
    digitalWrite(PIN_MOTOR_FRONT, LOW);

#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    ledcAttach(PIN_MOTOR_LEFT, 5000, 8);
    ledcAttach(PIN_MOTOR_RIGHT, 5000, 8);
#else
    ledcSetup(kMotorPwmChannelLeft, 5000, 8);
    ledcSetup(kMotorPwmChannelRight, 5000, 8);
    ledcAttachPin(PIN_MOTOR_LEFT, kMotorPwmChannelLeft);
    ledcAttachPin(PIN_MOTOR_RIGHT, kMotorPwmChannelRight);
#endif
    // leftStrip.begin();
    pinMode(PIN_LED_LEFT, OUTPUT);
    digitalWrite(PIN_LED_LEFT, LOW);
    rightStrip.begin();
    applyCue(millis());
    mpuReady = startMpu();
    Serial.println(mpuReady ? "MPU6050 ready" : "MPU6050 missing");
    micReady = startMicrophone();
    Serial.println(micReady ? "INMP441 ready" : "INMP441 missing");

    BLEDevice::init(DEVICE_NAME);
    BLEDevice::setMTU(kBleMtu);
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

    sensorCharacteristic = service->createCharacteristic(
        SENSOR_CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
    );
    sensorCharacteristic->addDescriptor(new BLE2902());

    audioCharacteristic = service->createCharacteristic(AUDIO_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_NOTIFY);
    audioCharacteristic->addDescriptor(new BLE2902());

    service->start();
    BLEAdvertising *advertising = BLEDevice::getAdvertising();
    advertising->addServiceUUID(SERVICE_UUID);
    advertising->setScanResponse(true);
    BLEDevice::startAdvertising();
    Serial.println("SmartHelmet advertising");
    if (micReady) {
        xTaskCreatePinnedToCore(streamMicrophone, "mic", 4096, nullptr, 2, nullptr, 1);
    }
    telemetry_begin();
    pinMode(PIN_MOTOR_FRONT, OUTPUT);
    digitalWrite(PIN_MOTOR_FRONT, LOW);
}

// A turn cue that ran past CUE_STALE_MS without a refresh: the phone link dropped mid-cue.
static void countStaleStop(uint32_t now) {
    static uint32_t countedCueMs = 0;
    if (!cueFresh || activeCue.direction == DIRECTION_NONE || activeCue.intensity == 0) {
        return;
    }
    if (now - cueReceivedMs > CUE_STALE_MS && countedCueMs != cueReceivedMs) {
        countedCueMs = cueReceivedMs;
        staleStops += 1;
    }
}

void loop(void) {
    static uint32_t lastNotifyMs = 0;
    static uint32_t lastSensorMs = 0;
    static uint32_t lastImuMs = 0;
    static BrakeState brakeState = {};
    static bool braking = false;
    static uint32_t brakeStartMs = 0;
    static float brakePeakG = 0.0f;
    uint32_t now = millis();
    applyCue(now);
    countStaleStop(now);
    updateTalkSwitch(now);
    if (mpuReady && now - lastImuMs >= kImuPeriodMs) {
        float ax;
        float ay;
        float az;
        float gx;
        float gy;
        float gz;
        if (mpuRead(&ax, &ay, &az, &gx, &gy, &gz)) {
            rememberImu(ax, ay, az, gx, gy, gz);
            Serial.printf("imu,%lu,%.4f,%.4f,%.4f,%.2f,%.2f,%.2f\n", now, ax, ay, az, gx, gy, gz);
            bool wasBraking = braking;
            braking = brake_update(&brakeState, ax, ay, az, gy, now - lastImuMs) == 1;
            if (braking && !wasBraking) {
                brakeStartMs = now;
                brakePeakG = 0.0f;
            }
            if (braking && ax - brakeState.gravity_x > brakePeakG) {
                brakePeakG = ax - brakeState.gravity_x;
            }
            if (!braking && wasBraking) {
                brakeCount += 1;
                telemetry_brake(now - brakeStartMs, brakePeakG);
            }
        }
        lastImuMs = now;
    }
    sendBlinker(now, braking);
    if (now - lastSensorMs >= kSensorPeriodMs) {
        notifySensors();
        lastSensorMs = now;
    }
    if (now - lastNotifyMs >= kNotifyPeriodMs) {
        notifyHelmetState();
        lastNotifyMs = now;
    }
    HelmetStats stats = {clientConnected, mpuReady, micReady, cuesReceived, staleStops, brakeCount};
    telemetry_loop(now, &stats);
}
