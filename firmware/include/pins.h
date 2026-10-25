#pragma once

/* ESP32-S3-DevKitC-1 logical GPIOs from the helmet schematic. */

#define PIN_IMU_SDA 4
#define PIN_IMU_SCL 5
#define PIN_IMU_INT1 6

/* One switch ties these pins together. Drive stays low; sense is a pull-up.
   Open reads high. Closed reads low. That closed state is the talk button. */
#define PIN_BUTTON_DRIVE 1
#define PIN_BUTTON_SENSE 2

#define PIN_LED_LEFT 10
#define PIN_LED_RIGHT 11

#define PIN_I2S_SCK 14
#define PIN_I2S_WS 15
#define PIN_I2S_SD 16

#define PIN_MOTOR_LEFT 17
#define PIN_MOTOR_FRONT 18
#define PIN_MOTOR_RIGHT 21

/* UART to the blinker Arduino. TX goes to Arduino RX, RX to Arduino TX. */
#define PIN_BLINKER_TX 12
#define PIN_BLINKER_RX 13
