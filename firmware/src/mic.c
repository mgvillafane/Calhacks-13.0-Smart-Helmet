#include "mic.h"

#include <stddef.h>

int16_t mic_pcm16(MicFilter *filter, int32_t slot) {
    int32_t in = slot >> 8;
    int32_t out;
    if (filter == NULL) {
        return 0;
    }
    if (!filter->started) {
        filter->last_in = in;
        filter->last_out = 0;
        filter->started = true;
    }
    out = in - filter->last_in + (int32_t)(((int64_t)filter->last_out * 255) / 256);
    filter->last_in = in;
    filter->last_out = out;
    out >>= MIC_SHIFT;
    if (out > 32767) {
        return 32767;
    }
    if (out < -32768) {
        return -32768;
    }
    return (int16_t)out;
}
