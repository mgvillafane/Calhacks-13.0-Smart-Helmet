#include "heading.h"

#include <math.h>

int heading_decidegrees(const ImuSample *sample, uint16_t *decidegrees) {
    double ax;
    double ay;
    double az;
    double mx;
    double my;
    double mz;
    double roll;
    double pitch;
    double north;
    double east;
    double degrees;
    long rounded;

    if (sample == NULL || decidegrees == NULL || !sample->accel_ok || !sample->mag_ok) {
        return -1;
    }
    ax = sample->ax;
    ay = sample->ay;
    az = sample->az;
    mx = sample->mx;
    my = sample->my;
    mz = sample->mz;
    if (sqrt(ax * ax + ay * ay + az * az) < 0.2) {
        return -1;
    }

    roll = atan2(ay, az);
    pitch = atan2(-ax, sqrt(ay * ay + az * az));
    north = mx * cos(pitch) + mz * sin(pitch);
    east = mx * sin(roll) * sin(pitch) + my * cos(roll) - mz * sin(roll) * cos(pitch);
    if (sqrt(north * north + east * east) < 1e-3) {
        return -1;
    }

    degrees = atan2(east, north) * (180.0 / acos(-1.0));
    if (degrees < 0.0) {
        degrees += 360.0;
    }
    rounded = lround(degrees * 10.0) % 3600;
    if (rounded < 0) {
        rounded += 3600;
    }
    *decidegrees = (uint16_t)rounded;
    return 0;
}

void helmet_state_from_heading(int heading_status, uint16_t decidegrees, uint8_t buttons, HelmetState *out) {
    if (out == NULL) {
        return;
    }
    out->buttons = buttons & (BUTTON_MODE | BUTTON_SOS);
    if (heading_status == 0 && decidegrees <= 3599) {
        out->heading_decidegrees = decidegrees;
        out->heading_valid = true;
        return;
    }
    out->heading_decidegrees = HEADING_INVALID;
    out->heading_valid = false;
}
