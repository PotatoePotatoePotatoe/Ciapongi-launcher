# Instrukcja instalacji i uruchamiania Ciapongi-RP Launcher na Linux

Ten pakiet zawiera wszystko, co jest potrzebne do zainstalowania i uruchomienia launchera na systemie Linux.

## Co znajduje się w tym pakiecie:
1. `ciapongi-rp-launcher-1.0.0.tar.gz` - Główny spakowany program (zbudowany dla systemu Linux).
2. `install.sh` - Skrypt instalacyjny, który automatycznie instaluje wymagane biblioteki systemowe, rozpakowuje program i tworzy skrót w menu aplikacji oraz na Pulpicie.
3. `uninstall.sh` - Skrypt odinstalowujący launcher, który całkowicie usuwa aplikację i jej skróty z systemu.

---

## 🛠️ Krok 1: Instalacja programu

1. Otwórz terminal w folderze, do którego wypakowałeś to archiwum.
2. Nadaj uprawnienia do uruchamiania skryptowi instalacyjnemu:
   ```bash
   chmod +x install.sh
   ```
3. Uruchom instalator:
   ```bash
   ./install.sh
   ```
   *Uwaga: Instalator może poprosić o hasło administratora (`sudo`) w celu doinstalowania bibliotek systemowych wymaganych przez silnik Electron/Chromium (np. libnss3, libgbm itp.).*

4. Po zakończeniu instalacji ikona Launchera pojawi się w **Menu Aplikacji** Twojego systemu oraz na **Pulpicie**. Możesz go stamtąd bezpośrednio uruchomić!

---

## 🗑️ Krok 2: Odinstalowanie (Deinstalacja)

Jeśli program nie działa prawidłowo lub chcesz go całkowicie usunąć z komputera:

1. Otwórz terminal w folderze z tymi plikami.
2. Nadaj uprawnienia do uruchamiania skryptowi odinstalowującemu:
   ```bash
   chmod +x uninstall.sh
   ```
3. Uruchom deinstalator:
   ```bash
   ./uninstall.sh
   ```
Skrypt automatycznie wyczyści katalog instalacyjny oraz usunie skrót z menu aplikacji i Pulpitu.
