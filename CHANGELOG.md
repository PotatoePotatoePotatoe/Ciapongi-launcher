# Changelog (Historia Zmian)

Wszystkie znaczące zmiany w projekcie CiapongiRP Launcher będą dokumentowane w tym pliku.

## [1.0.6]
### Dodano (Added)
- **Niestandardowy Updater GitHub (`github-updater.js`):** Zastąpiono `electron-updater` własnym modułem odpytującym bezpośrednio GitHub API (`/releases/latest`). Nowe rozwiązanie nie wymaga pliku `latest.yml` — opiera się wyłącznie na wbudowanym module `https` Node.js i jest niezależne od zewnętrznych bibliotek.
- **Badge aktualizacji w sidebarze:** Przy przycisku „Ustawienia" pojawia się teraz pulsująca kolorowa kropka gdy dostępna jest aktualizacja launchera (niebieska = dostępna do pobrania, zielona = gotowa do instalacji), bez konieczności wchodzenia do zakładki Ustawień.

### Poprawiono (Fixed)
- **Animacja ikony odświeżania:** Naprawiono brakującą klasę CSS `.spin` — ikona kręcąca się podczas sprawdzania i pobierania aktualizacji teraz działa poprawnie.
- **Guard trybu deweloperskiego:** Updater launchera jest teraz automatycznie wyłączany gdy aplikacja uruchamiana jest przez `npm run dev`, eliminując fałszywe błędy podczas pracy nad kodem.
- **Dynamiczne ustawienie auto-pobierania:** Opcja „Pobieraj aktualizacje automatycznie w tle" jest teraz odczytywana z aktualnego konfiga przy każdym sprawdzeniu, a nie tylko przy starcie aplikacji.

## [1.0.4]
### Dodano (Added)
- **Niestandardowy Updater GitHub (`github-updater.js`):** Zastąpiono `electron-updater` własnym modułem odpytującym bezpośrednio GitHub API (`/releases/latest`). Nowe rozwiązanie nie wymaga pliku `latest.yml` i jest w pełni niezależne od zewnętrznych bibliotek — opiera się wyłącznie na wbudowanym module `https` Node.js.
- **Badge aktualizacji w sidebarze:** Przy przycisku „Ustawienia" pojawia się teraz pulsująca kolorowa kropka gdy dostępna jest aktualizacja launchera (niebieska = dostępna, zielona = gotowa do instalacji), bez konieczności wchodzenia do zakładki Ustawień.

### Poprawiono (Fixed)
- **Animacja ikony odświeżania:** Naprawiono brakującą klasę CSS `.spin` powodującą brak animacji obracającej się ikony podczas sprawdzania i pobierania aktualizacji.
- **Guard trybu deweloperskiego:** Updater launchera jest teraz automatycznie wyłączany gdy aplikacja uruchamiana jest przez `npm run dev`, eliminując fałszywe błędy podczas pracy nad kodem.
- **Dynamiczne `autoDownload`:** Ustawienie pobierania w tle jest teraz odczytywane z aktualnego konfiga przy każdym wywołaniu sprawdzania aktualizacji, a nie tylko przy starcie aplikacji.

## [1.0.3]
### Dodano (Added)
- **Logika aktualizacji (electron-updater):** Właściwa implementacja sprawdzania, pobierania i instalowania aktualizacji launchera za pośrednictwem GitHub Releases w backendzie aplikacji (obsługa `main-win.js` i `main-linux.js`).
- **Interfejs Aktualizacji:** Dodano do sekcji "Ustawienia" pełen, funkcjonalny panel informujący w czasie rzeczywistym o dostępności aktualizacji (z paskiem postępu) oraz przełącznik pobierania w tle.

### Poprawiono (Fixed)
- **Wymuszenie logowania (Czysta instalacja):** Usunięto lokalny plik z danymi logowania i konfiguracją środowiska deweloperskiego. Wygenerowane wersje są w pełni wyczyszczone – domyślnie wymagają logowania na konto.

## [1.0.2]
### Zmieniono (Changed)
- **Przebudowa interfejsu (Ustawienia):** Zoptymalizowano układ i rozkład opcji. "Wykryta specyfikacja komputera" oraz "Motywy GUI" znajdują się po prawej stronie, podczas gdy po lewej zgrupowano podstawowe opcje i nowo powstałą, rozwijaną (w formie akordeonu) sekcję "Ustawienia zaawansowane".
- **Przeniesienie wyboru konta:** Informacja z głównego panelu została usunięta celem optymalizacji widoku na pełnym ekranie. Logowanie i przełączanie (Offline/Premium) odbywa się wyłącznie poprzez kliknięcie awatara/nicku gracza w lewym dolnym rogu ekranu.
- **Odświeżenie systemu motywów:** Kolory akcentowe, podkreślenia menu oraz przyciski zostały w pełni dostosowane do działającego i ujednoliconego motywu (np. czerwony blask dla Crimson, niebieski dla Midnight Blue).
- **Zoptymalizowany Panel Kont:** Menu zarządzania i dodawania kont zostało dopasowane do najnowszego designu motywów.
### Usunięto (Removed)
- **Autoryzacja GitHub:** Usunięto nieużywany i wprowadzający w błąd przycisk wprowadzania osobistego tokenu Github. Zastąpiono publicznym API (limit do 60 pobrań na godzinę) tam, gdzie to konieczne.
- **Zbędne pobieranie Fabric API:** Usunięto z kodu oddzielne skrypty wymuszające instalację dodatkowych modów systemowych (Fabric API), ponieważ modyfikacja ta od zawsze była dostarczana bezpośrednio w głównej paczce modyfikacji serwera, co oszczędzi zasoby przy instalacji.
### Dodano (Added)
- **Usuwanie kont:** W lewym dolnym profilu (zarządzanie kontami) pojawiła się obok loginu nowa, funkcjonalna ikona (kosz) pozwalająca na całkowite usunięcie poświadczeń wprowadzonych wcześniej na liście.
- **Rekomendacja RAM:** Dopracowano komunikaty zalecanej pamięci RAM: rekomendowaną (widoczną dla wszystkich) ilością do stabilnej rozgrywki jest 6-8 GB.

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
