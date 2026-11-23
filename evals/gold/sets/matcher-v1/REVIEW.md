# Gold set v1: owner review, part 1 (blind second labels)

This is the double-label worklist written by `double-label.ts pick` (174 snapshots, 10% of every product's snapshots, seed `matcher-v1-2026-11-23`). It is **blind**: it shows the product and the listing, never the agent's label. Please label every row before opening `REVIEW-disagreements.md`, which shows the agent's labels.

**How to mark.** Write one relation in the last column: exact, variant, bundle, accessory_or_part, other_model, other_line, unknown. Judge identity only; condition (open box, refurbished) and price are not part of the relation. Rulings in force: a suffix that changes the line (Duo vs Duo Plus) or the material (PLA+ vs Silk PLA+) is never `exact`; Combo versus not-Combo is `variant` both ways; a 2-pack of the target is `variant` (pack count); the product plus other items is `bundle`; a model number in a URL is supporting evidence only (URLs are not shown here). The orchestrator copies the column into `labels/<your handle>.json` with `"pass": "second"`, and `double-label.ts agreement` then reports raw agreement and Cohen's kappa.

Relation meanings: **exact** the same item (would share a barcode); **variant** same model, another colour, capacity, size, configuration or pack count; **bundle** the item plus other items sold as one; **accessory_or_part** an accessory, spare part or consumable for it; **other_model** same brand and family, another model or generation; **other_line** another line, brand or unrelated item; **unknown** cannot tell from the fields.


## 990-pro-2tb (computing, CA, held_out)

Samsung 990 PRO 2 TB NVMe M.2 SSD without heatsink.

Target: brand **Samsung**, model **990 PRO**, MPN `MZ-V9P2T0B/AM`, GTIN `887276657011`, must have: capacity: 2 TB; heatsink: without heatsink

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 1 | `990-pro-2tb-s08` | SAMSUNG 990 PRO w/Heatsink SSD 4TB PCIeGen4 NVMe M.2Internal SolidState HardDrive , MZ-V9P4T0CW | brand SAMSUNG; MPN MZ-V9P4T0CW; GTIN 797541699670; marketplace_seller; www.bestbuy.ca |  |
| 2 | `990-pro-2tb-s09` | Samsung 9100 Pro 2TB NVMe PCI-e Internal Solid State Drive (MZ-VAP2T0B/AM) - Black | brand SAMSUNG; MPN MZ-VAP2T0B/AM; GTIN 887276904900; www.bestbuy.ca |  |
| 3 | `990-pro-2tb-s17` | Samsung 990 2TB NVMe PCI-e Internal Solid State Drive (MZ-V9V2T0B/AM) | brand SAMSUNG; MPN MZ-V9V2T0B/AM; GTIN 198957280801; www.bestbuy.ca |  |

## a1-mini (3d-printing, CA, dev)

Bambu Lab A1 mini FDM 3D printer, the printer alone (not the A1 mini Combo with AMS lite).

Target: brand **Bambu Lab**, model **A1 mini**, GTIN `6937285506146`, must have: configuration: printer only, without AMS lite

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 4 | `a1-mini-s18` | Bambu Lab P2S AMS Combo Enclosed FDM 3D Printer - Multi-Colour Printing, Camera, Auto Bed Leveling, 600mm/s, 300°C – 256 x 256 x 256mm Build Volume | brand BAMBU LAB; MPN P2S AMS Combo; GTIN 6937285513335; www.bestbuy.ca |  |
| 5 | `a1-mini-s21` | E3D High Flow ObXidian™ HotEnd for Bambu Lab A1 & A1 Mini | brand E3D; GTIN 05225789; Nozzle Diameter=0.40mm; caz3d.com |  |
| 6 | `a1-mini-s22` | E3D High Flow ObXidian™ HotEnd for Bambu Lab A1 & A1 Mini | brand E3D; GTIN 05258557; Nozzle Diameter=0.60mm; caz3d.com |  |

## airpods-pro-2 (audio, CA, dev)

Apple AirPods Pro (2nd generation) with the USB-C MagSafe charging case.

Target: brand **Apple**, model **AirPods Pro (2nd generation)**, MPN `MTJV3AM/A`, must have: chargingCase: MagSafe charging case (USB-C)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 7 | `airpods-pro-2-s01` | Apple AirPods Pro (2nd generation) In-Ear Noise Cancelling Truly Wireless Headphones - White | brand APPLE; MPN Airpods Pro; GTIN 0194253397168; marketplace_seller; www.bestbuy.ca |  |
| 8 | `airpods-pro-2-s08` | Refurbished (Excellent) - Apple AirPods Pro (2nd generation) In-Ear Noise Cancelling Truly Wireless Headphones - White | brand APPLE; MPN MQD83AM/A; GTIN 999003956523; condition refurbished; marketplace_seller; www.bestbuy.ca |  |
| 9 | `airpods-pro-2-s09` | Refurbished (Fair) - Apple AirPods Pro (2nd generation) In-Ear Noise Cancelling Truly Wireless Headphones - White | brand APPLE; MPN MQD83AM/A; GTIN 999004152900; condition refurbished; marketplace_seller; www.bestbuy.ca |  |

## anker-737 (computing, CA, dev)

Anker 737 Power Bank (PowerCore 24K), 24,000 mAh, 140 W, black.

Target: brand **Anker**, model **737 Power Bank (PowerCore 24K)**, MPN `A1289011`, must have: capacity: 24,000 mAh; colour: Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 10 | `anker-737-s01` | Refurbished (Excellent) Anker 737 Power Bank, 24000mAh 3-Port Laptop Charger with 140W Output: Smart Digital Display, 3-Port 140W Fast Charging, Black | brand ANKER; MPN A1289011-F0; GTIN 194644098728; condition refurbished; marketplace_seller; www.bestbuy.ca |  |
| 11 | `anker-737-s02` | Anker Power Bank (25K, 165W, Built-In Cables) with 240W USB-C Cable | brand Anker; MPN COMBO-A1695H11-1-A82E2011-1; GTIN 194644209476; ca.anker.com |  |
| 12 | `anker-737-s03` | Anker <b>736</b> Charger (Nano II 100W) | brand Anker; MPN A2145113; GTIN 194644095949; ca.anker.com |  |

## anker-prime-power-bank-de (computing, DE, dev)

Anker Prime power bank, 20,000 mAh, 220 W, on its own (no charging base or cable bundle).

Target: brand **Anker**, model **Prime Powerbank (20K, 220W)**, MPN `A110BH11`, GTIN `194644239350`, must have: capacity: 20,000 mAh; power: 220 W

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 13 | `anker-prime-power-bank-de-s10` | Anker <b>325</b> Powerbank (PowerCore 20K) | brand Anker; MPN A1268013; GTIN 848061059861; Color=Schwarz; de.anker.com |  |
| 14 | `anker-prime-power-bank-de-s12` | Anker Prime 20000mAh Powerbank (200W) | brand beta-anker-de; MPN A13360B1; GTIN 194644147648; Color=Champagner; de.anker.com |  |
| 15 | `anker-prime-power-bank-de-s13` | Anker Powerbank (20K, 87W, Integriertes USB-C Kabel) | brand Anker; MPN A1383011; GTIN 194644043711; Color=Schwarz; de.anker.com |  |

## bosch-gsr-18v-65-de (power-tools, DE, dev)

Bosch Professional GSR 18V-65 cordless drill/driver 06019N3200, bare tool in a carton.

Target: brand **Bosch Professional**, model **GSR 18V-65**, MPN `06019N3200`, GTIN `4053423321555`, must have: kit: tool only in cardboard box, no battery or charger

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 16 | `bosch-gsr-18v-65-de-s10` | 06019N3206 GSR 18V-65 Akkubohrmaschine 2x ProCORE18V 4.0 Ah und Ladegerät GAL 18V-40 in L-BOXX | GTIN 4053423321586; www.toolnation.de |  |
| 17 | `bosch-gsr-18v-65-de-s11` | 0615A50035 3 Werkzeugsatz - GSR 18V-55 Akku-Bohrmaschine + GWS 18V-7 Schleifmaschine + GBH 18V-22 Bohrhammer 18V 4.0Ah Li-Ion | GTIN 4053423251043; www.toolnation.de |  |
| 18 | `bosch-gsr-18v-65-de-s12` | 06019N3000 GSR 18V-65 Akku-Bohrschrauber-Set 2x 2,0 Ah und Ladegerät GAL 18V-20 im L-Koffer | GTIN 4053423321524; www.toolnation.de |  |

## braun-series-9-ca (personal-care, CA, dev)

Braun Series 9 PRO+ wet/dry foil shaver 9667cc with the cleaning centre (not 9677cc, not Sport+).

Target: brand **Braun**, model **Series 9 PRO+ 9667cc**, MPN `9667cc`, GTIN `047400707122`

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 19 | `braun-series-9-ca-s04` | Braun Series 9 PRO+ Wet/Dry Cordless Foil Shaver (9667cc) | brand BRAUN; MPN 9667CC; GTIN 047400707122; www.bestbuy.ca |  |
| 20 | `braun-series-9-ca-s06` | Braun Series 9 PRO+ Wet/Dry Cordless Foil Shaver with PowerCase (9677cc) | brand BRAUN; MPN 9677CC; GTIN 047400707139; www.bestbuy.ca |  |
| 21 | `braun-series-9-ca-s07` | Braun Series 6 Electric Shaver Replacement Head (64B) | brand BRAUN; MPN 64B; GTIN 069055140307; marketplace_seller; www.bestbuy.ca |  |

## breville-barista-express-ca (kitchen-appliances, CA, dev)

Breville Barista Express BES870 espresso machine, brushed stainless steel (not Barista Express Impress, not Barista Pro).

Target: brand **Breville**, model **Barista Express BES870**, MPN `BES870BSS1BCA1`, GTIN `021614055514`, must have: colour: Brushed Stainless Steel

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 22 | `breville-barista-express-ca-s20` | Breville Barista Express Espresso Machine, Brushed Stainless Steel, BES870XL | brand BREVILLE; MPN BES870XL; GTIN 0021614055514; marketplace_seller; www.bestbuy.ca |  |
| 23 | `breville-barista-express-ca-s21` | Breville Barista Express Espresso Machine, Brushed Stainless Steel, Manual Microfoam BES870XL | brand BREVILLE; MPN BES870XL; GTIN 5053243179762; marketplace_seller; www.bestbuy.ca |  |
| 24 | `breville-barista-express-ca-s22` | Breville Barista Pro Semi-Automatic Espresso Machine Bean-to-Cup - Brushed Stainless Steel | brand BREVILLE; MPN BES878BSS; GTIN 021614800619; www.bestbuy.ca |  |

## brita-10-cup (kitchen-appliances, CA, dev)

Brita Large 10-cup water filter pitcher with the Smart Light filter reminder (not the Champlain).

Target: brand **Brita**, model **Large 10 Cup Water Filter Pitcher (Smart Light)**, GTIN `060258507058`, must have: capacity: 10 cup

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 25 | `brita-10-cup-s08` | Water Filter Replacement for Brita Water Pitchers and Dispensers, Classic 35557, Ob03, Mavea 107007 and More, Reduce Chlorine and Bad Taste(3 Pcs) | brand MYACUC; MPN 730553059964; GTIN 730553059964; marketplace_seller; www.bestbuy.ca |  |
| 26 | `brita-10-cup-s09` | Brita Standard Water Filter Replacement, Chlorine Reduction, BPA-Free, 1 Count | brand BRITA; MPN TU_1310701; GTIN 029037199259; marketplace_seller; www.bestbuy.ca |  |

## centauri-carbon-2-us (3d-printing, US, dev)

ELEGOO Centauri Carbon 2 FDM 3D printer, the printer alone.

Target: brand **ELEGOO**, model **Centauri Carbon 2**, GTIN `6932704932933`, must have: configuration: printer alone (not the Combo)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 27 | `centauri-carbon-2-us-s06` | Centauri 2 Combo | brand ELEGOO; GTIN 6932704932957; us.elegoo.com |  |
| 28 | `centauri-carbon-2-us-s07` | Multi-Size High-Speed Hotend Kit for Centauri 2 Series/Centauri Carbon 2 Series (3pcs) | brand ELEGOO; us.elegoo.com |  |

## cosori-turboblaze-6l-de (kitchen-appliances, DE, held_out)

COSORI TurboBlaze 6.0-litre air fryer, dark grey (EU model).

Target: brand **COSORI**, model **TurboBlaze 6.0 L**, GTIN `810123674831`, must have: colour: Dunkelgrau (dark grey); capacity: 6.0 L

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 29 | `cosori-turboblaze-6l-de-s20` | COSORI 6,2-Liter Heißluftfritteuse & Zubehör | brand Cosori; GTIN 0810123671120; www.cosori.de |  |
| 30 | `cosori-turboblaze-6l-de-s21` | COSORI 5,5-Liter Heißluftfritteuse | brand Cosori; GTIN 0817915025574; Farbe=Schwarz; www.cosori.de |  |
| 31 | `cosori-turboblaze-6l-de-s22` | COSORI 5,5-Liter Heißluftfritteuse | brand Cosori; GTIN 0810043371094; Farbe=Weiß; www.cosori.de |  |

## cosori-turboblaze-6qt (kitchen-appliances, US, dev)

COSORI TurboBlaze 6.0-quart air fryer, dark gray (not the Smart version).

Target: brand **COSORI**, model **TurboBlaze 6.0-Quart Air Fryer**, MPN `KAAPAFCSNUS0161A`, GTIN `810123670376`, must have: colour: Dark Gray; capacity: 6.0 quart

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 32 | `cosori-turboblaze-6qt-s08` | Cosori Air Fryer Liners | brand COSORI; MPN KAACAACSNUS0104Y; GTIN 810043379823; Size=3-5 QT; www.cosori.com |  |
| 33 | `cosori-turboblaze-6qt-s09` | Cosori Air Fryer Liners | brand COSORI; MPN KAACAACSNUS0105Y; GTIN 810043379830; Size=5-6 QT; www.cosori.com |  |

## dcd793d1 (power-tools, CA, dev)

DEWALT DCD793D1 20V MAX brushless compact 1/2 in drill/driver kit with a 2.0 Ah battery and charger.

Target: brand **DEWALT**, model **DCD793D1**, MPN `DCD793D1`, must have: kit: drill/driver with one 2.0 Ah battery and charger

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 34 | `dcd793d1-s20` | Open Box - DEWALT DCD777C2 20V MAX Brushless 1/2-inch Drill Kit, 2 x 1.3Ah Batteries, Charger, Bag - Yellow/Black | brand DEWALT; MPN DCD777C2; GTIN 766619335741; condition open_box; marketplace_seller; www.bestbuy.ca |  |
| 35 | `dcd793d1-s21` | DEWALT Dual Action Sander (DWMT70780) | brand DEWALT; MPN DWMT70780; GTIN 634881050719; marketplace_seller; www.bestbuy.ca |  |
| 36 | `dcd793d1-s22` | DEWALT 20V MAX XR Brushless 1/2" 3-Speed Cordless Hammer Drill - DCD1007B - Tool Only | brand DEWALT; MPN DCD1007B; GTIN 885911802871; marketplace_seller; www.bestbuy.ca |  |

## dcf850 (power-tools, CA, dev)

DEWALT DCF850B ATOMIC 20V MAX 1/4 in 3-speed brushless impact driver, bare tool.

Target: brand **DEWALT**, model **DCF850B**, MPN `DCF850B`, GTIN `885911758253`, must have: kit: tool only

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 37 | `dcf850-s10` | NEW - DEWALT DCK283D2 20-Volt MAX Brushless Compact Drill + 3-speed Impact Driver Combo Kit (2-Tool) | brand DEWALT; MPN DCK283D2; GTIN 885911425360; marketplace_seller; www.bestbuy.ca |  |
| 38 | `dcf850-s11` | DEWALT DCF845P1 XR 3-Speed Brushless Cordless Impact Driver Kit, 1/4 in, 5.1 in L, Yellow, 20 V, Lithium-Ion, 1825 in-lb, Tool, Battery & Charger | brand DEWALT; costcutindustrial.ca |  |
| 39 | `dcf850-s12` | DEWALT Precision Point 16GA Finish Nailer Kit - DWFP71917 | brand DEWALT; MPN DWFP71917; GTIN 885911395762; marketplace_seller; www.bestbuy.ca |  |

## dewalt-dcd791-de (power-tools, DE, dev)

DEWALT DCD791NT 18 V brushless drill/driver, bare tool in a TSTAK case.

Target: brand **DEWALT**, model **DCD791NT**, MPN `DCD791NT-XJ`, GTIN `5035048616369`, must have: kit: tool only in TSTAK case, no battery or charger

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 40 | `dewalt-dcd791-de-s20` | WRE-50061 DeWalt-Adapter | GTIN 5055391406837; www.toolnation.de |  |
| 41 | `dewalt-dcd791-de-s21` | DCD708P2T-QW Akku-Bohrschrauber 18V 5.0Ah Li-Ion | GTIN 5035048734322; www.toolnation.de |  |
| 42 | `dewalt-dcd791-de-s22` | DCD791P2-QW DCD791P2 Akku-Bohrschrauber (bürstenlos) 18 Volt 5.0 Ah Li-Ion | GTIN 5035048616567; www.toolnation.de |  |

## dreame-pocket-neo-2-de (personal-care, DE, dev)

Dreame Pocket Neo 2 hair dryer, grey.

Target: brand **Dreame**, model **Pocket Neo 2**, GTIN `6979181929032`, must have: colour: Grau (grey)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 43 | `dreame-pocket-neo-2-de-s02` | Dreame Life 2-in-1 Tote-Tasche mit Schulterriemen | brand Dreame Germany; Farbe=Grau; de.dreametech.com |  |
| 44 | `dreame-pocket-neo-2-de-s03` | Dreame Life 2-in-1 Tote-Tasche mit Schulterriemen | brand Dreame Germany; Farbe=Schwarz; de.dreametech.com |  |

## elegoo-pla-plus-de (3d-printing, DE, held_out)

ELEGOO PLA Plus (PLA+) filament, black, 1.75 mm, 1 kg (not Rapid PLA+, not PLA).

Target: brand **ELEGOO**, model **PLA Plus**, must have: colour: Schwarz (black); diameter: 1.75 mm; weight: 1 kg

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 45 | `elegoo-pla-plus-de-s10` | PLA Matt | brand ELEGOO; Farbe=Matte White; de.elegoo.com |  |
| 46 | `elegoo-pla-plus-de-s12` | PLA PRO | brand ELEGOO; Farbe=Weiß; de.elegoo.com |  |
| 47 | `elegoo-pla-plus-de-s13` | PLA Metallisches | brand ELEGOO; Farbe=Metall-Gold; de.elegoo.com |  |

## happybrush-de (personal-care, DE, held_out)

happybrush Eco Vibe 3 sonic toothbrush, Black-Mint, Set S (not Eco Vibe 3+, ProSense or a value set).

Target: brand **happybrush**, model **Eco Vibe 3**, GTIN `4260486330596`, must have: colour: Black-Mint; set: Set S

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 48 | `happybrush-de-s20` | Aufsteckbürsten Eco Vibe 3+ \| Forest | brand happybrush; GTIN 4260486338127; Größe=6er Set; www.happybrush.de |  |
| 49 | `happybrush-de-s21` | Eco Vibe Kids Lern-Zahnbürste Paw Patrol \| BLACK DEAL | brand happybrush; GTIN 4260486335492; Set=Set S; www.happybrush.de |  |
| 50 | `happybrush-de-s22` | Eco Vibe Kids Lern-Zahnbürste Paw Patrol \| BLACK DEAL | brand happybrush; GTIN 4260486335492; Set=Set M; www.happybrush.de |  |

## hd-600-us (audio, US, dev)

Sennheiser HD 600 open-back headphones.

Target: brand **Sennheiser**, model **HD 600**, GTIN `615104340459`

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 51 | `hd-600-us-s20` | Sennheiser HD 660S2 Audiophile Headphones | brand Sennheiser; GTIN 810091270370; www.audio46.com |  |
| 52 | `hd-600-us-s21` | Sennheiser IE 600 In-Ear Headphones | brand Sennheiser; GTIN 810091270387; www.headphones.com |  |
| 53 | `hd-600-us-s22` | Sennheiser MOMENTUM 5 Wireless Adaptive Noise-Cancelling Headphones | brand Sennheiser; GTIN 810091274163; Color=Bronze; www.audio46.com |  |

## instant-pot-duo (kitchen-appliances, CA, dev)

Instant Pot Duo V5 7-in-1 electric pressure cooker, 6 quart (not Duo Plus, Duo Crisp, Rio or Pro).

Target: brand **Instant Pot**, model **Duo V5 7-in-1**, MPN `112-0032-02`, GTIN `810028585201`, must have: capacity: 6 quart

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 54 | `instant-pot-duo-s20` | Instant Pot 7-in-1 Duo Wide Base Electric Pressure Cooker - 7.5 Qt - Black | brand INSTANT POT; MPN 113-1066-01; GTIN 810102263537; www.bestbuy.ca |  |
| 55 | `instant-pot-duo-s21` | Refurbished (Good) Instant Pot Duo V5 7-in-1 Pressure Cooker - 8QT 113-0059-02 | brand INSTANT POT; MPN 113-0059-02; GTIN 999004339035; condition refurbished; marketplace_seller; www.bestbuy.ca |  |
| 56 | `instant-pot-duo-s22` | Refurbished (Good) - Instant Pot RIO 7-in-1 Pressure Cooker - 6QT | brand INSTANT POT; MPN 112-0041-02; GTIN 999004631429; condition refurbished; marketplace_seller; www.bestbuy.ca |  |

## instant-pot-duo-plus-6qt (kitchen-appliances, US, dev)

Instant Pot Duo Plus multi-use pressure cooker, 6 quart, current version (112-0169-01).

Target: brand **Instant Pot**, model **Duo Plus 9-in-1**, MPN `112-0169-01`, GTIN `810028585171`, must have: capacity: 6 quart

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 57 | `instant-pot-duo-plus-6qt-s14` | Instant Pot® Duo™ 6QT Multi-Use Pressure Cooker | brand Instant Pot; MPN 112-0170-01; www.instantpot.com |  |
| 58 | `instant-pot-duo-plus-6qt-s15` | Instant Pot® 4, 5 & 6 QT Color Sealing Ring, 2-Pack | brand Instant Pot; MPN 211-0005-01; GTIN 853084004316; www.instantpot.com |  |
| 59 | `instant-pot-duo-plus-6qt-s16` | Instant Pot® Duo™ 8QT Multi-Use Pressure Cooker | brand Instant Pot; MPN 113-0059-01; GTIN 810028585218; www.instantpot.com |  |

## k1c (3d-printing, DE, dev)

Creality K1C 3D printer, 2025 version, printer alone.

Target: brand **Creality**, model **K1C (2025 Version)**, MPN `1001060049`, GTIN `6977726811729`

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 60 | `k1c-s11` | K1 Max Glatte PEI-Montageplatte 315×310 mm | brand Creality DE; de.store.creality.com |  |
| 61 | `k1c-s12` | K1/Ender-Serie “Unicorn” Schnellwechsel-Düse | brand Creality DE; Menge=1PC (0,4mm); de.store.creality.com |  |
| 62 | `k1c-s13` | K1/Ender-Serie “Unicorn” Schnellwechsel-Düse | brand Creality DE; Menge=4PCS (0,4 mm *2 & 0,6 mm *1 & 0,8 mm *1); de.store.creality.com |  |

## keurig-k-mini (kitchen-appliances, CA, dev)

Keurig K-Mini single-serve coffee maker, black (not K-Mini Plus or K-Mini Mate).

Target: brand **Keurig**, model **K-Mini**, GTIN `611247373590`, must have: colour: Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 63 | `keurig-k-mini-s04` | Keurig® K-Mini Mate™ Plus Single Serve K-Cup Pod Coffee Maker, Wild Orchid | brand KEURIG; MPN N/A; GTIN 460629307964; marketplace_seller; www.bestbuy.ca |  |
| 64 | `keurig-k-mini-s05` | Keurig® K-Mini Mate™ Plus Single Serve K-Cup Pod Coffee Maker, Warm Stone | brand KEURIG; MPN N/A; GTIN 460629289482; marketplace_seller; www.bestbuy.ca |  |
| 65 | `keurig-k-mini-s06` | Keurig® K-Mini Mate™ Plus Single Serve K-Cup Pod Coffee Maker, Warm Stone | brand KEURIG; MPN N/A; GTIN 460798606226; marketplace_seller; www.bestbuy.ca |  |

## keychron-k2-us (computing, US, held_out)

Keychron K2 wireless mechanical keyboard, Version 2, white backlight, US layout (variant K2-A3Z).

Target: brand **Keychron**, model **K2 (Version 2)**, MPN `K2-A3Z`, GTIN `4897115553059`, must have: layout: US ANSI; backlight: white backlight; version: Version 2

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 66 | `keychron-k2-us-s14` | Keychron K2 HE Wireless Magnetic Switch Custom Keyboard - Resin Edition | brand K HE Series; MPN K2H-F1R; GTIN 4894979044693; Color=Resin Edition, Switches=Gateron Double-Rail Magnetic Nebula Switch; www.keychron.com |  |
| 67 | `keychron-k2-us-s18` | Keychron K2 Ultra 8K Wireless Custom Mechanical Keyboard | brand K Ultra series; MPN K2U-J3; GTIN 4894979058010; Type=Fully Assembled, Color=Black, Switch Type=Keychron Apex Switch - Brown; www.keychron.com |  |
| 68 | `keychron-k2-us-s19` | Keychron K2 Ultra 8K Wireless Custom Mechanical Keyboard | brand K Ultra series; MPN K2U-J1; GTIN 4894979058003; Type=Fully Assembled, Color=Black, Switch Type=Keychron Apex Switch - Red; www.keychron.com |  |

## kobra-3-max-v2-combo-de (3d-printing, DE, dev)

Anycubic Kobra 3 Max V2 Combo (4 colours, with ACE 2 Pro), no filament or add-on bundle.

Target: brand **Anycubic**, model **Kobra 3 Max V2 Combo**, must have: configuration: Kobra 3 Max V2 with the 4-colour ACE 2 Pro (Combo), no extra bundle items; filament: none included

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 69 | `kobra-3-max-v2-combo-de-s05` | Anycubic Kobra 3 Max V2 Combo | brand ANYCUBIC; GTIN 16204000737251; Inklusive Maschine=Kobra 3 Max V2 Combo (4 Farben), Inklusive Filament=Keine; de.anycubic3d.com |  |
| 70 | `kobra-3-max-v2-combo-de-s11` | Anycubic doppelseitige 3D-Effektplatte | brand ANYCUBIC; Kompatible 3D Drucker=Kobra X, KOMBINATION=Oktagramm + Diamantoberfläche; de.anycubic3d.com |  |

## kobra-x-combo-us (3d-printing, US, dev)

Anycubic Kobra X Combo (7 colours), without add-on bundles.

Target: brand **Anycubic**, model **Kobra X Combo**, GTIN `16204000737145`, must have: configuration: Kobra X with the 7-colour multi-colour unit (Combo)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 71 | `kobra-x-combo-us-s10` | Anycubic Kobra S1 ACE 2 Pro Combo | brand ANYCUBIC; Include Machine=Kobra S1 ACE 2 Pro Combo (4 colors), Include Filament=None, Region & Plug Type=EU Plug; store.anycubic.com |  |
| 72 | `kobra-x-combo-us-s11` | Anycubic Kobra 3 Max V2 | brand ANYCUBIC; GTIN 16204000737282; Include Machine=Kobra 3 Max V2 (without ACE 2 Pro), Include Filament=None, Region & Plug Type=Other; store.anycubic.com |  |

## laifen-neo-de (personal-care, DE, dev)

Laifen Neo high-speed hair dryer, black (not Neo Special, not a bundle).

Target: brand **Laifen**, model **Neo**, must have: colour: Schwarz (black)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 73 | `laifen-neo-de-s05` | Laifen P3 Elektrorasierer | brand Laifen-DE; Version=Standard Version, Color=Black; de.laifentech.com |  |
| 74 | `laifen-neo-de-s06` | Laifen P3 Elektrorasierer | brand Laifen-DE; Version=Standard Version, Color=White; de.laifentech.com |  |
| 75 | `laifen-neo-de-s07` | Reiseetui für Laifen Wave-Zahnbürste | brand Laifen-DE; Color=White; de.laifentech.com |  |

## laifen-swift-us (personal-care, US, dev)

Laifen Swift high-speed hair dryer, Matte Black (not Swift Special or Swift 4).

Target: brand **Laifen**, model **Swift**, GTIN `6976973852103`, must have: colour: Matte Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 76 | `laifen-swift-us-s14` | Laifen Swift 4 High-Speed Hair Dryer | brand Laifen-US; GTIN 6942590704613; Color=Polished Titanium; us.laifentech.com |  |
| 77 | `laifen-swift-us-s15` | Laifen Air Pro High-Speed Hair Dryer | brand Laifen-US; GTIN 6942590703821; Color=Matt Black; us.laifentech.com |  |
| 78 | `laifen-swift-us-s16` | Laifen Air Pro High-Speed Hair Dryer | brand Laifen-US; GTIN 6942590703814; Color=Sand Gold; us.laifentech.com |  |

## liberty-4-nc-us (audio, US, held_out)

Soundcore (Anker) Liberty 4 NC noise-cancelling earbuds, Velvet Black.

Target: brand **Soundcore**, model **Liberty 4 NC**, MPN `A3947Z11`, GTIN `194644126124`, must have: colour: Velvet Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 79 | `liberty-4-nc-us-s20` | Liberty 5 (Refurbished) | brand soundcoreusa; MPN A3957Z11-F0; GTIN 194644269845; Color=Black; condition refurbished; us.soundcore.com |  |
| 80 | `liberty-4-nc-us-s22` | Liberty 4 NC Eartips Kit - Black | brand soundcoreus; MPN A3947Z11-94; Color=Black; us.soundcore.com |  |
| 81 | `liberty-4-nc-us-s23` | Liberty 4 NC Eartips Kit - Black | brand soundcoreus; MPN A3947Z21-94; Color=White; us.soundcore.com |  |

## liberty-4-pro-de (audio, DE, held_out)

Soundcore (Anker) Liberty 4 Pro noise-cancelling earbuds, glossy black, single pair.

Target: brand **Soundcore**, model **Liberty 4 Pro**, MPN `A3954GF1`, GTIN `194644297237`, must have: colour: Schwarz Hochglanz (glossy black)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 82 | `liberty-4-pro-de-s04` | Liberty Buds \| Kabellose Semi-in-Ear Earbuds mit ANC | brand Soundcore; MPN D1200G21; GTIN 194644242763; Farbe=Weiß; de.soundcore.com |  |
| 83 | `liberty-4-pro-de-s05` | Liberty 5｜Dolby 3D-Audio True-Wireless Earbuds | brand Soundcore; MPN A3957G11; GTIN 194644230821; color=Tinten-Schwarz; de.soundcore.com |  |
| 84 | `liberty-4-pro-de-s07` | soundcore Liberty 4 NC Ladecase | brand Soundcore; MPN A3947Z11-96; Color=Schwarz; de.soundcore.com |  |

## makita-ddf487-de (power-tools, DE, held_out)

Makita DDF487Z 18 V cordless drill/driver, bare tool without case.

Target: brand **Makita**, model **DDF487Z**, MPN `DDF487Z`, GTIN `0088381736558`, must have: kit: tool only, no battery, charger or case

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 85 | `makita-ddf487-de-s08` | DDF343SYX3 Akku Bohrschrauber 14.4 Volt 1.5 AH Li-ion + 59 tlg. Zubehörset | GTIN 0088381689755; www.toolnation.de |  |
| 86 | `makita-ddf487-de-s20` | D-07945 Makita Wendemesser HM 82 mm | GTIN 0088381181600; www.toolnation.de |  |
| 87 | `makita-ddf487-de-s21` | F-33652 Niete 40mm Verzinkt für Makita AT450H | GTIN 0088381294218; www.toolnation.de |  |

## makita-drill-ca (power-tools, CA, held_out)

Makita DDF453Z 18V LXT 1/2 in cordless drill/driver, bare tool (Canadian part DDF453ZQ).

Target: brand **Makita**, model **DDF453Z**, MPN `DDF453ZQ`, GTIN `088381659734`, must have: kit: tool only

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 88 | `makita-drill-ca-s10` | Makita E-02543 16-Inch Segmented Diamond Blade for Dual-Purpose Concrete and Asphalt Cutting | brand MAKITA; MPN E-02543; GTIN 088381557245; marketplace_seller; www.bestbuy.ca |  |
| 89 | `makita-drill-ca-s11` | Makita 18V LXT Lantern Radio with XPT, 260 Lumens Lantern, AM/FM Radio, Push-Button Tuner, Durable Jobsite Design, Tool Only (DMR055) | brand MAKITA; MPN DMR055; GTIN 088381763479; marketplace_seller; www.bestbuy.ca |  |
| 90 | `makita-drill-ca-s12` | Makita 8-1/2 in. Sliding Compound Mitre Saw with LED Cut Line Guide, 12 in. Cut Capacity at 90°, Soft Start, Direct Drive Motor (LS0816F) | brand MAKITA; MPN LS0816F; GTIN 197050001627; marketplace_seller; www.bestbuy.ca |  |

## makita-xfd131 (power-tools, US, held_out)

Makita XFD131 18V LXT brushless 1/2 in driver-drill kit (3.0 Ah).

Target: brand **Makita**, model **XFD131**, MPN `XFD131`, GTIN `088381866347`, must have: kit: driver-drill kit with 3.0 Ah battery and charger

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 91 | `makita-xfd131-s18` | DeWalt XTREME 12V MAX* Brushless 3/8&quot; Drill/Driver Kit DCD701J1 | MPN DW-DCD701J1; www.ohiopowertool.com |  |
| 92 | `makita-xfd131-s19` | Bosch Power Tools 18V Drill/Driver with 5-In-1 Flexiclick® System and (2) CORE18V® 4 Ah Advanced Power Battery GSR18V-800FCB24 | MPN GSR18V-800FCB24; www.ohiopowertool.com |  |
| 93 | `makita-xfd131-s22` | Makita 18V LXT Lithium-Ion Brushless Cordless 1/2-in. Hammer Driver-Drill Kit, 5.0Ah (XPH14T) | brand Makita; GTIN 088381729314; www.toolnut.com |  |

## milwaukee-2953-20 (power-tools, US, dev)

Milwaukee M18 FUEL 1/4 in hex impact driver 2953-20, bare tool (not a kit, not ONE-KEY, not SURGE).

Target: brand **Milwaukee**, model **M18 FUEL 1/4 in Hex Impact Driver**, MPN `2953-20`, GTIN `045242637867`, must have: kit: tool only

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 94 | `milwaukee-2953-20-s11` | Milwaukee M12 Heated Toughshell Jacket Black, Bare M100B | MPN CFG-M100B-20; www.ohiopowertool.com |  |
| 95 | `milwaukee-2953-20-s18` | Milwaukee M12 Subcompact Brushless 1/4&quot; Hex Impact Driver Kit 3450-22 | MPN 3450-22; www.ohiopowertool.com |  |
| 96 | `milwaukee-2953-20-s19` | Milwaukee M12 FUEL SURGE 1/4-in. Hex Hydraulic Impact Driver, Tool Only (2551-20) | brand Milwaukee; GTIN 045242536672; www.toolnut.com |  |

## mx-master-3s (computing, CA, dev)

Logitech MX Master 3S wireless mouse, graphite/black, standard edition.

Target: brand **Logitech**, model **MX Master 3S**, MPN `910-006556`, GTIN `097855174819`, must have: colour: Graphite (black); edition: standard (not for Business, not for Mac)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 97 | `mx-master-3s-s20` | MX Keys S Bluetooth Combo - MX Keys S Keyboard, MX Master 3S Mouse, MX Palm Rest | brand LOGITECH; MPN 920-012274; GTIN 097855189936; www.bestbuy.ca |  |
| 98 | `mx-master-3s-s21` | Logitech MX Keys S Bluetooth Combo with MX Keys S Keyboard, MX Master 3S Mouse, and MX Palm Rest | brand LOGITECH; MPN 7240531; GTIN 5053243176204; marketplace_seller; www.bestbuy.ca |  |
| 99 | `mx-master-3s-s22` | Logitech MX Master 4 Bluetooth Optical Mouse w/ Advanced Performance Haptic Feedback - Pale Grey | brand LOGITECH; MPN 910-007559; GTIN 097855207579; www.bestbuy.ca |  |

## mx-master-3s-de (computing, DE, dev)

Logitech MX Master 3S wireless mouse, graphite, standard edition (EU part number).

Target: brand **Logitech**, model **MX Master 3S**, MPN `910-006559`, GTIN `5099206103726`, must have: colour: Graphite; edition: standard (not for Business, not for Mac)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 100 | `mx-master-3s-de-s01` | Logitech MX Master 3S for Business, Maus | brand Logitech; MPN 910-006582; GTIN 5099206107885; www.alternate.de |  |
| 101 | `mx-master-3s-de-s02` | Logitech MX Master 4, Maus | brand Logitech; MPN 910-007562; GTIN 5099206133082; www.alternate.de |  |
| 102 | `mx-master-3s-de-s03` | Logitech MX Anywhere 3S, Maus | brand Logitech; MPN 910-006929; GTIN 5099206111721; www.alternate.de |  |

## ninja-af101 (kitchen-appliances, CA, held_out)

Ninja AF101C 4-quart air fryer (Canadian model of the AF101).

Target: brand **Ninja**, model **AF101C**, MPN `AF101C`, must have: capacity: 4 qt (3.8 L)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 103 | `ninja-af101-s10` | Ninja Crispi Pro 6-in-1 Countertop Glass Air Fryer - 5.7L (6QT) - Cyberspace | brand NINJA; MPN AS101CCY; GTIN 622356714822; www.bestbuy.ca |  |
| 104 | `ninja-af101-s18` | Ninja Flip Toaster 8-in-1 Oven & Air Fryer - 13.3L / 14.1 Qt - Stainless Steel | brand NINJA; MPN SP151C; GTIN 622356634199; www.bestbuy.ca |  |
| 105 | `ninja-af101-s19` | Ultima Cosa Presto Grande 5.5L Air Fryer | www.visions.ca |  |

## ninja-creami-ca (kitchen-appliances, CA, held_out)

Ninja CREAMi ice cream maker NC301C (not CREAMi Deluxe, XL or Swirl).

Target: brand **Ninja**, model **CREAMi NC301C**, MPN `NC301C`, GTIN `622356571265`

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 106 | `ninja-creami-ca-s04` | Ninja CREAMi Swirl 0.47L Ice Cream Maker | brand NINJA; MPN NC701C; GTIN 622356641012; www.bestbuy.ca |  |
| 107 | `ninja-creami-ca-s05` | NINJA PROCHEF WIRELESS THERMOMETER | www.visions.ca |  |
| 108 | `ninja-creami-ca-s06` | Silicone Mat for Ninja Creami NC701 - Non-Slip, Drip-Proof Mat Set of 2 with Raised Patterns, Accessories for Ninja Swirl & Creami Pint Containers | brand MYACUC; MPN 730553069130; GTIN 730553069130; marketplace_seller; www.bestbuy.ca |  |

## oneblade-ca (personal-care, CA, dev)

Philips OneBlade 360 Face + Body hybrid trimmer/shaver (QP2834/23), not a holiday bundle and not replacement blades.

Target: brand **Philips**, model **OneBlade 360 Face + Body**, MPN `QP2834/23`, GTIN `075020112477`

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 109 | `oneblade-ca-s01` | Philips , OneBlade 360 Pro Face + Body Hybrid Electric Trimmer and Shaver , Black | brand PHILIPS; MPN QP6542/65; GTIN 075020118363; marketplace_seller; www.bestbuy.ca |  |
| 110 | `oneblade-ca-s02` | Purchase 2 Quick Set 3 Replacement Blades for OneBlade – Stainless Steel | brand PURCHASE 2 QUICK; perlastore.ca |  |
| 111 | `oneblade-ca-s18` | Philips OneBlade 360 Wet & Dry Face Trimmer/Shaver (QP2724/22) | brand Philips; MPN QP2724/22; GTIN 075020106971; www.bestbuy.ca |  |

## oral-b-io5 (personal-care, CA, held_out)

Oral-B iO Series 5 rechargeable electric toothbrush, black, single handle.

Target: brand **Oral-B**, model **iO Series 5**, GTIN `069055133026`, must have: colour: Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 112 | `oral-b-io5-s20` | Oral-B iO Series 10 Rechargeable Electric Toothbrush - Black | brand Oral-B; MPN iO M10.4B4.2A; GTIN 069055135075; www.bestbuy.ca |  |
| 113 | `oral-b-io5-s21` | Oral-B FlossAction Replacement Heads – 5 Pack | brand Oral-B; GTIN 069055126523; perlastore.ca |  |
| 114 | `oral-b-io5-s22` | Oral-B iO Series 6 Smart Electric Toothbrush - Grey Opal | brand Oral-B; MPN iOM6.1A6.1K; GTIN 069055131053; www.bestbuy.ca |  |

## p1s-combo (3d-printing, CA, dev)

Bambu Lab P1S Combo: the P1S 3D printer with the AMS multi-colour unit.

Target: brand **Bambu Lab**, model **P1S Combo**, GTIN `6937285506542`, must have: configuration: P1S printer with AMS (Combo)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 115 | `p1s-combo-s15` | Bambu Lab Complete Hotend Assembly for P1S/P1P | brand Bambu Lab; GTIN 6975337031802; Nozzle Type=Hardened Steel 0.4mm; 3dprintingcanada.com |  |
| 116 | `p1s-combo-s18` | 2510 5V Axial Fan Replacement for Bambu Lab X1C / P1P / P1S (Multiple Types) | brand NA; Printer Model=P1 Series; west3d.com |  |
| 117 | `p1s-combo-s19` | Bambu Lab Glass Cover Plate - X1 Series and P1S | brand Bambu Lab; GTIN 6975337030942; digitmakers.ca |  |

## polylite-pla-us (3d-printing, US, dev)

Polymaker PolyLite PLA filament, black, 1.75 mm, 1 kg (not PolyLite PLA Pro, LW-PLA, Silk or Panchroma).

Target: brand **Polymaker**, model **PolyLite PLA**, must have: colour: Black; diameter: 1.75 mm; weight: 1 kg

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 118 | `polylite-pla-us-s10` | PolyLite™ PC | brand Polymaker; GTIN 6938936712688; Color=Transparent, Diameter=1.75mm, Net Weight=3kg; us.polymaker.com |  |
| 119 | `polylite-pla-us-s11` | Polymaker™ HT-PLA Pro | brand Polymaker; Color=Black, Net Weight=1kg; us.polymaker.com |  |
| 120 | `polylite-pla-us-s13` | PolyLite™ Metallic PLA Pro | brand Polymaker; GTIN 6938936714033; Color=Metallic Black, Net Weight=1kg; us.polymaker.com |  |

## polyterra-pla (3d-printing, CA, held_out)

Polymaker PolyTerra PLA filament, Charcoal Black, 1.75 mm, 1 kg spool.

Target: brand **Polymaker**, model **PolyTerra PLA**, GTIN `6938936708209`, must have: colour: Charcoal Black; diameter: 1.75 mm; weight: 1 kg

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 121 | `polyterra-pla-s10` | PolyTerra™ Dual PLA - Various Colors (1.75mm 1000g) | brand Polymaker; GTIN 6938936713388; Color=Camouflage (Dark Green-Brown); digitmakers.ca |  |
| 122 | `polyterra-pla-s12` | Polymaker Panchroma Gradient PLA 3D Printer Filament 1KG 1.75mm | brand Polymaker; GTIN 57306324; Color=Fall; west3d.com |  |
| 123 | `polyterra-pla-s13` | Polymaker Panchroma Matte PLA | brand Polymaker; GTIN 6938936714927; Color=Charcoal Black; voxelfactory.com |  |

## raspberry-pi-5 (computing, US, held_out)

Raspberry Pi 5 single-board computer, 8 GB RAM, board only.

Target: brand **Raspberry Pi**, model **Raspberry Pi 5**, GTIN `5056561803326`, must have: memory: 8 GB; configuration: board only (no kit)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 124 | `raspberry-pi-5-s04` | Raspberry Pi Compute Module 5 Lite - 8GB RAM | www.sparkfun.com |  |
| 125 | `raspberry-pi-5-s05` | Vilros Raspberry Pi 5 Basic Starter Kit | brand Vilros; GB Capacity=1GB, Case Style=Aluminum Alloy W/ Passive+ Active Cooling; www.vilros.com |  |
| 126 | `raspberry-pi-5-s07` | Raspberry Pi 5 Desktop Kit | brand Raspberry Pi; Size=2GB; www.vilros.com |  |

## raspberry-pi-5-de (computing, DE, held_out)

Raspberry Pi 5 single-board computer, 8 GB RAM, board only (the same item as the US product raspberry-pi-5, captured in German stores).

Target: brand **Raspberry Pi**, model **Raspberry Pi 5**, MPN `SC1112`, GTIN `5056561803326`, must have: memory: 8 GB; configuration: board only (no kit)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 127 | `raspberry-pi-5-de-s20` | Raspberry Pi 400 Personal Computer Kit & Unit | brand Raspberry Pi; GTIN 633696493025; Ausführung=Raspberry Pi 400 Personal Computer Kit, Ländervariante=Deutsch (DE); buyzero.de |  |
| 128 | `raspberry-pi-5-de-s21` | BerryBase Raspberry Pi 5 8GB, Active Cooler Starter Kit mit Aluminium Gehäuse | brand BerryBase; MPN RPI5-8-ACAC; www.berrybase.de |  |
| 129 | `raspberry-pi-5-de-s22` | Raspberry Pi Zero W & WH | brand Raspberry Pi; GTIN 707565827164; Ausführung=Ohne Stiftleiste (Pi Zero W); buyzero.de |  |

## remington-f5-us (personal-care, US, dev)

Remington F5 Power Series foil shaver (F5-5800).

Target: brand **Remington**, model **F5 Power Series Foil Shaver**, MPN `F5-5800`, GTIN `074590518665`

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 130 | `remington-f5-us-s01` | F5 Power Series Shaver | brand Remington; MPN F5-5800BCDN; GTIN 074590518665; www.remingtonproducts.com |  |
| 131 | `remington-f5-us-s02` | Foil Shaver Attachment for WPG4020 & WPG4030 | brand Remington; MPN RP00253; www.remingtonproducts.com |  |
| 132 | `remington-f5-us-s03` | Shaver Replacement Head | brand Remington; MPN SPF-XF50A; www.remingtonproducts.com |  |

## satechi-hub-us (computing, US, dev)

Satechi USB-C Multiport Adapter 8K with Ethernet V3, space gray.

Target: brand **Satechi**, model **USB-C Multiport Adapter 8K With Ethernet V3**, GTIN `879961008178`, must have: colour: Space Gray

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 133 | `satechi-hub-us-s01` | USB-C Multiport MX Adapter | brand Satechi; GTIN 810086360130; www.satechi.net |  |
| 134 | `satechi-hub-us-s08` | Aluminum USB-C to USB-A 3.0 Adapter | brand Satechi; GTIN 879961005412; Color=Silver; www.satechi.net |  |
| 135 | `satechi-hub-us-s09` | 7-in-1 USB-C Slim Multiport Adapter with Ethernet | brand Satechi; GTIN 810086361496; Color=Space Grey; www.satechi.net |  |

## saturn-4-ultra (3d-printing, CA, dev)

ELEGOO Saturn 4 Ultra (12K) resin 3D printer, printer alone.

Target: brand **ELEGOO**, model **Saturn 4 Ultra**, must have: resolution: 12K

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 136 | `saturn-4-ultra-s10` | Elegoo Saturn 2 / 3 / 4 and 4 Ultra PFA Film (5 Pack) - Protect Your 3D Prints | brand ELEGOO; GTIN 97379284; west3d.com |  |
| 137 | `saturn-4-ultra-s11` | LCD Screen for Saturn 4 & Saturn 4 Ultra | brand ELEGOO; ca.elegoo.com |  |

## saturn-4-ultra-16k-de (3d-printing, DE, dev)

ELEGOO Saturn 4 Ultra 16K resin 3D printer, printer alone (no wash/cure station or resin bundle).

Target: brand **ELEGOO**, model **Saturn 4 Ultra 16K**, GTIN `6932704932582`, must have: configuration: printer alone

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 138 | `saturn-4-ultra-16k-de-s14` | LCD-Bildschirm für Saturn 4 Ultra 16K | brand ELEGOO; de.elegoo.com |  |
| 139 | `saturn-4-ultra-16k-de-s18` | Saturn 4 Ultra | brand ELEGOO; GTIN 6932704932575; de.elegoo.com |  |

## sn850x-2tb (computing, CA, dev)

WD_BLACK SN850X 2 TB NVMe M.2 SSD without heatsink.

Target: brand **Western Digital**, model **WD_BLACK SN850X**, MPN `WDS200T2X0E`, GTIN `718037891408`, must have: capacity: 2 TB; heatsink: without heatsink

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 140 | `sn850x-2tb-s01` | Western Digital WD_BLACK SN850X 2TB SSD M.2 2280 PCIe 7300MB/s Black Internal Hard Drive (WDS200T2X0E) | brand WD_BLACK; MPN WDS200T2X0E; GTIN 0718037891408; marketplace_seller; www.bestbuy.ca |  |
| 141 | `sn850x-2tb-s08` | WD SN850X 1TB Internal SSD PCIe Gen 4 x4 NVMe with Heatsink for PS5 & Desktops | brand WESTERN DIGITAL; MPN WDBB9H0010BNC-WRSN; GTIN 619659193065; www.bestbuy.ca |  |
| 142 | `sn850x-2tb-s09` | WD SN850X 2TB Internal SSD PCIe Gen 4 x4 NVMe with Heatsink for PS5 & Desktops | brand WESTERN DIGITAL; MPN WDBB9H0020BNC-WRSN; GTIN 619659193072; www.bestbuy.ca |  |

## sonicare-4100 (personal-care, CA, dev)

Philips Sonicare ProtectiveClean 4100 electric toothbrush, black (HX3681/24).

Target: brand **Philips Sonicare**, model **ProtectiveClean 4100**, MPN `HX3681/24`, GTIN `075020100764`, must have: colour: Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 143 | `sonicare-4100-s04` | Philips Sonicare 6500 Series Electric Toothbrush HX7413/07 – 9 Modes, Pressure Sensor, Navy Blue | brand Philips Sonicare; GTIN 075020114556; perlastore.ca |  |
| 144 | `sonicare-4100-s05` | Philips Sonicare 4100 Electric Toothbrush (HX3681/24) - Black | brand PHILIPS; MPN HX3681/24; GTIN 075020100764; www.bestbuy.ca |  |
| 145 | `sonicare-4100-s07` | Philips Sonicare Optimal Clean Rechargeable Electric Toothbrush, 2-pack | brand PHILIPS; MPN 2023; GTIN 075020104557; marketplace_seller; www.bestbuy.ca |  |

## soundcore-space-q45 (audio, CA, held_out)

Soundcore (Anker) Space Q45 noise-cancelling headphones, black.

Target: brand **Soundcore**, model **Space Q45**, MPN `A3040011`, GTIN `194644105235`, must have: colour: Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 146 | `soundcore-space-q45-s18` | Refurbished Space One \| Active Noise Cancelling Headphones | brand soundcoreca; MPN A3035J11-F0; GTIN 194644127015; Color=Jet Black; condition refurbished; ca.soundcore.com |  |
| 147 | `soundcore-space-q45-s21` | soundcore Liberty 5 Pro Ear Tips Kit -- Color White, Blue, Pink | brand Soundcore; MPN D1203Z31-94; Color=Blue; ca.soundcore.com |  |
| 148 | `soundcore-space-q45-s22` | Refurbished (Good) - Soundcore by Anker Space One Over-Ear Sound Isolating Bluetooth Headphones - Black | brand SOUNDCORE; MPN A3035Z11-5; GTIN 999004283178; condition refurbished; marketplace_seller; www.bestbuy.ca |  |

## space-2-us (audio, US, dev)

Soundcore (Anker) Space 2 noise-cancelling headphones, Jet Black (not Space 2 Pro).

Target: brand **Soundcore**, model **Space 2**, MPN `D1402Z11`, GTIN `194644321956`, must have: colour: Jet Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 149 | `space-2-us-s18` | soundcore Space 2 \| Comfortable Noise Cancelling Headphones for All-Day Wear | brand Soundcore; MPN D1402Z11; GTIN 194644321956; Color=Jet Black; us.soundcore.com |  |
| 150 | `space-2-us-s22` | soundcore Sport X20 \| Comfortable In-Ear Sport Earbuds with Hook | brand soundcoreus; MPN A3968Z11; GTIN 194644186357; Color=Black; us.soundcore.com |  |
| 151 | `space-2-us-s23` | soundcore Sport X20 \| Comfortable In-Ear Sport Earbuds with Hook | brand soundcoreus; MPN A3968Z21; GTIN 194644193614; Color=White; us.soundcore.com |  |

## space-one-de (audio, DE, dev)

Soundcore (Anker) Space One noise-cancelling headphones, black (not Space One Pro).

Target: brand **Soundcore**, model **Space One**, MPN `A3035G11`, GTIN `194644127015`, must have: colour: Black (Nachtschwarz)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 152 | `space-one-de-s20` | Reise-Etui für Space One Pro | brand soundcorede; MPN A3062Z11-97; GTIN 194644037307; Color=Grau; de.soundcore.com |  |
| 153 | `space-one-de-s21` | Soundcore Space A40 Ohrstöpsel-Kit - Schwarz | brand Soundcore; MPN A3936011-94; de.soundcore.com |  |
| 154 | `space-one-de-s22` | soundcore Kopfhörer-Case | brand soundcorede; MPN T00Z2011; GTIN 194644197155; Color=Schwarz; de.soundcore.com |  |

## sunlu-pla-plus (3d-printing, US, held_out)

SUNLU PLA+ (PLA Plus) filament, black, 1.75 mm, 1 kg spool.

Target: brand **SUNLU**, model **PLA+**, must have: material: PLA+ (PLA Plus), not PLA+ 2.0, Silk or High Speed; colour: Black; diameter: 1.75 mm; weight: 1 kg

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 155 | `sunlu-pla-plus-s20` | SUNLU PLA New Color Collection, Fluorescent & Transparent Series 1.75mm 1KG | brand SUNLU Official Store; Shipment=Ship to USA, Material=PLA Fluorescent Series, Material/Color=Fluorescent Yellow; store.sunlu.com |  |
| 156 | `sunlu-pla-plus-s21` | PLA+(PLA Plus) 3KG Large Spool 3D Printer Filament 3KG | brand Affordable 3D Printing Filaments and Resins; Shipment=Ship to USA, Color=PLA+ Black; store.sunlu.com |  |
| 157 | `sunlu-pla-plus-s22` | PLA+(PLA Plus) 3KG Large Spool 3D Printer Filament 3KG | brand Affordable 3D Printing Filaments and Resins; Shipment=Ship to USA, Color=PLA+ White; store.sunlu.com |  |

## ugreen-nexode-65w-de (computing, DE, held_out)

UGREEN Nexode Pro 65 W 3-port GaN USB-C mini charger (EU plug), charger only.

Target: brand **UGREEN**, model **Nexode Pro USB-C Mini Ladegerät 65W 3-Port**, MPN `25261`, GTIN `6941876222612`, must have: power: 65 W; ports: 3

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 158 | `ugreen-nexode-65w-de-s01` | UGREEN x Honkai: Star Rail Nexode Air Mini-Ladegerät (65 W, GaN, USB-C-Kabel, TÜV-zertifiziert) | brand UGREEN DE; MPN 95437SR; de.ugreen.com |  |
| 159 | `ugreen-nexode-65w-de-s02` | UGREEN Nexode Desktop Ladegerät (200W, 8-Port, GaN) | brand UGREEN DE; MPN 55324; de.ugreen.com |  |
| 160 | `ugreen-nexode-65w-de-s03` | UGREEN Set-Angebot: 160W Ladegerät + 240W USB-C Kabel | brand UGREEN DE; MPN 65637＋65867; de.ugreen.com |  |

## ugreen-nexode-65w-us (computing, US, dev)

UGREEN Nexode 65W 3-port GaN travel charger with US/UK/EU plugs, charger only.

Target: brand **UGREEN**, model **Nexode 65W 3-Port Travel Charger**, MPN `90409`, GTIN `6957303894093`, must have: configuration: charger only (no cable)

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 161 | `ugreen-nexode-65w-us-s12` | UGREEN Nexode Air USB-C Charger (65W, GaN, Foldable Plug) | brand UGREEN US; MPN 35478; Color=Orange; us.ugreen.com |  |
| 162 | `ugreen-nexode-65w-us-s13` | UGREEN Nexode Air USB-C Charger (65W, GaN, Foldable Plug) | brand UGREEN US; MPN 75813; Color=Space Gray; us.ugreen.com |  |

## wf-1000xm5 (audio, CA, held_out)

Sony WF-1000XM5 truly wireless noise-cancelling earbuds, black.

Target: brand **Sony**, model **WF-1000XM5**, MPN `WF1000XM5/B`, GTIN `027242930391`, must have: colour: Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 163 | `wf-1000xm5-s10` | Refurbished (Excellent) - Sony WF-1000XM5 Truly Wireless Bluetooth Noise Cancelling Earbuds with Alexa - Black | brand SONY; MPN WF1000XM5/B; GTIN 726358898013; condition refurbished; marketplace_seller; www.bestbuy.ca |  |
| 164 | `wf-1000xm5-s11` | Sony WH-CH530 Headphones Mint | www.visions.ca |  |
| 165 | `wf-1000xm5-s13` | Refurbished (Good) - Sony WF1000XM5 In-Ear Noise Cancelling True Wireless Earbuds - Black | brand SONY; MPN WF1000XM5/B; GTIN 999004555770; condition refurbished; marketplace_seller; www.bestbuy.ca |  |

## wh-1000xm5 (audio, CA, dev)

Sony WH-1000XM5 wireless noise-cancelling headphones, black.

Target: brand **Sony**, model **WH-1000XM5**, MPN `WH1000XM5/B`, GTIN `027242923232`, must have: colour: Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 166 | `wh-1000xm5-s04` | Sony in Ear Headphones | www.visions.ca |  |
| 167 | `wh-1000xm5-s05` | Sony WH-1000XM5 Noise-Canceling Wireless Over-Ear Headphones (Black) | brand SONY; MPN SOWH1000XM5; GTIN 758835611075; marketplace_seller; www.bestbuy.ca |  |
| 168 | `wh-1000xm5-s06` | Sony WH-CH530 Headphones Mint | www.visions.ca |  |

## wh-1000xm5-us (audio, US, dev)

Sony WH-1000XM5 wireless noise-cancelling headphones, black (the same item as the CA product wh-1000xm5, captured in US stores).

Target: brand **Sony**, model **WH-1000XM5**, MPN `WH1000XM5/B`, GTIN `027242923232`, must have: colour: Black

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 169 | `wh-1000xm5-us-s18` | Strauss & Wagner Earpad Covers for Sony WH-1000XM5 - Silicone | brand Strauss & Wagner; GTIN 609788732983; Color=Black; www.audio46.com |  |
| 170 | `wh-1000xm5-us-s21` | Strauss & Wagner Dakar 3.5mm to L-Shape 3.5mm Coiled Headphone Cable With Microphone for SONY WH-1000XM3/XM4/XM5/XM6, Skullcandy Crusher/HESH 2.0, Philips SHP9500/9600 | brand Strauss & Wagner; GTIN 609788730460; www.audio46.com |  |
| 171 | `wh-1000xm5-us-s22` | Strauss & Wagner Micera 3.5mm TRRS to 3.5mm TRS Headphone Cable with Boom Microphone & PC Audio/Mic Splitter for Sony MDR-1000X, WH-H800, WH-1000XM Series & More | brand Strauss & Wagner; GTIN 604634129160; www.audio46.com |  |

## wmf-lono-kettle-de (kitchen-appliances, DE, dev)

WMF Lono electric kettle, 1.6 litre (not Lono Silk, not the glass kettle, not the tea kettle).

Target: brand **WMF**, model **Lono Wasserkocher 1,6 l**, must have: capacity: 1.6 L

| # | Snapshot | Listing title | Listing fields | Your relation |
|---|---|---|---|---|
| 172 | `wmf-lono-kettle-de-s04` | WMF Lono Waffeleisen Edition | www.wmf.com |  |
| 173 | `wmf-lono-kettle-de-s08` | WMF Lono Silk Espresso Siebträgermaschine | www.wmf.com |  |
| 174 | `wmf-lono-kettle-de-s09` | WMF Lono Glas-Wasserkocher 1.7 l | www.wmf.com |  |
