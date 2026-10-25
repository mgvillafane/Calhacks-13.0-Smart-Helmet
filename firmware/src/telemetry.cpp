#include "telemetry.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#if defined(HELMET_WIFI_SSID) && defined(HELMET_CONVEX_URL)

#include <Arduino.h>
#include <Convex.h>
#include <WiFi.h>
#include <esp_system.h>

static const uint32_t kHealthPeriodMs = 60000;
static const char *kFirmware = __DATE__ " " __TIME__;

static bool convexStarted = false;
static bool bootSent = false;
static uint32_t lastHealthMs = 0;
static uint32_t lastCues = 0;
static uint32_t lastStaleStops = 0;
static uint32_t lastBrakes = 0;
static char deviceId[18] = "";

static const char *resetReason(void) {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON: return "power_on";
        case ESP_RST_EXT: return "external";
        case ESP_RST_SW: return "software";
        case ESP_RST_PANIC: return "panic";
        case ESP_RST_INT_WDT: return "int_watchdog";
        case ESP_RST_TASK_WDT: return "task_watchdog";
        case ESP_RST_WDT: return "watchdog";
        case ESP_RST_DEEPSLEEP: return "deep_sleep";
        case ESP_RST_BROWNOUT: return "brownout";
        case ESP_RST_SDIO: return "sdio";
        case ESP_RST_USB: return "usb";
        case ESP_RST_JTAG: return "jtag";
        default: return "unknown";
    }
}

static void fillCommon(JsonDocument &doc, const char *kind, uint32_t now_ms) {
    doc["device"] = deviceId;
    doc["kind"] = kind;
    doc["fw"] = kFirmware;
    doc["uptimeS"] = now_ms / 1000;
}

void telemetry_begin(void) {
    uint64_t mac = ESP.getEfuseMac();
    snprintf(deviceId, sizeof(deviceId), "%02x:%02x:%02x:%02x:%02x:%02x",
             (unsigned)(mac & 0xff), (unsigned)((mac >> 8) & 0xff), (unsigned)((mac >> 16) & 0xff),
             (unsigned)((mac >> 24) & 0xff), (unsigned)((mac >> 32) & 0xff), (unsigned)((mac >> 40) & 0xff));
    WiFi.mode(WIFI_STA);
#ifdef HELMET_WIFI_PASS
    WiFi.begin(HELMET_WIFI_SSID, HELMET_WIFI_PASS);
#else
    WiFi.begin(HELMET_WIFI_SSID);
#endif
    Serial.println("Telemetry: joining Wi-Fi");
}

void telemetry_loop(uint32_t now_ms, const HelmetStats *stats) {
    if (!convexStarted) {
        if (WiFi.status() != WL_CONNECTED) {
            return;
        }
        convexStarted = convexBegin(HELMET_CONVEX_URL);
        Serial.println(convexStarted ? "Telemetry: Convex starting" : "Telemetry: Convex failed to start");
        return;
    }
    if (!convexConnected()) {
        return;
    }
    if (!bootSent) {
        JsonDocument doc;
        fillCommon(doc, "boot", now_ms);
        doc["resetReason"] = resetReason();
        doc["freeHeap"] = ESP.getFreeHeap();
        doc["imuOk"] = stats->imu_ok;
        doc["micOk"] = stats->mic_ok;
        bootSent = convexMutation("helmet:report", doc, nullptr, nullptr) >= 0;
        lastHealthMs = now_ms;
        return;
    }
    if (now_ms - lastHealthMs < kHealthPeriodMs) {
        return;
    }
    JsonDocument doc;
    fillCommon(doc, "health", now_ms);
    doc["freeHeap"] = ESP.getFreeHeap();
    doc["minFreeHeap"] = ESP.getMinFreeHeap();
    doc["rssi"] = WiFi.RSSI();
    doc["bleConnected"] = stats->ble_connected;
    doc["imuOk"] = stats->imu_ok;
    doc["micOk"] = stats->mic_ok;
    doc["cues"] = stats->cues - lastCues;
    doc["staleStops"] = stats->stale_stops - lastStaleStops;
    doc["brakes"] = stats->brakes - lastBrakes;
    if (convexMutation("helmet:report", doc, nullptr, nullptr) >= 0) {
        lastCues = stats->cues;
        lastStaleStops = stats->stale_stops;
        lastBrakes = stats->brakes;
    }
    lastHealthMs = now_ms;
}

void telemetry_brake(uint32_t duration_ms, float peak_g) {
    if (!convexStarted || !convexConnected()) {
        return;
    }
    JsonDocument doc;
    fillCommon(doc, "brake", millis());
    doc["brakeMs"] = duration_ms;
    doc["peakG"] = roundf(peak_g * 100.0f) / 100.0f;
    convexMutation("helmet:report", doc, nullptr, nullptr);
}

#else

void telemetry_begin(void) {}
void telemetry_loop(uint32_t now_ms, const HelmetStats *stats) {
    (void)now_ms;
    (void)stats;
}
void telemetry_brake(uint32_t duration_ms, float peak_g) {
    (void)duration_ms;
    (void)peak_g;
}

#endif
