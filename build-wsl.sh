#!/usr/bin/env bash

# Skrypt pomocniczy do budowania wersji Linux w WSL
set -e

# Kolory dla konsoli
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}== Ciapongi-RP Launcher - WSL Linux Build Helper ==${NC}"

# Sprawdzanie Node.js i npm
if ! command -v node &> /dev/null; then
    echo -e "${RED}[Błąd] Node.js nie jest zainstalowany w Twoim WSL.${NC}"
    echo -e "${YELLOW}Zainstaluj Node.js i npm uruchamiając w WSL:${NC}"
    echo -e "  sudo apt update && sudo apt install -y nodejs npm"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}[Błąd] npm nie jest zainstalowany w Twoim WSL.${NC}"
    echo -e "${YELLOW}Zainstaluj npm uruchamiając w WSL:${NC}"
    echo -e "  sudo apt update && sudo apt install -y npm"
    exit 1
fi

echo -e "${GREEN}[1/3] Instalacja zależności npm...${NC}"
npm install

echo -e "${GREEN}[2/3] Budowanie aplikacji dla systemu Linux...${NC}"
npm run dist:linux

echo -e "${GREEN}[3/3] Budowanie zakończone!${NC}"
echo -e "${YELLOW}Wygenerowane pliki znajdziesz w:${NC}"
echo -e "  dist-app/ciapongi-rp-launcher-1.0.0.tar.gz"
echo -e "  dist-app/CiapongiRPLauncher-1.0.0.AppImage"
echo -e ""
echo -e "${GREEN}Możesz zainstalować launcher na Linuxie używając install.sh lub uruchomić bezpośrednio AppImage!${NC}"
