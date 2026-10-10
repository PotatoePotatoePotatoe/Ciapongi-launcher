<div align="center">
  <h1>🚄 CiapongiRP Launcher</h1>
  
  **Oficjalny launcher dla społeczności CiapongiRP**  
  Szybki, nowoczesny i zoptymalizowany launcher do gry Minecraft. Zbudowany z myślą o maksymalnej wydajności dla słabszych komputerów i niesamowitym designie!

  [**Pobierz Najnowszą Wersję (Windows & Linux)**](https://github.com/PotatoePotatoePotatoe/Ciapongi-launcher/releases/latest)
</div>

<br />

---

## ✨ Główne Możliwości

- 🚀 **Niesamowita Wydajność** – Zbudowany z naciskiem na minimalizację opóźnień. Zoptymalizowany dla najsłabszych komputerów za pomocą specjalnego profilu JVM **Ultra Potato**.
- 🎨 **System Motywów** – Wybierz z 5 unikalnych motywów, w tym *Dark Violet*, *Emerald*, czy *Pure Black*.
- 🔑 **Multi-Konto** – Obsługa pełnego przełączania pomiędzy kontami Premium (Microsoft) oraz kontami Offline w 2 sekundy (zapisywanie wielu profili jednocześnie).
- 🔄 **Auto-Updater w Tle** – Launcher sam dba o swoje aktualizacje. Instaluje najnowsze łatki bez konieczności wychodzenia z aplikacji i manualnego pobierania z przeglądarki!
- 🌐 **Automatyczne dodawanie serwera** – Przy pierwszym uruchomieniu launcher automatycznie podpina adres serwera `ciapongi.szablix.pl` do konfiguracji gry, eliminując konieczność ręcznego wpisywania IP przez graczy.

## 📥 Jak pobrać?

Aby zacząć grać na serwerze CiapongiRP:

1. Przejdź do zakładki **[Releases](https://github.com/PotatoePotatoePotatoe/Ciapongi-launcher/releases/latest)**.
2. Pobierz odpowiedni plik dla swojego systemu operacyjnego:

### 🪟 Windows
Pobierz plik `CiapongiRPLauncher Setup x.x.x x64.exe` lub `CiapongiRPLauncher x.x.x x64.exe` kliknij w niego dwukrotnie, zainstaluj i ciesz się grą!

### 🐧 Linux (Instrukcja uniwersalna dla wszystkich dystrybucji)
Wygenerowaliśmy pliki, które zadziałają na każdym Linuxie (Ubuntu, Linux Mint, Debian, Arch, Fedora itp.). Wybierz jedną z metod:

**Metoda 1: Plik `.AppImage` (Zalecana i najprostsza)**
Nowoczesny, przenośny format. Działa bez instalacji.
1. Pobierz plik `CiapongiRPLauncher-x.x.x.AppImage`.
2. Kliknij na plik prawym przyciskiem myszy -> wybierz **Właściwości** -> zakładka **Uprawnienia**.
3. Zaznacz opcję: **Zezwól na wykonywanie pliku jako programu**.
4. Dwukrotnie kliknij plik i graj!

*(Wskazówka dla użytkowników **Ubuntu 22.04 / 24.04** i nowszych: Jeśli plik nie chce się uruchomić, otwórz terminal i wpisz `sudo apt install libfuse2`, aby doinstalować obsługę plików AppImage).*

**Metoda 2: Plik `.tar.gz` (Dla zaawansowanych)**
Gotowe pliki binarne do własnoręcznego ulokowania w systemie.
1. Pobierz plik `ciapongi-rp-launcher-x.x.x.tar.gz`.
2. Wypakuj archiwum w dowolnym folderze (np. `~/Gry/CiapongiLauncher`).
3. Wejdź do wypakowanego folderu, nadaj plikowi `ciapongi-rp-launcher` uprawnienia do uruchamiania i odpal go.


## ⚙️ Wymagania Sprzętowe

| Kategoria | Wymagania Minimalne (Tryb Potato) | Zalecane |
| :--- | :--- | :--- |
| **Pamięć RAM** | 4 GB | 8 GB+ |
| **System** | Windows 10/11 (64-bit), Linux | Windows 11 (64-bit) |
| **Java** | Java 17/21 | Java 21 |

## 🛠️ Stack Technologiczny

Projekt został zbudowany przez entuzjastę dla graczy.
- **Frontend:** React, Vanilla CSS, Lucide React (ikony).
- **Backend:** Node.js, Electron.
- **Wydania:** Automatyzacja przy pomocy `electron-builder` i `electron-updater`.
- **Moduł MC:** `minecraft-launcher-core` oraz komunikacja IPC.

## 🙋‍♂️ Twórcy

Stworzone ze ❤️ dla serwera **CiapongiRP**.

- **Serwer oraz Pomysł:** [SZABLIX](https://github.com/KrolestwoSZABLIXa)
- **Aplikacja:** [PotatoePotatoePotatoe](https://github.com/PotatoePotatoePotatoe)

---

*Jeśli podoba Ci się projekt, zostaw gwiazdkę (⭐️) na GitHubie!*
