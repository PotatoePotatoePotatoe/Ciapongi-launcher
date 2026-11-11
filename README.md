<div align="center">
  <h1>🚄 CiapongiRP Launcher</h1>
  
  **Oficjalny launcher dla społeczności CiapongiRP (Tauri v2 + Rust)**  
  Natywny, ultralekki i szybki launcher do gry Minecraft. Zbudowany z myślą o maksymalnej wydajności dla słabszych komputerów i niskim zużyciu pamięci RAM!

  [**Pobierz Najnowszą Wersję (Windows & Linux)**](https://github.com/PotatoePotatoePotatoe/Ciapongi-launcher/releases/latest)
</div>

<br />

---

## ✨ Główne Możliwości

- ⚡ **Natywny Rdzeń w Rust (Tauri v2)** – O ~40% mniejsze zużycie RAM i wielokrotnie szybszy start niż wersje oparte o Electrona. Błyskawiczny skan zainstalowanych modów `.jar` i zoptymalizowane profile JVM **Ultra Potato**.
- 🎨 **System Motywów** – Wybierz z wbudowanych motywów (*Dark Violet*, *Emerald*, *Crimson*, *Midnight Blue*, *Pure Black*) lub własnej palety kolorów.
- 🔑 **Multi-Konto** – Przełączanie pomiędzy kontami Premium (Microsoft OAuth2) oraz kontami Offline z automatyczną migracją ustawień z v1.x.
- 🔄 **Auto-Updater w Tle** – Automatyczne sprawdzanie i aktualizacja launchera z `ciapongi.szablix.pl` / GitHub Releases.
- 🌐 **Automatyczne dodawanie serwera** – Przy pierwszym uruchomieniu launcher podpina adres serwera `ciapongi.szablix.pl` do `servers.dat`.

## 📥 Jak pobrać?

1. Przejdź do zakładki **[Releases](https://github.com/PotatoePotatoePotatoe/Ciapongi-launcher/releases/latest)**.
2. Pobierz odpowiedni plik dla swojego systemu operacyjnego:

### 🪟 Windows (10/11 64-bit)
- **Instalator (`CiapongiRPLauncher.Setup.2.0.0.exe`)** – standardowy kreator instalacji ze skrótami w Menu Start i na Pulpicie.
- **Wersja przenośna (`CiapongiRPLauncher.2.0.0.exe`)** – pojedynczy plik `.exe` niewymagający instalacji.

### 🐧 Linux
- **`.AppImage` (`CiapongiRPLauncher-2.0.0.AppImage`)** – uniwersalny format przenośny dla każdej dystrybucji (obsługuje automatyczną podmianę przy aktualizacjach).
- **`.deb` (`CiapongiRPLauncher_2.0.0_amd64.deb`)** – natywna paczka instalacyjna dla Ubuntu, Debian i Linux Mint (`sudo apt install ./CiapongiRPLauncher_2.0.0_amd64.deb`).
- **`.tar.gz` (`ciapongi-rp-launcher-2.0.0.tar.gz`)** – archiwum z natywną binarką do wypakowania do wybranego folderu.

## ⚙️ Wymagania Sprzętowe

| Kategoria | Wymagania Minimalne (Tryb Potato) | Zalecane |
| :--- | :--- | :--- |
| **Pamięć RAM** | 4 GB | 8 GB+ |
| **System** | Windows 10/11 (64-bit), Linux | Windows 11 (64-bit), Linux |
| **Java** | Pobierana automatycznie (Adoptium Java 17/21) | Java 17 / 21 |

## 🛠️ Stack Technologiczny

- **Frontend:** React, Vite, Vanilla CSS, Lucide React.
- **Backend:** Rust, Tauri v2, Tokio, Reqwest (`rustls` + HTTP/2), Rayon.
- **Wydania:** GitHub Actions (natywne kompilacje na `ubuntu-22.04` oraz `windows-latest`).

## 🙋‍♂️ Twórcy

Stworzone dla serwera **CiapongiRP**.

- **Serwer oraz Pomysł:** [SZABLIX](https://github.com/KrolestwoSZABLIXa)
- **Aplikacja:** [PotatoePotatoePotatoe](https://github.com/PotatoePotatoePotatoe)

