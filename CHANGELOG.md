Wszystkie znaczące zmiany w projekcie CiapongiRP Launcher będą dokumentowane w tym pliku.

## [1.1.6]
### Dodano (Added)
- **Dynamiczne pobieranie najnowszej wersji Fabric Loader:** Launcher sprawdza oficjalne API meta.fabricmc.net i automatycznie instaluje oraz uruchamia najnowszą stabilną wersję Fabric.
- **Aktualizacje modyfikacji w locie (Modrinth API):** Dodano funkcję sprawdzania aktualizacji zainstalowanych modów za pomocą sum kontrolnych SHA1 i API Modrinth w zakładce modów, z możliwością aktualizacji pojedynczej lub masowej.
- **Zabezpieczenie przed duplikatami:** Podmiana modyfikacji automatycznie usuwa poprzednie wersje plików `.jar` oraz `.jar.disabled`, zapobiegając konfliktom.
- **Optymalizacje paczki modów:** Dołączono modyfikację `BadOptimizations`, `Freecam` oraz `Cull Less Leaves` i wyczyszczono zduplikowane nazwy plików w instancji.

### Poprawiono (Fixed)
- **Przezroczysta ikona:** Całkowite usunięcie tła w sztuczną szarą kratkę (checkerboard) i wygenerowanie wektorowej ikony monoraila z prawdziwym, 100% przezroczystym kanałem alfa dla Windows i Linux.

## [1.1.5]
### Zmieniono (Changed)
- **Migracja źródła paczek serwera na ciapongi.szablix.pl:** Pobieranie paczek oraz lista wydań przeniesione z GitHub na bezpośrednie API `ciapongi.szablix.pl/paczki`. Umożliwia to wybór i pobieranie także starszych wersji paczki serwerowej.
- **Aktualizator launchera (`github-updater.js`):** Moduł aktualizacji launchera sprawdza w pierwszej kolejności serwer `ciapongi.szablix.pl` (z bezpiecznym fallbackiem na GitHub Releases).
- **Interfejs Dashboard:** Dodano wyświetlanie rozmiaru paczki w megabajtach w liście wyboru wersji.

## [1.1.4] 
### Poprawiono (Fixed)
- **Zduplikowany kod UI:** Usunięto błąd powodujący wyświetlanie dwóch sekcji aktualizacji na dole okna Ustawień.
- **Hotfix (Critical):** Naprawiono krytyczny błąd powodujący crash po świeżej instalacji z powodu braku pliku utils/fs_utils.js.

## [1.1.3] 
### Poprawiono (Fixed)
- **Aktualizator launchera na Windows:** Naprawiono błąd, przez który aktualizacja pobierała się, ale po restarcie nie pojawiało się okno instalatora. Zmieniono metodę wywoływania z `spawn` na `shell.openPath`, wymuszając poprawne podniesienie uprawnień (UAC) do zainstalowania aktualizacji.
- **Zagubiony panel aktualizacji:** Przywrócono brakujący kod UI w zakładce "Ustawienia" do obsługi ręcznego pobierania aktualizacji launchera.
- **System zdarzeń głównego procesu (IPC):** Wyeliminowano krytyczny błąd asynchroniczności, przez który mechanizm naprawy mógł spowodować zablokowanie procesu wywołując niewłaściwy typ handlera IPC.

### Zmieniono (Changed)
- **Refaktoryzacja głównego procesu:** Scalono pliki `main-win.js` i `main-linux.js` w jeden zunifikowany plik `main.js`, używając weryfikacji platformy do obsługi specyficznych dla systemu akcji.
- **Discord RPC:** Całkowicie usunięto bibliotekę i obsługę Discord RPC (bogatej obecności) z launchera na polecenie użytkownika.

### Dodano (Added)
- **Automatyczna aktualizacja na systemie Linux:** Launcher teraz domyślnie generuje i wykorzystuje format `.AppImage` zamiast zwykłego archiwum `.tar.gz`. Mechanizm aktualizacji zyskał wsparcie dla automatycznej podmiany pliku AppImage i samoczynnego restartowania, oferując na Linuksie to samo bezproblemowe doświadczenie instalacji co instalator Windows.
- **Przycisk "Napraw pliki gry":** Nowy czerwony przycisk w panelu Dashboard pod przyciskiem wymuszenia aktualizacji. Służy on do całkowitego zresetowania lokalnej informacji o paczce i manifestu, zmuszając instalator do ponownego, pełnego pobrania całej zawartości od zera. Zachowuje własne mody gracza.

## [1.1.2] 
### Poprawiono (Fixed)
- **Krytyczny błąd `extreme_zgc` — EMERGENCY allocator failure:** Naprawiono błąd powodujący crash renderowania chunków (`EMERGENCY: Tried to allocate N bytes but the allocator reports failure`). Przyczyną było statyczne ustawienie `-XX:SoftMaxHeapSize=8192m` niezależne od przydzielonego RAM — ZGC zbyt agresywnie zwalniał pamięć, nie pozostawiając miejsca na alokacje renderera. Wartość jest teraz dynamiczna: **80% przydzielonego RAM** (np. przy 10 GB → 8192m, przy 16 GB → 13107m). Dodano również `-XX:ZUncommitDelay=600` spowalniający oddawanie pamięci do systemu.
- **Niespójne progi auto-doboru profilu JVM:** Ujednolicono logikę we wszystkich 3 miejscach (`readConfig`, funkcja startowania gry, przycisk rekomendacji w Ustawieniach). Poprzednio launcher w trybie `auto` przy starcie gry używał progu `≤6500 MB` dla profilu `potato` (zamiast `≤8500 MB`) i nigdy nie wybierał `extreme_zgc` nawet na maszynach z >16 GB RAM. Naprawiono.

### Zmieniono (Changed)
- **Pełne Aikar's Flags — profil `optimized_g1gc`:** Zaktualizowano flagi JVM do kompletnego zestawu Aikar's Flags zgodnego z oficjalną dokumentacją PaperMC. Poprzednie flagi były niekompletne (brakowało 8 flag). Dodano: `-XX:G1MaxNewSizePercent`, `-XX:G1HeapWastePercent=5`, `-XX:G1MixedGCCountTarget=4`, `-XX:G1RSetUpdatingPauseTimePercent=5`, `-XX:SurvivorRatio=32`, `-XX:+PerfDisableSharedMem`, `-XX:MaxTenuringThreshold=1`, `-Dusing.aikars.flags`, `-Daikars.new.flags=true`. Poprawiono `MaxGCPauseMillis` z `20` na `200` (wartość zgodna ze specyfikacją Aikara). `G1HeapRegionSize` dobierany dynamicznie: **8M** dla ≤12 GB RAM, **16M** dla >12 GB RAM.
- **Aikar's Flags Lite — profil `potato`:** Zaktualizowano do pełnego zestawu Aikar's Lite z `ParallelRefProcEnabled`, `DisableExplicitGC`, `G1MaxNewSizePercent`, `G1HeapWastePercent`, `G1MixedGCCountTarget`, `G1RSetUpdatingPauseTimePercent`, `SurvivorRatio`, `MaxTenuringThreshold`, `PerfDisableSharedMem`.
- **Profil `ultra_potato`:** Zaktualizowano flagi do spójnego wariantu Aikar's dla słabych PC. Usunięto niekompatybilne flagi (`-Dsun.rmi.dgc.server.gcInterval`, `-Djava.awt.headless`, `-Dfml.ignorePatchDiscrepancies`). Zmieniono `G1HeapRegionSize` z `8M` na `4M` (lepiej dopasowane do małych heapów).

### Dodano (Added)
- **Pole własnych flag JVM w Ustawieniach:** W zakładce Ustawień, pod selektorem profilu JVM, pojawiło się nowe pole tekstowe (`textarea`) umożliwiające wpisanie własnych flag JVM. Flagi te są doklejane **po** flagach wybranego profilu i zapisywane automatycznie. Pole obsługuje wieloliniowy tekst oraz spacje jako separatory flag.

## [1.1.1] 
### Poprawiono (Fixed)
- **Krytyczny błąd JVM — flagi Akira (optimized_g1gc):** Usunięto błędną flagę `-XX:+MaxMetaspaceFreeRatio=10` (nieprawidłowy prefiks `+` zamiast `=`), która powodowała crash Javy przy starcie Minecrafta z profilem G1GC. Flagi `MinMetaspaceFreeRatio` i `MaxMetaspaceFreeRatio` zostały całkowicie usunięte ze wszystkich profili JVM (`ultra_potato`, `potato`, `optimized_g1gc`) — były niekompatybilne z nowszymi wersjami JDK i niepotrzebnie ograniczały GC.
- **Domyślny folder instalacji:** Zmieniono lokalizację domyślnego katalogu gry z `AppData` na `Dokumenty\CiapongiRP\minecraft-instance`. Pliki paczki są teraz łatwo dostępne dla użytkownika bez zagłębiania się w ukryte foldery systemowe.

### Dodano (Added)
- **Automatyczny zapis ustawień:** Zakładka Ustawienia zapisuje zmiany automatycznie po 800ms od każdej modyfikacji (debounce). Nie trzeba już klikać „Zapisz ustawienia" po każdej zmianie — widoczne jest potwierdzenie „✓ Zapisano automatycznie". Przycisk „Zapisz teraz" pozostaje jako opcja ręcznego wymuszenia.
- **Cache 24h dla sprawdzania paczki z GitHub:** Launcher nie odpytuje GitHub API przy każdym uruchomieniu. Jeśli paczka jest zainstalowana i sprawdzano ją w ciągu ostatnich 24h, launcher pomija wywołanie API i startuje natychmiast. Eliminuje to problem z brakiem dostępu do paczki po 5-10 crashach gry — pliki pozostają dostępne bez konieczności ponownego pobierania. Wymuszenie sprawdzenia jest możliwe przyciskiem „Sprawdź aktualizacje paczki".

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

### Wcześniejsze wersję usunięte ze względu na udostępnie plików prywatnych dewelopera

## [1.0.2]
### Zmieniono (Changed)
- **Przebudowa interfejsu (Ustawienia):** Zoptymalizowano układ i rozkład opcji. "Wykryta specyfikacja komputera" oraz "Motywy GUI" znajdują się po prawej stronie, podczas gdy po lewej zgrupowano podstawowe opcje i nowo powstałą, rozwijaną (w formie akordeonu) sekcję "Ustawienia zaawansowane".
- **Przeniesienie wyboru konta:** Informacja z głównego panelu została usunięta celem optymalizacji widoku na pełnym ekranie. Logowanie i przełączanie (Offline/Premium) odbywa się wyłącznie poprzez kliknięcie awatara/nicku gracza w lewym dolnym rogu ekranu.
- **Odświeżenie systemu motywów:** Kolory akcentowe, podkreślenia menu oraz przyciski zostały w pełni dostosowane do działającego i ujednoliconego motywu (np. czerwony blask dla Crimson, niebieski dla Midnight Blue).
- **Zoptymalizowany Panel Kont:** Menu zarządzania i dodawania kont zostało dopasowane do najnowszego designu motywów.
