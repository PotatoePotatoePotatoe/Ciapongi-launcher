
Wszystkie znaczące zmiany w projekcie CiapongiRP Launcher będą dokumentowane w tym pliku.

## [1.1.0]
### Poprawiono (Fixed)
- **Instalator w tle:** Dodano wymuszone opóźnienie wywołania instalatora, pozwalając procesowi głównego launchera na poprawne zamknięcie się, co eliminuje problem, gdzie instalator "po cichu" umierał przy próbie nadpisania otwartych plików.

## [1.0.9]
### Dodano (Added)
Wyświetlanie wersji: Dodano informację o obecnej wersji launchera w zakładce Ustawienia.
### Poprawiono (Fixed)
Błąd aktualizacji: Naprawiono krytyczny błąd (deadlock) w github-updater.js, który powodował zacinanie się instalacji aktualizacji w tle na procesie launchera (wywołanie przez spawn).

## [1.0.8]
### Dodano (Added)
Aktualizacje Delta (Smart Extract): Wdrożono nowy, inteligentny system pobierania i synchronizacji paczki modyfikacji. Launcher teraz weryfikuje lokalne pliki z użyciem kryptograficznych hashów (SHA-256) na podstawie pliku manifest.json.
Zabezpieczenie własnych modów: Usuwane są wyłącznie pliki, które zostały oficjalnie usunięte z paczki (wykrywane poprzez porównanie starego manifestu z nowym). Modyfikacje wgrane przez gracza są całkowicie bezpieczne.
Optymalizacja naprawy plików: Proces weryfikacji i naprawy paczki jest teraz błyskawiczny. Jeśli wszystkie pliki są aktualne, launcher całkowicie pomija pobieranie archiwum ZIP. W przeciwnym razie pobiera ZIP, ale wyciąga z niego tylko potrzebne (brakujące) pliki.
### Poprawiono (Fixed)
Błąd "Aero Snap" w Windows (Window Snapping): Zmieniono właściwość transparent: true na false w plikach głównego procesu Electrona. Dzięki temu system Windows poprawnie pozwala na przypinanie (snapping) bezramkowego okna launchera do krawędzi ekranu.
Zachowanie wyłączonych modów (.disabled): Nowy system aktualizacji Delta w pełni respektuje opcjonalne modyfikacje wyłączane przez gracza (z przyrostkiem .disabled). Zmienione pliki nie są nadpisywane podczas

## [1.0.7]
### Dodano (Added)
Własne kolory interfejsu (Custom Theme): Dodano nową funkcję w ustawieniach wyglądu pozwalającą graczom na swobodny wybór własnych kolorów (głównego akcentu i dodatkowego do gradientów) za pomocą wbudowanej palety barw. Zmiany są widoczne w czasie rzeczywistym przed zapisem.
Ostatnie zmiany w launcherze: Na głównym ekranie, bezpośrednio pod informacjami o aktualizacjach paczki z modami, znajduje się teraz nowa sekcja z changelogiem pobierana na żywo z platformy GitHub, dotycząca aktualizacji i nowości samego launchera.
### Poprawiono (Fixed)
Kolory podświetleń (Hover/Shadows): Usunięto sztywno zapisane, fioletowe cienie i tła pojawiające się m.in. wokół awatara gracza oraz zaznaczonych opcji na pasku nawigacyjnym. Teraz każdy z takich elementów automatycznie adaptuje się i świeci barwą aktualnie używanego motywu (np. czerwony w trybie Crimson). 

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
