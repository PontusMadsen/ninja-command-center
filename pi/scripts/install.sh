#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$PI_DIR")"

echo "=== Ninja Command Center — Install ==="
echo ""

# --- System dependencies ---
echo "[1/7] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y python3-pygame python3-pip alsa-utils sox

# --- WM8960 audio driver ---
echo "[2/7] Checking WM8960 audio driver..."
if aplay -l 2>/dev/null | grep -qi wm8960; then
  echo "  WM8960 driver already installed."
else
  echo "  WM8960 driver not found. Installing..."
  TMPDIR=$(mktemp -d)
  git clone https://github.com/waveshare/WM8960-Audio-HAT.git "$TMPDIR/WM8960"
  cd "$TMPDIR/WM8960"
  sudo ./install.sh
  cd "$PI_DIR"
  rm -rf "$TMPDIR"
  echo "  WM8960 driver installed. A reboot may be required."
fi

# --- PiTFT framebuffer ---
echo "[3/7] Checking PiTFT framebuffer..."
if [ -e /dev/fb1 ]; then
  echo "  /dev/fb1 found."
else
  echo "  WARNING: /dev/fb1 not found."
  echo "  The PiTFT display requires manual setup."
  echo "  See: https://learn.adafruit.com/adafruit-pitft-28-inch-resistive-touchscreen-display-raspberry-pi"
fi

# --- Node dependencies ---
echo "[4/7] Installing Node.js dependencies..."
cd "$PI_DIR"
npm install

# --- Python dependencies ---
echo "[5/7] Installing Python dependencies..."
pip3 install openwakeword sounddevice numpy webrtcvad

# --- Data directory ---
echo "[6/7] Creating data directory..."
mkdir -p "$PI_DIR/data"

# --- Environment file ---
if [ -f "$PI_DIR/.env.example" ] && [ ! -f "$PI_DIR/.env" ]; then
  cp "$PI_DIR/.env.example" "$PI_DIR/.env"
  echo "  Copied .env.example to .env — edit it with your settings."
else
  echo "  .env already exists or no .env.example found, skipping."
fi

# --- Systemd service ---
echo "[7/7] Installing systemd service..."
sudo cp "$PI_DIR/systemd/ninja-hub.service" /etc/systemd/system/ninja-hub.service
sudo systemctl daemon-reload
sudo systemctl enable ninja-hub.service

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit pi/.env with your API keys and settings"
echo "  2. Reboot if the WM8960 driver was just installed"
echo "  3. Start the service:  sudo systemctl start ninja-hub"
echo "  4. Check status:       sudo systemctl status ninja-hub"
echo "  5. View logs:          journalctl -u ninja-hub -f"
