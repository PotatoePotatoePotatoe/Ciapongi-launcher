#!/usr/bin/env bash

# Uniwersalny i kompleksowy instalator Ciapongi-RP Launcher dla Linux
# Automatycznie instaluje:
# 1. Zależności systemowe (Electron / Chromium GUI & Audio)
# 2. Środowisko Java (OpenJDK - wymagane do uruchamiania gry Minecraft)
# 3. Node.js i npm (wymagane do budowania ze źródeł wg INSTRUKCJA_LINUX.md)
# 4. Kopiuje i konfiguruje aplikację wraz ze skrótami w menu systemowym i na Pulpicie.

set -e

# Kolory dla konsoli
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}=====================================================${NC}"
echo -e "${BLUE}     Instalator Kompleksowy Ciapongi-RP Launcher     ${NC}"
echo -e "${BLUE}=====================================================${NC}"

# 1. Wykrywanie platformy
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${RED}[Błąd] Ten instalator jest przeznaczony tylko dla systemów Linux!${NC}"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/share/ciapongi-rp-launcher"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_URL="https://ciapongi.szablix.pl/instalacja/server-icon.png"

# Funkcja pomocnicza do sprawdzania komend
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 2. Wykrywanie menedżera pakietów i instalacja zależności
echo -e "${YELLOW}[1/4] Sprawdzanie i instalowanie wymaganych pakietów systemowych...${NC}"
echo -e "${YELLOW}Możesz zostać poproszony o hasło administratora (sudo).${NC}"

if [ -f /etc/debian_version ]; then
    echo -e "${CYAN}Wykryto system oparty na Debian / Ubuntu / Mint / Pop!_OS.${NC}"
    DEPS="libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 libgbm1 libasound2 libxss1 libxcb-dri3-0 libx11-xcb1 tar curl wget openjdk-17-jre nodejs npm"
    sudo apt-get update || true
    sudo apt-get install -y $DEPS || sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 libgbm1 libasound2 tar curl wget default-jre nodejs npm || echo -e "${YELLOW}[Ostrzeżenie] Niektóre pakiety nie mogły zostać zainstalowane automatycznie.${NC}"

elif [ -f /etc/fedora-release ]; then
    echo -e "${CYAN}Wykryto system oparty na Fedora / RHEL.${NC}"
    DEPS="nss at-spi2-atk libX11 cups-libs libdrm gtk3 mesa-libGBM alsa-lib libXScrnSaver tar curl wget java-17-openjdk nodejs npm"
    sudo dnf install -y $DEPS || echo -e "${YELLOW}[Ostrzeżenie] Niektóre pakiety nie mogły zostać zainstalowane automatycznie.${NC}"

elif [ -f /etc/arch-release ]; then
    echo -e "${CYAN}Wykryto system oparty na Arch Linux / Manjaro.${NC}"
    DEPS="nss at-spi2-core libx11 cups libdrm gtk3 mesa alsa-lib tar curl wget jre17-openjdk nodejs npm"
    sudo pacman -Sy --needed --noconfirm $DEPS || sudo pacman -Sy --needed --noconfirm nss at-spi2-core libx11 cups libdrm gtk3 mesa alsa-lib tar curl wget jre-openjdk nodejs npm || echo -e "${YELLOW}[Ostrzeżenie] Pomijanie instalacji części pakietów pacman.${NC}"

elif [ -f /etc/zypp/zypper.conf ] || ([ -f /etc/os-release ] && grep -qi "opensuse" /etc/os-release); then
    echo -e "${CYAN}Wykryto system openSUSE.${NC}"
    DEPS="mozilla-nss libgtk-3-0 libasound2 libdrm2 libgbm1 tar curl wget java-17-openjdk nodejs npm"
    sudo zypper ref || true
    sudo zypper install -y $DEPS || echo -e "${YELLOW}[Ostrzeżenie] Pomijanie instalacji części pakietów zypper.${NC}"

else
    echo -e "${YELLOW}[Ostrzeżenie] Nie rozpoznano dystrybucji Linux.${NC}"
    echo -e "${YELLOW}Upewnij się, że masz zainstalowane biblioteki Electrona, środowisko Java (OpenJDK) oraz Node.js.${NC}"
fi

# Weryfikacja instalacji środowisk Java i Node.js
echo -e "\n${CYAN}Sprawdzanie zainstalowanych środowisk:${NC}"
if command_exists java; then
    echo -e "${GREEN}✓ Java jest zainstalowana: $(java -version 2>&1 | head -n 1)${NC}"
else
    echo -e "${YELLOW}! Ostrzeżenie: Nie wykryto polecenia 'java'. Launcher może wymagać Javy do uruchamiania gry Minecraft.${NC}"
fi

if command_exists node; then
    echo -e "${GREEN}✓ Node.js jest zainstalowany: $(node -v)${NC}"
else
    echo -e "${YELLOW}! Ostrzeżenie: Node.js nie został wykryty (wymagany tylko w przypadku samodzielnego budowania).${NC}"
fi

# 3. Przygotowanie katalogu instalacyjnego i kopiowanie plików
echo -e "\n${YELLOW}[2/4] Kopiowanie i konfiguracja plików aplikacji...${NC}"
mkdir -p "$INSTALL_DIR"

APPIMAGE_PATH=$(find "$SCRIPT_DIR" -maxdepth 2 -name "*.AppImage" 2>/dev/null | head -n 1 || true)
TARBALL_PATH=$(find "$SCRIPT_DIR" -maxdepth 2 -name "*.tar.gz" 2>/dev/null | head -n 1 || true)
UNPACKED_DIR=""
TEMP_DIR=""

if [ -n "$APPIMAGE_PATH" ] && [ -f "$APPIMAGE_PATH" ]; then
    echo -e "${GREEN}Znaleziono plik AppImage: $(basename "$APPIMAGE_PATH")${NC}"
    cp "$APPIMAGE_PATH" "$INSTALL_DIR/CiapongiRPLauncher.AppImage"
    chmod +x "$INSTALL_DIR/CiapongiRPLauncher.AppImage"
    EXEC_CMD="\"$INSTALL_DIR/CiapongiRPLauncher.AppImage\""
else
    if [ -n "$TARBALL_PATH" ] && [ -f "$TARBALL_PATH" ]; then
        echo -e "${GREEN}Znaleziono archiwum tar.gz: $(basename "$TARBALL_PATH")${NC}"
        TEMP_DIR=$(mktemp -d)
        echo -e "${YELLOW}Rozpakowywanie archiwum do katalogu tymczasowego...${NC}"
        tar -xzf "$TARBALL_PATH" -C "$TEMP_DIR"
        EXEC_FIND=$(find "$TEMP_DIR" -type f \( -name "ciapongi-rp-launcher" -o -name "CiapongiRPLauncher" -o -name "ciapongirp-launcher" \) 2>/dev/null | head -n 1 || true)
        if [ -n "$EXEC_FIND" ]; then
            UNPACKED_DIR=$(dirname "$EXEC_FIND")
        else
            UNPACKED_DIR="$TEMP_DIR"
        fi
    elif [ -d "$SCRIPT_DIR/linux-unpacked" ]; then
        UNPACKED_DIR="$SCRIPT_DIR/linux-unpacked"
    elif [ -d "$SCRIPT_DIR/dist-app/linux-unpacked" ]; then
        UNPACKED_DIR="$SCRIPT_DIR/dist-app/linux-unpacked"
    elif [ -f "$SCRIPT_DIR/ciapongirp-launcher" ] || [ -f "$SCRIPT_DIR/CiapongiRPLauncher" ] || [ -f "$SCRIPT_DIR/ciapongi-rp-launcher" ]; then
        UNPACKED_DIR="$SCRIPT_DIR"
    fi

    if [ -n "$UNPACKED_DIR" ]; then
        echo -e "${GREEN}Kopiowanie plików aplikacji z ${UNPACKED_DIR}...${NC}"
        cp -r "$UNPACKED_DIR"/* "$INSTALL_DIR/"
        
        BINARY_PATH=""
        for bin in "$INSTALL_DIR/ciapongi-rp-launcher" "$INSTALL_DIR/CiapongiRPLauncher" "$INSTALL_DIR/ciapongirp-launcher"; do
            if [ -f "$bin" ]; then
                BINARY_PATH="$bin"
                break
            fi
        done

        if [ -n "$BINARY_PATH" ]; then
            chmod +x "$BINARY_PATH"
            EXEC_CMD="\"$BINARY_PATH\""
            echo -e "${GREEN}Ustawiono uprawnienia do uruchamiania dla: $(basename "$BINARY_PATH")${NC}"
        else
            echo -e "${RED}[Błąd] Nie odnaleziono pliku wykonywalnego w katalogu instalacyjnym!${NC}"
            [ -n "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"
            exit 1
        fi
    else
        echo -e "${RED}[Błąd] Nie znaleziono pliku .AppImage, archiwum .tar.gz ani rozpakowanego folderu aplikacji (linux-unpacked)!${NC}"
        exit 1
    fi
fi

# Nadawanie uprawnień w folderze roboczym (jeśli istnieje linux-unpacked)
if [ -f "$SCRIPT_DIR/linux-unpacked/ciapongi-rp-launcher" ]; then
    chmod +x "$SCRIPT_DIR/linux-unpacked/ciapongi-rp-launcher" || true
fi

# 4. Pobieranie/ustawianie ikony aplikacji
echo -e "\n${YELLOW}[3/4] Pobieranie i konfiguracja ikony aplikacji...${NC}"
ICON_PATH="$INSTALL_DIR/icon.png"

if command_exists curl; then
    curl -s -o "$ICON_PATH" "$ICON_URL" || true
elif command_exists wget; then
    wget -q -O "$ICON_PATH" "$ICON_URL" || true
fi

if [ ! -s "$ICON_PATH" ]; then
    echo -e "${YELLOW}Nie udało się pobrać ikony z serwera. Używanie ikony zastępczej.${NC}"
    ICON_PATH="game-gamepad"
fi

# 5. Tworzenie skrótu w menu systemowym (.desktop) i na Pulpicie
echo -e "\n${YELLOW}[4/4] Tworzenie skrótów w systemie...${NC}"
mkdir -p "$DESKTOP_DIR"
DESKTOP_FILE="$DESKTOP_DIR/ciapongi-rp-launcher.desktop"

cat <<EOF > "$DESKTOP_FILE"
[Desktop Entry]
Name=Ciapongi RP Launcher
Comment=Dedykowany launcher Minecraft dla Ciapongi-RP
Exec=$EXEC_CMD
Icon=$ICON_PATH
Terminal=false
Type=Application
Categories=Game;
StartupNotify=true
EOF

chmod +x "$DESKTOP_FILE"

# Kopiowanie skrótu na Pulpit
for desktop_folder in "$HOME/Pulpit" "$HOME/Desktop"; do
    if [ -d "$desktop_folder" ]; then
        cp "$DESKTOP_FILE" "$desktop_folder/"
        chmod +x "$desktop_folder/$(basename "$DESKTOP_FILE")"
        echo -e "${GREEN}✓ Utworzono skrót na Pulpicie: $desktop_folder${NC}"
    fi
done

[ -n "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"

echo -e "\n${GREEN}=====================================================${NC}"
echo -e "${GREEN}   Instalacja zakończona sukcesem!                   ${NC}"
echo -e "${GREEN}   Launcher oraz wszystkie wymagane zależności       ${NC}"
echo -e "${GREEN}   (zależności systemowe GUI, Java JRE, Node.js)     ${NC}"
echo -e "${GREEN}   zostały zainstalowane i skonfigurowane.           ${NC}"
echo -e "${GREEN}                                                     ${NC}"
echo -e "${GREEN}   Możesz uruchomić Ciapongi RP Launcher z menu      ${NC}"
echo -e "${GREEN}   aplikacji systemowych lub skrótu na Pulpicie.     ${NC}"
echo -e "${GREEN}=====================================================${NC}"
