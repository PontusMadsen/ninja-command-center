#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <U8g2lib.h>

// ---------------------------------------------------------------------------
// Config constants (to be replaced by config.h in Task 11)
// ---------------------------------------------------------------------------
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASS";
const char* HUB_HOST  = "http://ninja-hub.local:8888";
const int   POLL_MS   = 5000;

// ---------------------------------------------------------------------------
// OLED I2C pins
// ---------------------------------------------------------------------------
#define OLED_SDA 43
#define OLED_SCL 44

// ---------------------------------------------------------------------------
// TFT Colors
// ---------------------------------------------------------------------------
#define COL_BG        0x0000  // black
#define COL_WHITE     0xFFFF
#define COL_GREY      0x7BEF
#define COL_GREEN     0x07E0
#define COL_RED       0xF800
#define COL_ORANGE    0xFD20
#define COL_DARK_GREY 0x4208

// ---------------------------------------------------------------------------
// TFT Layout
// ---------------------------------------------------------------------------
#define SCREEN_W 170
#define SCREEN_H 320

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------
struct CalendarEvent {
    String title;
    String start;
    bool   allDay;
};

struct MailState {
    int    unread = 0;
    String recentSubject;
    String recentFrom;
};

struct Thought {
    String text;
    String type;
};

struct Weather {
    float  temp = 0.0;
    String description;
    String icon;
};

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
TFT_eSPI tft = TFT_eSPI();
U8G2_SSD1309_128X64_NONAME0_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

CalendarEvent events[6];
int           eventCount = 0;
MailState     mail;
Thought       thought;
Weather       weather;

int            currentView   = 0;  // 0 = calendar, 1 = mail
unsigned long  lastPoll      = 0;
unsigned long  lastTouch     = 0;
bool           firstDraw     = true;
bool           dataChanged   = true;

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
void connectWiFi();
void showBootScreen();
void fetchCalendar();
void fetchMail();
void fetchThought();
void fetchWeather();
void drawCalendarView();
void drawMailView();
void drawOLED();
void handleTouch();
String truncate(const String& str, int maxLen);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    delay(100);

    // Init TFT
    tft.init();
    tft.setRotation(0);
    tft.fillScreen(COL_BG);
    tft.setTextDatum(MC_DATUM);

    // Init OLED
    Wire.begin(OLED_SDA, OLED_SCL);
    oled.begin();
    oled.clearBuffer();
    oled.setFont(u8g2_font_helvR10_tr);
    oled.drawStr(10, 32, "Booting...");
    oled.sendBuffer();

    showBootScreen();
    delay(1500);

    connectWiFi();

    tft.fillScreen(COL_BG);
    firstDraw = true;
    dataChanged = true;
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
void loop() {
    unsigned long now = millis();

    if (now - lastPoll >= (unsigned long)POLL_MS) {
        lastPoll = now;
        dataChanged = true;

        fetchCalendar();
        fetchMail();
        fetchThought();
        fetchWeather();
    }

    if (dataChanged || firstDraw) {
        if (currentView == 0) {
            drawCalendarView();
        } else {
            drawMailView();
        }
        drawOLED();
        dataChanged = false;
        firstDraw = false;
    }

    handleTouch();
    delay(50);
}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------
void connectWiFi() {
    tft.fillScreen(COL_BG);
    tft.setTextColor(COL_WHITE, COL_BG);
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
        tft.setTextColor(COL_RED, COL_BG);
        tft.drawString("WiFi FAILED", SCREEN_W / 2, SCREEN_H / 2, 2);
        delay(2000);
    }
}

// ---------------------------------------------------------------------------
// Boot screen
// ---------------------------------------------------------------------------
void showBootScreen() {
    tft.fillScreen(COL_BG);
    tft.setTextColor(COL_GREEN, COL_BG);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("NINJA HUB", SCREEN_W / 2, SCREEN_H / 2 - 20, 4);
    tft.setTextColor(COL_GREY, COL_BG);
    tft.drawString("Info Feed", SCREEN_W / 2, SCREEN_H / 2 + 15, 2);
}

// ---------------------------------------------------------------------------
// Fetch: calendar events
// ---------------------------------------------------------------------------
void fetchCalendar() {
    if (WiFi.status() != WL_CONNECTED) return;

    HTTPClient http;
    String url = String(HUB_HOST) + "/api/calendar/events";
    http.begin(url);
    http.setTimeout(2000);
    int code = http.GET();

    if (code == 200) {
        String payload = http.getString();
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, payload);

        if (!err) {
            JsonArray arr = doc.as<JsonArray>();
            eventCount = 0;
            for (JsonObject obj : arr) {
                if (eventCount >= 6) break;
                events[eventCount].title  = obj["title"].as<String>();
                events[eventCount].start  = obj["start"].as<String>();
                events[eventCount].allDay = obj["allDay"] | false;
                eventCount++;
            }
        }
    } else {
        Serial.printf("Calendar fetch failed: %d\n", code);
    }

    http.end();
}

// ---------------------------------------------------------------------------
// Fetch: mail unread
// ---------------------------------------------------------------------------
void fetchMail() {
    if (WiFi.status() != WL_CONNECTED) return;

    HTTPClient http;
    String url = String(HUB_HOST) + "/api/mail/unread";
    http.begin(url);
    http.setTimeout(2000);
    int code = http.GET();

    if (code == 200) {
        String payload = http.getString();
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, payload);

        if (!err) {
            mail.unread        = doc["unread"] | 0;
            mail.recentSubject = doc["recentSubject"].as<String>();
            mail.recentFrom    = doc["recentFrom"].as<String>();
        }
    } else {
        Serial.printf("Mail fetch failed: %d\n", code);
    }

    http.end();
}

// ---------------------------------------------------------------------------
// Fetch: ninja thought
// ---------------------------------------------------------------------------
void fetchThought() {
    if (WiFi.status() != WL_CONNECTED) return;

    HTTPClient http;
    String url = String(HUB_HOST) + "/api/ninja/thought";
    http.begin(url);
    http.setTimeout(2000);
    int code = http.GET();

    if (code == 200) {
        String payload = http.getString();
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, payload);

        if (!err) {
            thought.text = doc["text"].as<String>();
            thought.type = doc["type"].as<String>();
        }
    } else {
        Serial.printf("Thought fetch failed: %d\n", code);
    }

    http.end();
}

// ---------------------------------------------------------------------------
// Fetch: weather
// ---------------------------------------------------------------------------
void fetchWeather() {
    if (WiFi.status() != WL_CONNECTED) return;

    HTTPClient http;
    String url = String(HUB_HOST) + "/api/weather";
    http.begin(url);
    http.setTimeout(2000);
    int code = http.GET();

    if (code == 200) {
        String payload = http.getString();
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, payload);

        if (!err) {
            weather.temp        = doc["temp"] | 0.0f;
            weather.description = doc["description"].as<String>();
            weather.icon        = doc["icon"].as<String>();
        }
    } else {
        Serial.printf("Weather fetch failed: %d\n", code);
    }

    http.end();
}

// ---------------------------------------------------------------------------
// Draw: Calendar view (TFT)
// ---------------------------------------------------------------------------
void drawCalendarView() {
    tft.fillScreen(COL_BG);

    // Header
    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(COL_GREEN, COL_BG);
    tft.drawString("CALENDAR", 8, 8, 4);

    // Mail badge (red circle with unread count, top-right)
    if (mail.unread > 0) {
        int badgeX = SCREEN_W - 22;
        int badgeY = 14;
        tft.fillCircle(badgeX, badgeY, 12, COL_RED);
        tft.setTextColor(COL_WHITE, COL_RED);
        tft.setTextDatum(MC_DATUM);
        char countBuf[8];
        snprintf(countBuf, sizeof(countBuf), "%d", mail.unread > 99 ? 99 : mail.unread);
        tft.drawString(countBuf, badgeX, badgeY, 2);
    }

    // Weather line below header
    int weatherY = 38;
    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(COL_GREY, COL_BG);
    char weatherBuf[40];
    snprintf(weatherBuf, sizeof(weatherBuf), "%.0f%s %s",
             weather.temp, "\xB0", weather.description.c_str());
    tft.drawString(truncate(String(weatherBuf), 25), 8, weatherY, 2);

    // Divider
    int divY = 56;
    tft.drawLine(8, divY, SCREEN_W - 8, divY, COL_DARK_GREY);

    // Events list
    int y = divY + 8;
    int lineH = 42;

    if (eventCount == 0) {
        tft.setTextColor(COL_GREY, COL_BG);
        tft.setTextDatum(MC_DATUM);
        tft.drawString("No events", SCREEN_W / 2, SCREEN_H / 2, 2);
    } else {
        for (int i = 0; i < eventCount && i < 6; i++) {
            // Time in orange
            tft.setTextDatum(TL_DATUM);
            tft.setTextColor(COL_ORANGE, COL_BG);
            String timeStr = events[i].allDay ? "All day" : events[i].start;
            tft.drawString(truncate(timeStr, 12), 8, y, 2);

            // Title in white
            tft.setTextColor(COL_WHITE, COL_BG);
            tft.drawString(truncate(events[i].title, 22), 8, y + 16, 2);

            // Divider between events
            if (i < eventCount - 1) {
                tft.drawLine(8, y + lineH - 4, SCREEN_W - 8, y + lineH - 4, COL_DARK_GREY);
            }

            y += lineH;
        }
    }
}

// ---------------------------------------------------------------------------
// Draw: Mail view (TFT)
// ---------------------------------------------------------------------------
void drawMailView() {
    tft.fillScreen(COL_BG);

    // Header
    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(COL_RED, COL_BG);
    tft.drawString("MAIL", 8, 8, 4);

    // Large unread count centered
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(COL_WHITE, COL_BG);
    char countBuf[8];
    snprintf(countBuf, sizeof(countBuf), "%d", mail.unread);
    tft.drawString(countBuf, SCREEN_W / 2, SCREEN_H / 2 - 30, 7);

    // "unread" label
    tft.setTextColor(COL_GREY, COL_BG);
    tft.drawString("unread", SCREEN_W / 2, SCREEN_H / 2 + 20, 2);

    // Divider
    int divY = SCREEN_H / 2 + 45;
    tft.drawLine(8, divY, SCREEN_W - 8, divY, COL_DARK_GREY);

    // Latest mail info
    if (mail.recentFrom.length() > 0) {
        tft.setTextDatum(TL_DATUM);
        tft.setTextColor(COL_ORANGE, COL_BG);
        tft.drawString(truncate(mail.recentFrom, 22), 8, divY + 10, 2);

        tft.setTextColor(COL_WHITE, COL_BG);
        tft.drawString(truncate(mail.recentSubject, 22), 8, divY + 30, 2);
    }
}

// ---------------------------------------------------------------------------
// Draw: OLED thought bubble
// ---------------------------------------------------------------------------
void drawOLED() {
    oled.clearBuffer();
    oled.setFont(u8g2_font_helvR10_tr);

    // Type indicator in top-right
    if (thought.type == "music") {
        oled.drawStr(120, 12, "~");
    } else if (thought.type == "alert") {
        oled.drawStr(120, 12, "!");
    }

    // Thought text with word wrap
    String text = thought.text;
    if (text.length() == 0) {
        text = "...";
    }

    int maxWidth = 118;  // leave room for type indicator
    int lineHeight = 14;
    int y = 14;
    int startIdx = 0;

    while (startIdx < (int)text.length() && y <= 62) {
        // Find how many chars fit on this line
        int endIdx = text.length();
        while (endIdx > startIdx) {
            String sub = text.substring(startIdx, endIdx);
            int w = oled.getStrWidth(sub.c_str());
            if (w <= maxWidth) break;
            // Back up to last space
            int lastSpace = sub.lastIndexOf(' ');
            if (lastSpace > 0) {
                endIdx = startIdx + lastSpace;
            } else {
                endIdx--;
            }
        }

        String line = text.substring(startIdx, endIdx);
        oled.drawStr(2, y, line.c_str());

        // Skip past the space
        startIdx = endIdx;
        if (startIdx < (int)text.length() && text.charAt(startIdx) == ' ') {
            startIdx++;
        }

        y += lineHeight;
    }

    oled.sendBuffer();
}

// ---------------------------------------------------------------------------
// Touch: tap anywhere to toggle view, 500ms debounce
// ---------------------------------------------------------------------------
void handleTouch() {
    uint16_t tx, ty;
    if (!tft.getTouch(&tx, &ty)) return;

    unsigned long now = millis();
    if (now - lastTouch < 500) return;
    lastTouch = now;

    currentView = (currentView == 0) ? 1 : 0;
    dataChanged = true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String truncate(const String& str, int maxLen) {
    if ((int)str.length() <= maxLen) return str;
    return str.substring(0, maxLen - 1) + ".";
}
