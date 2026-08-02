# Instrukcja budowania i uruchamiania Ciapongi-RP Launcher na Linux

Niniejsze archiwum zawiera pełny kod źródłowy launchera, skonfigurowany i gotowy do zbudowania na systemie Linux (w tym zaktualizowany plik ikony `icon.png` o wysokiej rozdzielczości 1024x1024, wymagany przez program `electron-builder` do wygenerowania AppImage).

## Wymagania systemowe do budowania
Na komputerze, na którym budujesz program, musisz mieć zainstalowane:
1. **Node.js** (rekomendowana wersja 18 lub nowsza)
2. **npm** (menedżer pakietów Node)

## Krok 1: Automatyczna instalacja wszystkiego (Zalecane)
W tym folderze znajduje się gotowy skrypt `install.sh`, który automatycznie zainstaluje:
- Biblioteki systemowe Linux (wymagane przez Electron / Chromium)
- Środowisko **Java (OpenJDK)** (wymagane do uruchamiania gry Minecraft z poziomu launchera)
- **Node.js** i **npm** (do ewentualnego budowania ze źródeł)
- Pliki aplikacji w systemie gracza, ikony oraz skrót na Pulpicie i w menu aplikacji.

Aby uruchomić automatyczny instalator, wpisz w terminalu:
```bash
./install.sh
```

## Krok 2: Samodzielne budowanie (Opcjonalnie)
Jeśli chcesz ręcznie wykompilować nową wersję z kodu źródłowego:
1. Zainstaluj zależności: `npm install`
2. Zbuduj paczkę: `npm run dist:linux`
Ten skrypt:
1. Zbuduje frontend (React + Vite) w wersji produkcyjnej (z użyciem konfiguracji ESM w [vite.config.mjs](file:///e:/Antigravity%20data/vite.config.mjs)).
2. Wywoła `electron-builder` w celu spakowania całej aplikacji (z poprawnie zdefiniowanym autorem oraz kategorią aplikacji ustawioną jako gra: `Game`).
3. Wygeneruje archiwum `.tar.gz` (które w przeciwieństwie do AppImage nie wymaga biblioteki FUSE i działa od razu po rozpakowaniu).

Po pomyślnym zakończeniu gotowy plik znajdziesz w nowo utworzonym folderze:
`dist-app/ciapongi-rp-launcher-1.0.0.tar.gz`

## Krok 3: Uruchomienie na komputerze gracza
Aby uruchomić launcher na systemie Linux z pliku `.tar.gz`:
1. Przenieś plik `ciapongi-rp-launcher-1.0.0.tar.gz` na komputer gracza i rozpakuj go (np. za pomocą menedżera archiwów lub poleceniem):
   ```bash
   tar -xvf ciapongi-rp-launcher-1.0.0.tar.gz
   ```
2. Wejdź do wypakowanego folderu `linux-unpacked`:
   ```bash
   cd linux-unpacked
   ```
3. Nadaj uprawnienia do uruchamiania głównemu plikowi wykonywalnemu:
   ```bash
   chmod +x ciapongi-rp-launcher
   ```
4. Uruchom launcher:
   ```bash
   ./ciapongi-rp-launcher
   ```
