#pragma once

#include "protocol.h"

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Letters from the ESP32 to the blinker Arduino. The Arduino owns the
 * flash timing. L, R, U, and O copy the cue direction. B and b are the
 * brake strip, driven by the helmet IMU, and they do not change the turn.
 * A stale cue, a dropped link, none, front, or intensity 0 is off.
 */

#define BLINKER_OFF 'O'
#define BLINKER_LEFT 'L'
#define BLINKER_RIGHT 'R'
#define BLINKER_UTURN 'U'
#define BLINKER_BRAKE 'B'
#define BLINKER_RELEASE 'b'

uint8_t blinker_command(const Cue *cue, uint32_t age_ms, bool fresh);

#ifdef __cplusplus
}
#endif
