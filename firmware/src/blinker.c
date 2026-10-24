#include "blinker.h"

uint8_t blinker_command(const Cue *cue, uint32_t age_ms, bool fresh) {
    if (cue == NULL || !fresh || age_ms > CUE_STALE_MS || cue->intensity == 0) {
        return BLINKER_OFF;
    }
    if (cue->direction == DIRECTION_LEFT) {
        return BLINKER_LEFT;
    }
    if (cue->direction == DIRECTION_RIGHT) {
        return BLINKER_RIGHT;
    }
    if (cue->direction == DIRECTION_UTURN) {
        return BLINKER_UTURN;
    }
    return BLINKER_OFF;
}
