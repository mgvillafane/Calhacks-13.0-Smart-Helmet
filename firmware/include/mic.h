#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* INMP441 slots are 32 bits with the 24-bit sample left-justified.
 * mic_pcm16 removes the DC offset with a one-pole high-pass (about 10 Hz at
 * 16 kHz) and scales to int16. A plain 24-to-16-bit shift is 8; 5 gives 8x,
 * which puts speech a few centimeters from the mic near -15 dBFS.
 */

#define MIC_SHIFT 5

typedef struct {
    int32_t last_in;
    int32_t last_out;
    bool started;
} MicFilter;

int16_t mic_pcm16(MicFilter *filter, int32_t slot);
int32_t mic_louder_slot(int32_t left, int32_t right);

/* A press toggles helmet-mic streaming. Letting go leaves it unchanged. */
bool talk_streaming(bool streaming, bool was_closed, bool closed);

#ifdef __cplusplus
}
#endif
