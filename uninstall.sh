#!/usr/bin/env bash

# Skrypt odinstalowujący Ciapongi-RP Launcher dla systemów Linux
set -e

# Kolory dla konsoli
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${RED}===============================================${NC}"
echo -e "${RED}   Deinstalator Ciapongi-RP Launcher dla Linux  ${NC}"
echo -e "${RED}===============================================${NC}"

INSTALL_DIR="$HOME/.local/share/ciapongi-rp-launcher"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/ciapongi-rp-launcher.desktop"

echo -e "${YELLOW}Rozpoczynanie deinstalacji...${NC}"

# 1. Usuwanie plików aplikacji
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${BLUE}Usuwanie katalogu instalacyjnego: $INSTALL_DIR${NC}"
    rm -rf "$INSTALL_DIR"
else
    echo -e "${YELLOW}Katalog instalacyjny $INSTALL_DIR nie istnieje.${NC}"
fi

# 2. Usuwanie skrótu .desktop w menu aplikacji
if [ -f "$DESKTOP_FILE" ]; then
    echo -e "${BLUE}Usuwanie skrótu menu aplikacji: $DESKTOP_FILE${NC}"
    rm -f "$DESKTOP_FILE"
fi

# 3. Usuwanie skrótów z Pulpitu
for desktop_folder in "$HOME/Pulpit" "$HOME/Desktop"; do
    SHORTCUT="$desktop_folder/ciapongi-rp-launcher.desktop"
    if [ -f "$SHORTCUT" ]; then
        echo -e "${BLUE}Usuwanie skrótu z Pulpitu: $SHORTCUT${NC}"
        rm -f "$SHORTCUT"
    fi
done

echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}   Launcher został pomyślnie odinstalowany!    ${NC}"
echo -e "${GREEN}===============================================${NC}"
