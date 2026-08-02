# Changelog (Historia Zmian)

Wszystkie znaczące zmiany w projekcie CiapongiRP Launcher będą dokumentowane w tym pliku.

## [1.0.1] 
### Dodano (Added)
- **System Automatycznych Aktualizacji:** Pełna integracja z biblioteką `electron-updater` oraz GitHub Releases. Launcher potrafi teraz samodzielnie sprawdzać, pobierać i instalować nowsze wersje (zarówno na Windows jak i Linux).
- **Auto-pobieranie w tle:** Nowa, domyślnie włączona funkcja ukrywająca cały proces pobierania w tle. Gracz jest informowany jedynie w momencie, w którym aktualizacja jest już gotowa do podmiany po ponownym uruchomieniu launchera.
- **Aktualizacje w Ustawieniach:** Nowa sekcja "Aktualizacje Launchera" w menu *Ustawień*. Pozwala na zarządzanie auto-pobieraniem (ON/OFF) oraz ręczne wymuszenie sprawdzenia wersji serwerów.
- **Skrypt aktualizatora:** Plik `Aktualizator_Launchera.bat` przeznaczony dla graczy ze starą (nieaktualizującą się samodzielnie) wersją 1.0.0, aby w sekundę przeskoczyli na 1.0.1.
- **Odświeżone README:** Kompletnie nowy wygląd strony głównej na GitHubie z tagami (badges), tabelami wymagań sprzętowych oraz sekcją dla Twórców.

## [1.0.0] - Poprzednio (Pierwsze Wydanie)
### Dodano (Added)
- **Multi-konto:** Płynne przełączanie jednym kliknięciem między profilami Premium i Non-Premium w menu bocznym bez wpisywania danych od nowa.
- **Nowy system motywów:** Aż 5 różnorodnych motywów do wyboru (Dark Violet, Midnight Blue, Crimson, Emerald, Pure Black).
- **Profil Ultra Potato:** Ekstremalnie ograniczający zużycie zasobów tryb działania JVM dla graczy z bardzo słabymi i starymi komputerami (alokacja ok. 1.5 - 2 GB RAM).
- **Auto-dodawanie Serwera:** Automatyczne wstrzykiwanie adresu `ciapongi.szablix.pl` do listy serwerów gry przy każdym pierwszym włączeniu klienta Minecrafta.
- **Optymalizacje kodu Launchera:** Wdrożenie asynchronicznego ładowania okien (`React.lazy`), aby główny panel włączał się bez zacinek.
