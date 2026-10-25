#pragma once

#include <stdbool.h>
#include <stdint.h>

/* Optional Wi-Fi uplink to Convex. It is compiled in only when
 * firmware/include/secrets.h exists (copy secrets.example.h). Without it every
 * call is a no-op and the helmet runs on BLE alone. Nothing here may block the
 * loop: Wi-Fi and the Convex socket connect in the background, and reports are
 * dropped while offline.
 */

typedef struct {
    bool ble_connected;
    bool imu_ok;
    bool mic_ok;
    uint32_t cues;
    uint32_t stale_stops;
    uint32_t brakes;
} HelmetStats;

void telemetry_begin(void);
void telemetry_loop(uint32_t now_ms, const HelmetStats *stats);
void telemetry_brake(uint32_t duration_ms, float peak_g);
