# HistoPuzzle: puzzle z preparatów histologicznych

Gra wystawowa przygotowana na festiwale nauki, dni otwarte uczelni i wystawy kół naukowych. Uczestnik próbuje ułożyć puzzle z prawdziwego preparatu histologicznego, a potem sprawdza, jak to samo zadanie rozwiązuje komputer. Na koniec odkrywa, że ułożony fragment to drobny punkt na ogromnym skanie, który w patologii cyfrowej analizuje się **kafelek po kafelku**.

Jedna rozgrywka trwa 3–5 minut. Gra działa na telefonie (tapnięcia) i na komputerze (kliknięcia lub przeciąganie).


## 1. O projekcie i idea dydaktyczna

Patolog ogląda pod mikroskopem cienkie skrawki tkanek barwione hematoksyliną i eozyną (H&E). Dziś preparaty skanuje się do cyfrowych obrazów (WSI, *whole slide images*) o rozmiarze miliardów pikseli, a algorytmy sztucznej inteligencji pomagają wskazać miejsca warte uwagi.

HistoPuzzle pokazuje trzy rzeczy:
1. **Tkankę trudno ułożyć z kawałków.** Struktura jest powtarzalna, kafelki są kwadratowe (kształt nic nie podpowiada), a komórki są przecięte na krawędziach. Osoba, która nigdy nie widziała takiej tkanki, nie wie nawet, czego szukać.
2. **Komputer „widzi” liczby, nie komórki.** Porównuje piksele na krawędziach kafelków i układa całość w kilka milisekund.
3. **Prawdziwy preparat jest ogromny.** Dlatego do analizy AI tnie się go na dziesiątki tysięcy kafelków, które model ocenia osobno.

To druga gra koła po [symulatorze hodowli komórek CHO](https://github.com/Juliancia/simulate_cho), z tą samą dramaturgią: człowiek się męczy, a komputer rozwiązuje zadanie w ułamku sekundy.

### Przebieg gry

| Akt | Co robi gracz | Czego się uczy |
|-----|---------------|----------------|
| 0. Rozgrzewka | Układa logo koła (3×3) | Zwykłe puzzle są łatwe, to punkt odniesienia |
| 1. Ułóż tkankę | Układa preparat: 4×4 na telefonie, 5×5 na komputerze | Tkanka jest powtarzalna, a kwadratowe kafelki nic nie podpowiadają |
| 2. Oczami komputera | Ogląda piksele, rozdziela barwniki, porównuje krawędzie | Obraz to liczby; jak komputer ocenia podobieństwo kafelków |
| 3. Komputer układa | Ogląda animację algorytmu i porównanie „Ty kontra komputer” | Algorytm zna tylko piksele na krawędziach, a mimo to układa całość w milisekundy |
| 4. Skala | Ogląda odjazd od planszy do całego szkiełka, podział na kafelki i mapę „AI” | Dlaczego preparaty analizuje się w kafelkach |


## 2. Podłoże biologiczne

### Barwienie hematoksyliną i eozyną (H&E)
Najczęściej stosowane barwienie w histopatologii:
- **Hematoksylina** (zasadowa, fioletowo-granatowa) wiąże się z kwasami nukleinowymi, więc barwi **jądra komórkowe**.
- **Eozyna** (kwaśna, różowa) wiąże się z białkami, więc barwi **cytoplazmę, kolagen i erytrocyty**.
- **Białe obszary** to światła naczyń i gruczołów, tkanka tłuszczowa albo puste szkło.

### Tkanki w grze
| Tkanka | Trudność | Co widać |
|--------|----------|----------|
| **Skóra** | łatwa | Naskórek na górze, pod nim brodawki skórne i skóra właściwa. Warstwy podpowiadają, gdzie jest góra, a gdzie dół. |
| **Jelito grube** | średnia | Prawidłowa błona śluzowa: krypty jelitowe z jasnymi komórkami kubkowymi produkującymi śluz. Ciemne pasy to fałdy skrawka powstałe przy cięciu. |
| **Węzeł chłonny (chłoniak)** | bardzo trudna | Węzeł wypełniony komórkami chłoniaka rozlanego z dużych komórek B (DLBCL). Tysiące podobnych komórek i prawie żadnych punktów orientacyjnych. |

### Patologia cyfrowa i kafelki
- Skaner preparatów fotografuje szkiełko w powiększeniu 40× (ok. 0,25 µm na piksel). Jeden preparat ma zwykle **kilkadziesiąt tysięcy pikseli w każdą stronę**, czyli kilkanaście–kilkadziesiąt GB bez kompresji.
- Takiego obrazu nie da się wczytać w całości do pamięci karty graficznej. Sieci neuronowe uczy się więc na małych **kafelkach** (zwykle 224–512 pikseli).
- Model ocenia każdy kafelek osobno, a wyniki składa z powrotem w **mapę cieplną** całego preparatu. Nie musi układać puzzli, bo skaner zapisuje położenie każdego kafelka.
- Mapa wskazuje patologowi, gdzie warto spojrzeć najpierw. **Decyzję diagnostyczną zawsze podejmuje człowiek.**


## 3. Algorytmy

### Porównywanie krawędzi kafelków
Dla każdego kafelka bierzemy dwa skrajne paski pikseli z każdej strony i przeliczamy je do przestrzeni barw **CIE Lab**, w której odległość między kolorami lepiej odpowiada temu, jak różnicę widzi człowiek.

Niepodobieństwo krawędzi liczymy metodą predykcyjną (Pomeranz, Shemesh & Ben-Shahar, CVPR 2011). Algorytm przedłuża „trend” kafelka A za jego krawędź i sprawdza, jak bardzo ta przepowiednia różni się od pierwszego paska kafelka B (i odwrotnie):

$$D(A,B) = \sum_{k,c} \left|2A_{k,K} - A_{k,K-1} - B_{k,1}\right|^{p} + \left|2B_{k,1} - B_{k,2} - A_{k,K}\right|^{p}, \quad p = 0.3$$

Wykładnik $p < 1$ zmniejsza wpływ pojedynczych, bardzo odstających pikseli.

Pewność dopasowania (procent pokazywany w grze):

$$C(A,B) = \exp\left(-\left(\frac{D(A,B)}{q_A}\right)^{8}\right)$$

gdzie $q_A$ to dolny kwartyl wartości $D$ dla kafelka A. Wynik bliski 100% oznacza kandydata, który wyraźnie odstaje od pozostałych, czyli komputer jest „pewny”.

### Układanie (solver)
Zachłanny algorytm układający:
1. Zaczyna od kafelka, który ma najwięcej **„najlepszych kumpli”** (*best buddies*), czyli par kafelków wzajemnie wskazujących się jako najlepsze dopasowanie.
2. W każdym kroku sprawdza wszystkie wolne pola przylegające do ułożonej części i wszystkie nieużyte kafelki, a następnie wstawia parę (pole, kafelek) o najwyższej średniej pewności względem sąsiadów.
3. Ułożona część nie może wyjść poza ramkę n×n.

Algorytm nie zna poprawnego obrazu, tylko piksele na krawędziach. Na wszystkich trzech tkankach w grze układa całość bezbłędnie w kilka milisekund.

### Rozdzielanie barwników (dekonwolucja kolorów)
Zgodnie z prawem Lamberta–Beera gęstość optyczna piksela $OD = -\log_{10}(I / I_0)$ jest sumą wkładów poszczególnych barwników. Mnożąc wektor $OD$ przez odwrotność macierzy barwników Ruifroka i Johnstona (2001), otrzymujemy ilość hematoksyliny i eozyny w każdym pikselu. Dzięki temu komputer „widzi” jądra osobno od cytoplazmy.


## 4. Architektura i technologie

Gra to **statyczna strona internetowa bez kompilacji** (Zero-Build SPA). Działa w całości w przeglądarce, bez serwera aplikacji, bazy danych i bundlerów.

- **HTML5 + Vanilla JavaScript (ES Modules)**: kod podzielony na moduły (szczegóły w sekcji 10).
- **Tailwind CSS** (CDN): wygląd zgodny z identyfikacją wizualną koła (kolory `#1B1D3A`, `#4043A0`, `#DFEFF6`, `#C4455C`, czcionka nagłówków `Gochi Hand`).
- **Pointer Events**: to samo sterowanie na dotyku i myszy (tapnięcie dwóch kafelków zamienia je miejscami, przeciągnięcie też).
- **HTML5 Canvas 2D**: lupa na piksele, rozdzielanie barwników, animacja odjazdu do całego preparatu i mapa cieplna.
- **Lucide Icons** (ikony) oraz **qrcode-generator** (kod QR do strony koła na końcu gry).


## 5. Prywatność

- Gra **nie zbiera żadnych danych**: nie ma formularzy, rankingu ani analityki.
- Nic nie jest zapisywane w przeglądarce. Przycisk **Od nowa** w nagłówku przywraca grę do ekranu startowego dla kolejnej osoby.

---

## 6. Instrukcja gry

### Krok 1: Rozgrzewka
1. Kliknij **Zaczynamy**.
2. Ułóż logo koła: **tapnij dwa kafelki**, żeby zamienić je miejscami, albo przeciągnij kafelek na inne pole.
3. Kliknij **Teraz prawdziwa tkanka**.

### Krok 2: Ułóż tkankę
1. Wybierz preparat: skórę, jelito grube albo węzeł chłonny.
2. Spróbuj ułożyć obraz. Opcja **Tryb łatwy** podświetla kafelki leżące na właściwym miejscu.
3. Po 90 sekundach pojawi się przycisk **Poproś komputer o pomoc**. W każdej chwili możesz też kliknąć **Jak to widzi komputer?**

### Krok 3: Oczami komputera
1. **Piksele**: dotknij kafelka, żeby zobaczyć powiększenie i wartości RGB wybranego piksela.
2. **Rozdzielanie barwników**: porównaj obraz H&E z obrazami „tylko hematoksylina” i „tylko eozyna”.
3. **Porównywanie krawędzi**: wybierz kafelek ze swojej planszy i kierunek (prawo, dół, lewo, góra). Zobaczysz ranking kandydatów z procentem pewności i mapę cieplną dopasowań.
4. Kliknij **Wróć do układania z pomocnikiem**. Po tapnięciu kafelka pomocnik oznaczy strzałkami najlepiej pasujących sąsiadów. Możesz też kliknąć **Niech komputer ułoży całość**.

### Krok 4: Komputer układa
1. Obserwuj, jak algorytm dokłada kafelki od najpewniejszych dopasowań (animacja jest celowo spowolniona).
2. Porównaj swój czas i liczbę ruchów z czasem obliczeń komputera.

### Krok 5: Skala
1. Obserwuj odjazd od Twojej planszy do całego szkiełka i odczyt szerokości pola widzenia.
2. Kliknij **Pokaż podział na kafelki**, a potem **Pokaż mapę z modelu AI**.
3. Mapa cieplna jest **ilustracją poglądową**, a nie wynikiem prawdziwego modelu ani diagnozą. Gra wyraźnie ją tak oznacza.


## 7. Jak sklonować i uruchomić projekt lokalnie

Do uruchomienia nie trzeba instalować bibliotek ani kompilatorów. Kod korzysta z natywnych modułów JavaScript (ES Modules), więc pliki muszą być serwowane przez lokalny serwer HTTP. Przeglądarka blokuje moduły w pliku otwartym podwójnym kliknięciem (`file:///`).

### Krok 1: Klonowanie repozytorium
```bash
git clone https://github.com/Juliancia/histopuzzle.git
cd histopuzzle
```

### Krok 2: Uruchomienie lokalnego serwera

#### Opcja A: Python (zalecana)
```bash
python3 -m http.server 8000
```
(W systemie Windows, jeśli `python3` nie działa, wpisz `python -m http.server 8000`.)

#### Opcja B: Node.js / npx
```bash
npx serve .
```

#### Opcja C: Visual Studio Code
1. Zainstaluj rozszerzenie **Live Server** (autor: Ritwick Dey).
2. Kliknij prawym przyciskiem na `index.html` i wybierz **Open with Live Server**.

### Krok 3: Otwarcie w przeglądarce
Otwórz adres:
```
http://localhost:8000
```

---

## 8. Wdrożenie na GitHub Pages

1. Wypchnij kod na gałąź `main` repozytorium na GitHubie.
2. W repozytorium otwórz **Settings → Pages**.
3. W sekcji **Build and deployment** ustaw:
   - **Source**: `Deploy from a branch`,
   - **Branch**: `main`, katalog `/(root)`,
   - kliknij **Save**.
4. Po około minucie gra będzie dostępna pod adresem `https://<login>.github.io/histopuzzle/`.

Link można umieścić w kodzie QR na plakacie przy stoisku, żeby uczestnicy grali na swoich telefonach.


## 9. Obrazy tkanek i licencje

Gra używa prawdziwych preparatów diagnostycznych H&E z archiwum **The Cancer Genome Atlas (TCGA)**, udostępnianych publicznie (*open access*) przez NCI Genomic Data Commons. Źródło każdej tkanki jest podpisane w grze.

| Tkanka | Preparat TCGA | Projekt | Wycinek |
|--------|---------------|---------|---------|
| Skóra | TCGA-FS-A1ZN-01Z-00-DX7 | SKCM | 600 µm, obrócony o 180° (na skanie naskórek był na dole) |
| Jelito grube | TCGA-AD-5900-01Z-00-DX1 | COAD | 450 µm |
| Węzeł chłonny | TCGA-FM-8000-01Z-00-DX1 | DLBC | 450 µm |

W repozytorium jest tylko wycinek (`<id>_fragment.jpg`, 1024 px) i miniatura szkiełka (`<id>_thumb.jpg`, szerokość 1200 px) każdego preparatu, a nie wielogigabajtowe skany.

> The results shown here are in whole or part based upon data generated by the TCGA Research Network: https://www.cancer.gov/tcga.

### Podmiana albo dodanie preparatu z TCGA
Skrypt `tools/fetch_gdc_tissue.py` pobiera z API GDC tylko potrzebne kafelki skanu (kilka MB zamiast pliku `.svs` o rozmiarze 0,1–1 GB) i sam aktualizuje `assets/tissues/manifest.json`. Wymaga tylko biblioteki Pillow (`pip install pillow`).

```bash
# 1. Lista otwartych preparatów z projektu TCGA
python3 tools/fetch_gdc_tissue.py list TCGA-COAD

# 2. Miniatura całego szkiełka do obejrzenia
python3 tools/fetch_gdc_tissue.py thumb <file_id> --out podglad.jpg

# 3. Podgląd wybranego miejsca w większym powiększeniu
python3 tools/fetch_gdc_tissue.py crop <file_id> --tx 0.67 --ty 0.70 --um 1000 --level-offset 2 --out zoom.jpg

# 4. Wycinek do gry i aktualizacja manifestu
python3 tools/fetch_gdc_tissue.py fragment <file_id> --id intestine --tx 0.668 --ty 0.704 --um 450 --name TCGA-AD-5900-01Z-00-DX1.svs
```

`--tx` i `--ty` to środek wycinka jako ułamek szerokości i wysokości szkiełka, a `--um` to bok wycinka w mikrometrach. Nazwę i opis tkanki (`name`, `description`) zmienia się ręcznie w manifeście.

### Własne skany i obrazy syntetyczne
- Własny plik WSI (`.svs`, `.tif`, `.ndpi`) przygotuje `tools/prepare_tissue.py` (wymaga biblioteki `openslide`).
- Moduł `js/synth.js` generuje syntetyczne tkanki H&E bez żadnych plików. Wystarczy w manifeście ustawić `"source": {"type": "synthetic", "kind": "skin", "seed": 11}` (dostępne `kind`: `skin`, `intestine`, `lymph_node`).


## 10. Struktura plików

```
histopuzzle/
├── index.html                  ekrany wszystkich aktów
├── css/styles.css              styl koła (kolory i czcionki jak w symulatorze CHO)
├── js/
│   ├── app.js                  przebieg gry i przejścia między aktami
│   ├── puzzle.js               plansza: tasowanie, tapnięcia i przeciąganie, sprawdzanie wygranej
│   ├── vision.js               krawędzie kafelków, pewność dopasowań, dekonwolucja H&E
│   ├── solver.js               algorytm układający i ocena ułożenia
│   ├── zoom.js                 odjazd do całego preparatu, kafelkowanie, mapa cieplna
│   ├── tissues.js              wczytywanie manifestu i obrazów
│   └── synth.js                generator syntetycznych tkanek (zapasowy)
├── assets/
│   ├── img/                    logo koła
│   └── tissues/                manifest.json oraz wycinki i miniatury preparatów TCGA
└── tools/
    ├── fetch_gdc_tissue.py     pobieranie wycinków z TCGA (API GDC)
    └── prepare_tissue.py       przygotowanie własnego pliku WSI
```


## 11. O SKN Cyfrowi Biolodzy

**Studenckie Koło Naukowe Cyfrowi Biolodzy** działa przy Wydziale Biologii i Ochrony Środowiska Uniwersytetu Łódzkiego. Zrzesza studentów kierunku Biologia i Biomedycyna Cyfrowa oraz pasjonatów informatyki, bioinformatyki, biologii molekularnej, analizy danych omicznych i sztucznej inteligencji w naukach o życiu.

- Organizacja: Studenckie Koło Naukowe Cyfrowi Biolodzy
- Uczelnia: Uniwersytet Łódzki
- GitHub: [https://github.com/biologiacyfrowa](https://github.com/biologiacyfrowa)
- Strona koła: [https://biologiacyfrowa.github.io/website_BC/](https://biologiacyfrowa.github.io/website_BC/)
