# Install Smart Helmet on an Android phone from a Mac

The app uses native Bluetooth, so it cannot run in Expo Go. Plug the phone into the Mac with a USB cable, then build and install a debug app from `mobile/`. The Mac sees the phone directly. There is no extra USB driver step.

Leave the terminal open after `./deploy`. The phone loads the app from that dev server.

## One-time setup

### Phone

1. On the phone, open **Settings → About phone** and tap **Build number** seven times.
2. Open **Developer options** and turn on **USB debugging**.
3. On a Xiaomi or Redmi phone, also turn on **Install via USB**. If that switch will not stay on, turn **MIUI optimization** off at the bottom of Developer options and reboot the phone.
4. Plug the phone into the Mac, unlock it, and choose **File transfer** if a USB-mode notification appears.
5. Tap **Allow** on **Allow USB debugging?**, and check **Always allow from this computer**.

### Mac

Install these three tools:

- **Node.js 22.13 or newer.** Check with `node -v`. The download is at https://nodejs.org/en/download.
- **JDK 17 or newer.** Android Studio includes one. Otherwise install Temurin 21 from https://adoptium.net.
- **Android Studio**, from https://developer.android.com/studio. During setup, install the Android SDK.

In Android Studio, open **Settings → Languages & Frameworks → Android SDK** and install:

- Android SDK Platform 37
- Android SDK Build-Tools 37
- NDK 27.1.12297006
- CMake 3.22.1
- Android SDK Platform-Tools

Add the SDK to your shell. For zsh, put this in `~/.zshrc`, then open a new terminal:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools"
```

If `java -version` fails, point the shell at Android Studio's JDK as well:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$PATH:$JAVA_HOME/bin"
```

Confirm the phone is visible:

```bash
adb devices
```

The phone's serial number must be listed as `device`. `unauthorized` means the Allow prompt on the phone was missed. Unplug the cable, plug it back in, and accept the prompt.

### Project

```bash
git clone <repo-url>
cd calhacks/mobile
```

`android/` is generated on the first deploy. It is not in git.

## Deploy

From `mobile/`:

```bash
./deploy
```

The first run downloads Gradle and native dependencies and can take several minutes. Later runs only rebuild what changed.

When the QR code appears, press `a`. That opens **Smart Helmet** on the phone. The screen is dark navy with light text. Leave this terminal running. Closing it disconnects the app from the dev server.

Press `r` in that terminal to reload JavaScript after a code change. Run `./deploy` again when native dependencies or `app.json` change.

The phone may ask for location and nearby-devices permission. Both are required: location chooses the turn, and nearby devices is how Android 12 and newer grants Bluetooth.

## If something fails

| What you see | What to do |
| --- | --- |
| `No Android device is ready` | Unlock the phone, set USB mode to File transfer, and run `adb devices` again. |
| `unauthorized` | Unplug the cable, replug it, and tap Allow. |
| `INSTALL_FAILED_USER_RESTRICTED` | Turn on **Install via USB** in Developer options, then run `./deploy` again. |
| Black screen after pressing `a` | Stop the server with Ctrl+C and run `./deploy` again. Press `a` only in that new server. It loads the app through the USB cable, not the Mac's Wi-Fi address. |
| `Failed to resolve the Android SDK path` | `ANDROID_HOME` is unset. Add the `~/.zshrc` lines above and open a new terminal. |
| Node is outdated | Install Node 22.13 or newer and open a new terminal. |
