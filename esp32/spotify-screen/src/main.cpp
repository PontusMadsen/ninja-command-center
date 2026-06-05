#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <CST816S.h>
#include "config.h"

// ---------------------------------------------------------------------------
// Touch + Buttons (T-Display S3)
// ---------------------------------------------------------------------------
#define TOUCH_SDA  18
#define TOUCH_SCL  17
#define TOUCH_INT  16
#define TOUCH_RST  21
#define TFT_BL_PIN 38

CST816S touch(TOUCH_SDA, TOUCH_SCL, TOUCH_RST, TOUCH_INT);

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
#define COL_BG        0x0000  // black
#define COL_PRIMARY   0xFFFF  // white
#define COL_SECONDARY 0x7BEF  // grey
#define COL_ACCENT    0xFD20  // orange
#define COL_CONTROLS  0x4208  // dark grey

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
#define SCREEN_W       170
#define SCREEN_H       320
#define ART_SIZE       150
#define ART_X          ((SCREEN_W - ART_SIZE) / 2)
#define ART_Y          10
#define TRACK_Y        170
#define ARTIST_Y       196
#define BAR_Y          225
#define BAR_H          6
#define BAR_X          15
#define BAR_W          (SCREEN_W - 30)
#define TIME_Y         236

// ---------------------------------------------------------------------------
// NowPlaying data
// ---------------------------------------------------------------------------
struct NowPlaying {
    bool     playing      = false;
    String   track        = "";
    String   artist       = "";
    String   album        = "";
    String   albumArtUrl  = "";
    String   albumArtSmall = "";
    uint32_t progressMs   = 0;
    uint32_t durationMs   = 0;
    String   trackId      = "";
};

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
TFT_eSPI tft = TFT_eSPI();
NowPlaying current;
NowPlaying previous;
unsigned long lastPoll     = 0;
unsigned long lastTouch    = 0;
bool         firstDraw     = true;

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
void connectWiFi();
void showBootScreen();
void pollNowPlaying();
void drawNowPlaying();
void drawNoMusic();
void drawAlbumArt();
void drawTrackInfo();
void drawProgressBar();
void handleTouch();
void sendControl(const char* action);
String truncate(const String& str, int maxLen);
String formatTime(uint32_t ms);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    delay(100);

    // Init buttons
    pinMode(0, INPUT_PULLUP);
    pinMode(14, INPUT_PULLUP);

    // Init touch
    Wire.begin(TOUCH_SDA, TOUCH_SCL);
    touch.begin(Wire);

    // Init backlight
    pinMode(TFT_BL_PIN, OUTPUT);
    digitalWrite(TFT_BL_PIN, HIGH);

    // Init display
    tft.init();
    tft.setRotation(2);
    tft.fillScreen(COL_BG);
    tft.setTextDatum(MC_DATUM);

    showBootScreen();
    delay(1500);

    connectWiFi();

    tft.fillScreen(COL_BG);
    firstDraw = true;
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
void loop() {
    unsigned long now = millis();

    if (now - lastPoll >= (unsigned long)POLL_MS) {
        lastPoll = now;
        pollNowPlaying();

        // Only redraw when data changed or first time
        bool changed = firstDraw
            || (current.playing != previous.playing)
            || (current.trackId != previous.trackId)
            || (current.progressMs / 1000 != previous.progressMs / 1000);

        if (changed) {
            if (current.track.length() > 0 || current.playing) {
                drawNowPlaying();
            } else {
                drawNoMusic();
            }
            previous = current;
            firstDraw = false;
        }
    }

    handleTouch();
    delay(50);
}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------
void connectWiFi() {
    tft.fillScreen(COL_BG);
    tft.setTextColor(COL_PRIMARY, COL_BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("Connecting WiFi...", SCREEN_W / 2, SCREEN_H / 2, 2);

    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
        tft.fillScreen(COL_BG);
        tft.drawString("WiFi OK", SCREEN_W / 2, SCREEN_H / 2 - 10, 2);
        tft.drawString(WiFi.localIP().toString(), SCREEN_W / 2, SCREEN_H / 2 + 10, 2);
        delay(1000);
    } else {
        Serial.println("\nWiFi FAILED");
        tft.fillScreen(COL_BG);
        tft.setTextColor(COL_ACCENT, COL_BG);
        tft.drawString("WiFi FAILED", SCREEN_W / 2, SCREEN_H / 2, 2);
        delay(2000);
    }
}

// ---------------------------------------------------------------------------
// Boot screen
// ---------------------------------------------------------------------------
void showBootScreen() {
    tft.fillScreen(COL_BG);
    tft.setTextColor(COL_ACCENT, COL_BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("NINJA HUB", SCREEN_W / 2, SCREEN_H / 2 - 20, 4);
    tft.setTextColor(COL_SECONDARY, COL_BG);
    tft.drawString("Spotify", SCREEN_W / 2, SCREEN_H / 2 + 15, 2);
}

// ---------------------------------------------------------------------------
// Poll now-playing from hub
// ---------------------------------------------------------------------------
void pollNowPlaying() {
    if (WiFi.status() != WL_CONNECTED) return;

    HTTPClient http;
    String url = String(HUB_HOST) + "/api/spotify/now-playing";
    http.begin(url);
    http.setTimeout(2000);
    int code = http.GET();

    if (code == 200) {
        String payload = http.getString();
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, payload);

        if (!err) {
            current.playing       = doc["playing"] | false;
            current.track         = doc["track"].as<String>();
            current.artist        = doc["artist"].as<String>();
            current.album         = doc["album"].as<String>();
            current.albumArtUrl   = doc["albumArtUrl"].as<String>();
            current.albumArtSmall = doc["albumArtSmall"].as<String>();
            current.progressMs    = doc["progressMs"] | (uint32_t)0;
            current.durationMs    = doc["durationMs"] | (uint32_t)0;
            current.trackId       = doc["trackId"].as<String>();
        }
    } else {
        Serial.printf("HTTP GET failed: %d\n", code);
    }

    http.end();
}

// ---------------------------------------------------------------------------
// Draw: full now-playing screen
// ---------------------------------------------------------------------------
void drawNowPlaying() {
    // Only clear if track changed or first draw
    if (firstDraw || current.trackId != previous.trackId) {
        tft.fillScreen(COL_BG);
        drawAlbumArt();
        drawTrackInfo();
    }
    drawProgressBar();
}

// ---------------------------------------------------------------------------
// Draw: no music
// ---------------------------------------------------------------------------
void drawNoMusic() {
    tft.fillScreen(COL_BG);
    tft.setTextColor(COL_SECONDARY, COL_BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("No music playing", SCREEN_W / 2, SCREEN_H / 2, 2);
}

// ---------------------------------------------------------------------------
// Draw: album art from Pi proxy (150x150 RGB565) with fallback placeholder
// ---------------------------------------------------------------------------
void drawAlbumArt() {
    if (WiFi.status() != WL_CONNECTED) goto placeholder;

    {
        HTTPClient http;
        String url = String(HUB_HOST) + "/api/spotify/albumart";
        http.begin(url);
        http.setTimeout(5000);
        int code = http.GET();

        if (code == 200) {
            int len = http.getSize();
            if (len == ART_SIZE * ART_SIZE * 2) {
                WiFiClient* stream = http.getStreamPtr();
                uint16_t lineBuf[ART_SIZE];

                for (int y = 0; y < ART_SIZE; y++) {
                    int bytesRead = 0;
                    while (bytesRead < ART_SIZE * 2) {
                        int n = stream->readBytes(
                            ((uint8_t*)lineBuf) + bytesRead,
                            ART_SIZE * 2 - bytesRead
                        );
                        if (n <= 0) break;
                        bytesRead += n;
                    }
                    tft.pushImage(ART_X, ART_Y + y, ART_SIZE, 1, lineBuf);
                }

                http.end();
                Serial.println("Album art loaded");
                return;
            }
        }
        http.end();
    }

placeholder:
    tft.fillRect(ART_X, ART_Y, ART_SIZE, ART_SIZE, COL_CONTROLS);
    tft.setTextColor(COL_SECONDARY, COL_CONTROLS);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("~", ART_X + ART_SIZE / 2, ART_Y + ART_SIZE / 2, 4);
}

// ---------------------------------------------------------------------------
// Draw: track + artist text
// ---------------------------------------------------------------------------
void drawTrackInfo() {
    // Track name
    tft.setTextColor(COL_PRIMARY, COL_BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString(truncate(current.track, 20), SCREEN_W / 2, TRACK_Y, 4);

    // Artist
    tft.setTextColor(COL_SECONDARY, COL_BG);
    tft.drawString(truncate(current.artist, 25), SCREEN_W / 2, ARTIST_Y, 2);
}

// ---------------------------------------------------------------------------
// Draw: progress bar with time labels
// ---------------------------------------------------------------------------
void drawProgressBar() {
    // Clear bar area
    tft.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H, COL_CONTROLS);

    // Fill proportional to progress
    if (current.durationMs > 0) {
        int fillW = (int)((uint64_t)current.progressMs * BAR_W / current.durationMs);
        if (fillW > BAR_W) fillW = BAR_W;
        if (fillW > 0) {
            tft.fillRect(BAR_X, BAR_Y, fillW, BAR_H, COL_ACCENT);
        }
    }

    // Time labels
    tft.setTextColor(COL_SECONDARY, COL_BG);
    tft.setTextDatum(TL_DATUM);
    tft.fillRect(BAR_X, TIME_Y, BAR_W, 14, COL_BG);
    tft.drawString(formatTime(current.progressMs), BAR_X, TIME_Y, 1);
    tft.setTextDatum(TR_DATUM);
    tft.drawString(formatTime(current.durationMs), BAR_X + BAR_W, TIME_Y, 1);
}

// ---------------------------------------------------------------------------
// Input handling — touch (swipe/tap) + physical buttons as fallback
// GPIO 0 = top button, GPIO 14 = bottom button
// ---------------------------------------------------------------------------
#define BTN_TOP    0
#define BTN_BOTTOM 14

void handleTouch() {
    unsigned long now = millis();
    if (now - lastTouch < 500) return;  // debounce

    // Try touch first
    if (touch.available()) {
        lastTouch = now;
        uint8_t gesture = touch.data.gestureID;

        if (gesture == 0x03) {
            sendControl("next");
        } else if (gesture == 0x04) {
            sendControl("prev");
        } else if (gesture == 0x01 || gesture == 0x00) {
            sendControl(current.playing ? "pause" : "play");
        }
        return;
    }

    // Fallback to physical buttons
    if (digitalRead(BTN_TOP) == LOW) {
        lastTouch = now;
        sendControl("next");
    } else if (digitalRead(BTN_BOTTOM) == LOW) {
        lastTouch = now;
        sendControl(current.playing ? "pause" : "play");
    }
}

// ---------------------------------------------------------------------------
// Send control action to hub
// ---------------------------------------------------------------------------
void sendControl(const char* action) {
    if (WiFi.status() != WL_CONNECTED) return;

    HTTPClient http;
    String url = String(HUB_HOST) + "/api/spotify/control";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(2000);

    String body = "{\"action\":\"" + String(action) + "\"}";
    int code = http.POST(body);

    Serial.printf("Control %s -> %d\n", action, code);
    http.end();

    // Immediate poll after control action
    delay(300);
    pollNowPlaying();
    drawNowPlaying();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String truncate(const String& str, int maxLen) {
    if ((int)str.length() <= maxLen) return str;
    return str.substring(0, maxLen - 1) + ".";
}

String formatTime(uint32_t ms) {
    uint32_t totalSec = ms / 1000;
    uint32_t min = totalSec / 60;
    uint32_t sec = totalSec % 60;
    char buf[8];
    snprintf(buf, sizeof(buf), "%u:%02u", min, sec);
    return String(buf);
}
