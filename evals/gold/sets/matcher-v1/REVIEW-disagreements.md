# Gold set v1: owner review, part 2 (agent disagreements)

Open this after part 1 (`REVIEW.md`). These are the 97 snapshots where the two agent passes (Claude Opus 5.5, `claude-opus-5-5`, prompt `gold-label.v1`) gave different relations. Pass A saw the product first and the listings in id order; pass B saw the listings first in reverse order and the product after. A third call saw both readings and decided; its answer is the primary label in `labels/a1.json` until you rule. Rows marked **(W)** are also on the blind worklist.

**Only the 25 rows marked ⚑ need a ruling** (orchestrator, 2026-11-23). In those, one pass said `exact`, `variant` or `bundle`, which changes whether a listing counts as the product. In the other 72, both passes call the listing a non-match and differ only on which kind (for example `other_line` versus `accessory_or_part`). Their tie-break stands unless you choose to change it.

**How to mark.** In the last column write the relation you rule (exact, variant, bundle, accessory_or_part, other_model, other_line, unknown), or "ok" to keep the primary. The orchestrator records a ruling that differs as an `adjudicated` label; the agreement figure is not changed by it.


## a1-mini (3d-printing, CA)

Target: brand **Bambu Lab**, model **A1 mini**, GTIN `6937285506146`, must have: configuration: printer only, without AMS lite

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `a1-mini-s05` | BIQU Panda BuildPlate CryoGrip Pro for Bambu X1/P1/A1/A1 mini/H2D/H2S/H2C Printers | brand BIQU; GTIN 1060000788; Type=Frostbite (Coarse Texture) 257mm*257mm - Bambu X1/P1/A1; digitmakers.ca | **other_line**: BIQU build plate, selected "257mm*257mm - Bambu X1/P1/A1", not A1 mini size; different brand. | **accessory_or_part**: "BIQU Panda BuildPlate CryoGrip Pro" is a build plate accessory. | **accessory_or_part**: "BIQU Panda BuildPlate CryoGrip Pro" is a build plate accessory; selected "257mm*257mm - Bambu X1/P1/A1" size, not the A1 mini printer. |  |
| `a1-mini-s06` | BIQU Panda BuildPlate CryoGrip Pro for Bambu X1/P1/A1/A1 mini/H2D/H2S/H2C Printers | brand BIQU; GTIN 1060000734; Type=Glacier (Fine Texture) 257mm*257mm - Bambu X1/P1/A1; digitmakers.ca | **other_line**: BIQU build plate, selected "257mm*257mm - Bambu X1/P1/A1", not A1 mini size; different brand. | **accessory_or_part**: "BIQU Panda BuildPlate CryoGrip Pro" is a build plate accessory. | **accessory_or_part**: "BIQU Panda BuildPlate CryoGrip Pro" is a build plate accessory; selected "Glacier 257mm*257mm - Bambu X1/P1/A1", not the A1 mini printer. |  |

## anker-737 (computing, CA)

Target: brand **Anker**, model **737 Power Bank (PowerCore 24K)**, MPN `A1289011`, must have: capacity: 24,000 mAh; colour: Black

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `anker-737-s09` | Anker Prime Charging Base (150W, 3 Ports) | brand beta-anker-us; MPN A1903H11; GTIN 194644239404; ca.anker.com | **other_line**: "Anker Prime Charging Base (150W)" is a charging base, not the power bank. | **accessory_or_part**: "Anker Prime Charging Base (150W)" is a charging accessory, not the power bank itself. | **other_line**: "Anker Prime Charging Base (150W, 3 Ports)", MPN A1903H11, is a separate Anker Prime charging product, not a 737 power bank accessory or part. |  |

## braun-series-9-ca (personal-care, CA)

Target: brand **Braun**, model **Series 9 PRO+ 9667cc**, MPN `9667cc`, GTIN `047400707122`

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| ⚑ `braun-series-9-ca-s06` (W) | Braun Series 9 PRO+ Wet/Dry Cordless Foil Shaver with PowerCase (9677cc) | brand BRAUN; MPN 9677CC; GTIN 047400707139; www.bestbuy.ca | **other_model**: "with PowerCase (9677cc)", MPN 9677CC, GTIN 047400707139 is the excluded 9677cc model. | **variant**: "Series 9 PRO+ ... with PowerCase (9677cc)", GTIN 047400707139: the 9677cc configuration, not 9667cc. | **other_model**: MPN "9677CC", GTIN 047400707139, "with PowerCase (9677cc)": the 9677cc model the target explicitly excludes, not 9667cc. |  |

## breville-barista-express-ca (kitchen-appliances, CA)

Target: brand **Breville**, model **Barista Express BES870**, MPN `BES870BSS1BCA1`, GTIN `021614055514`, must have: colour: Brushed Stainless Steel

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| ⚑ `breville-barista-express-ca-s16` | Breville Barista Express Semi-Automatic Espresso Machine Bean-to-Cup with Steam Wand | brand BREVILLE; MPN B00CH9QWOU; GTIN 999003196431; marketplace_seller; www.bestbuy.ca | **unknown**: "Barista Express" is named, but no colour is stated; MPN B00CH9QWOU is an ASIN and GTIN 999003196431 is non-standard. | **exact**: "Breville Barista Express Semi-Automatic Espresso Machine"; names model, colour unstated, no conflicting attribute. | **exact**: Title "Breville Barista Express Semi-Automatic Espresso Machine" names the target model; colour unstated, not a conflict; MPN is an ASIN and GTIN is non-standard, not contradicting. |  |

## brita-10-cup (kitchen-appliances, CA)

Target: brand **Brita**, model **Large 10 Cup Water Filter Pitcher (Smart Light)**, GTIN `060258507058`, must have: capacity: 10 cup

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `brita-10-cup-s08` (W) | Water Filter Replacement for Brita Water Pitchers and Dispensers, Classic 35557, Ob03, Mavea 107007 and More, Reduce Chlorine and Bad Taste(3 Pcs) | brand MYACUC; MPN 730553059964; GTIN 730553059964; marketplace_seller; www.bestbuy.ca | **accessory_or_part**: MYACUC "Water Filter Replacement for Brita Water Pitchers" is a third-party pitcher filter. | **other_line**: Brand MYACUC "Water Filter Replacement for Brita" is a third-party filter. | **accessory_or_part**: MYACUC "Water Filter Replacement for Brita Water Pitchers" (3 Pcs) is a consumable filter for the target's family, not the pitcher. |  |
| `brita-10-cup-s14` | Brita Water Filtration System Dispenser (636178CDN1) | brand BRITA; MPN 636178CDN1; GTIN 0060258350340; marketplace_seller; www.bestbuy.ca | **other_line**: "Brita Water Filtration System Dispenser (636178CDN1)" is a dispenser, not the 10-cup pitcher. | **other_model**: "Water Filtration System Dispenser (636178CDN1)" is a dispenser model, not the 10-cup Smart Light pitcher. | **other_model**: Brita "Water Filtration System Dispenser (636178CDN1)", GTIN 0060258350340 differs; same brand and filtration family, but a dispenser model, not the 10-cup pitcher. |  |

## dcd793d1 (power-tools, CA)

Target: brand **DEWALT**, model **DCD793D1**, MPN `DCD793D1`, must have: kit: drill/driver with one 2.0 Ah battery and charger

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `dcd793d1-s04` | Dewalt 20V MAX 3/8IN Compact Impact Wrench Baredewalt DCF923B | brand DEWALT; MPN DCF923B; GTIN 0885911700115; marketplace_seller; www.bestbuy.ca | **other_model**: "DCF923B" compact impact wrench, a different DEWALT 20V MAX tool. | **other_line**: "3/8IN Compact Impact Wrench ... DCF923B" is a different tool type. | **other_line**: "3/8IN Compact Impact Wrench ... DCF923B" is a different tool type, not a drill/driver. |  |
| `dcd793d1-s07` | DEWALT Planer Blades 3 pack - DW7342 | brand DEWALT; MPN DW7342; GTIN 880850596621; marketplace_seller; www.bestbuy.ca | **other_line**: "Planer Blades 3 pack - DW7342" is unrelated to the drill. | **accessory_or_part**: "Planer Blades 3 pack - DW7342" is a consumable part for a different tool. | **other_line**: "Planer Blades 3 pack - DW7342" are planer consumables, unrelated to the drill/driver family. |  |
| `dcd793d1-s12` | Open Box - DEWALT DCF885C1 20V MAX 1/4" Cordless Impact Driver Kit with 1.5Ah Battery & Charger - Yellow | brand DEWALT; MPN DCF885C1; GTIN 766619335987; condition open_box; marketplace_seller; www.bestbuy.ca | **other_model**: "DCF885C1" impact driver kit, not the DCD793 drill. | **other_line**: "DCF885C1 ... Impact Driver Kit" is a different tool type. | **other_line**: "DCF885C1 ... Impact Driver Kit" is a different tool type, not the DCD793 drill/driver. |  |
| `dcd793d1-s13` | DeWalt DCF850B Atomic 20V MAX 1/4" 3-Speed Brushless Impact Driver - Tool Only | brand DEWALT; MPN DCF850B; GTIN 885911758253; marketplace_seller; www.bestbuy.ca | **other_model**: "DCF850B Atomic" impact driver tool only, different model. | **other_line**: "DCF850B Atomic ... Impact Driver" is a different tool type. | **other_line**: "DCF850B Atomic ... Impact Driver - Tool Only" is a different tool type. |  |
| `dcd793d1-s14` | DEWALT 20V MAX XR 1/4 Inch Cordless Quiet Hydraulic Impact Driver, Bare Tool Only (DCF870B) | brand DEWALT; MPN DCF870B; GTIN 885911893015; marketplace_seller; www.bestbuy.ca | **other_model**: "DCF870B" hydraulic impact driver, different model. | **other_line**: "Hydraulic Impact Driver (DCF870B)" is a different tool type. | **other_line**: "Quiet Hydraulic Impact Driver ... (DCF870B)" is a different tool type. |  |
| `dcd793d1-s17` | DEWALT 20V MAX Cordless Impact Driver & 1/2-in Impact Wrench Combo Kit (DCK242D2) | brand DEWALT; MPN DCK242D2; GTIN 693070943355; marketplace_seller; www.bestbuy.ca | **other_model**: "Impact Driver & Impact Wrench Combo Kit (DCK242D2)", different model. | **other_line**: "Impact Driver & 1/2-in Impact Wrench Combo Kit (DCK242D2)" contains no drill/driver. | **other_line**: "Impact Driver & 1/2-in Impact Wrench Combo Kit (DCK242D2)" contains no drill/driver. |  |
| `dcd793d1-s19` | DEWALT 20V MAX Brushless Cordless Compact 3/8In Impact Wrench (DCF913B) (Tool Only) | brand DEWALT; MPN B09HW8XD6T; GTIN 885911769525; marketplace_seller; www.bestbuy.ca | **other_model**: "Compact 3/8In Impact Wrench (DCF913B)", different model. | **other_line**: "Compact 3/8In Impact Wrench (DCF913B)" is a different tool type. | **other_line**: "Compact 3/8In Impact Wrench (DCF913B)" is a different tool type. |  |

## dcf850 (power-tools, CA)

Target: brand **DEWALT**, model **DCF850B**, MPN `DCF850B`, GTIN `885911758253`, must have: kit: tool only

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `dcf850-s03` | Open Box - DEWALT DCK240C2 20V MAX Drill & Impact Driver Combo Kit with 2 Batteries, Charger & Bag - Yellow/Black | brand DEWALT; MPN DCK240C2; GTIN 766619336618; condition open_box; marketplace_seller; www.bestbuy.ca | **other_line**: "DCK240C2 ... Drill & Impact Driver Combo Kit" is a different combo product, not the DCF850. | **other_model**: MPN "DCK240C2" drill and impact driver combo kit is a different model. | **other_model**: MPN "DCK240C2" "Drill & Impact Driver Combo Kit with 2 Batteries" is a different 20V MAX impact driver kit, not DCF850B tool only. |  |
| `dcf850-s05` | Dewalt 20V MAX 3/8IN Compact Impact Wrench Baredewalt DCF923B | brand DEWALT; MPN DCF923B; GTIN 0885911700115; marketplace_seller; www.bestbuy.ca | **other_line**: "DCF923B" 3/8in compact impact wrench is a different tool line. | **other_model**: "3/8IN Compact Impact Wrench ... DCF923B" is a different model. | **other_line**: "3/8IN Compact Impact Wrench" MPN "DCF923B" is an impact wrench, a different tool line from the DCF850B impact driver. |  |
| `dcf850-s08` | DEWALT DCK240C2 1.3 Ah Drill Driver/Impact Driver Combo Kit, 20 V, Lithium-Ion | brand DEWALT; costcutindustrial.ca | **other_line**: "DCK240C2 ... Combo Kit" is a different combo product. | **other_model**: "DCK240C2 ... Drill Driver/Impact Driver Combo Kit" is a different kit model. | **other_model**: "DCK240C2 ... Drill Driver/Impact Driver Combo Kit" is a different impact driver kit model, not DCF850B tool only. |  |
| `dcf850-s10` (W) | NEW - DEWALT DCK283D2 20-Volt MAX Brushless Compact Drill + 3-speed Impact Driver Combo Kit (2-Tool) | brand DEWALT; MPN DCK283D2; GTIN 885911425360; marketplace_seller; www.bestbuy.ca | **other_line**: "DCK283D2 ... Combo Kit (2-Tool)" is a different combo product. | **other_model**: "DCK283D2 ... Drill + 3-speed Impact Driver Combo Kit" is a different kit model. | **other_model**: MPN "DCK283D2" "Drill + 3-speed Impact Driver Combo Kit" is a different kit model, not DCF850B tool only. |  |
| `dcf850-s14` | DEWALT DCK276D2 MAX Brushless Cordless Hammer Drill/Driver & Impact Driver 2-Tool Combo Kit, 20 V, Lithium-Ion | brand DEWALT; costcutindustrial.ca | **other_line**: "DCK276D2 ... 2-Tool Combo Kit" is a different combo product. | **other_model**: "DCK276D2 ... 2-Tool Combo Kit" is a different kit model. | **other_model**: "DCK276D2 ... Hammer Drill/Driver & Impact Driver 2-Tool Combo Kit" is a different kit model, not DCF850B. |  |
| `dcf850-s18` | DEWALT 20V MAX Brushless Cordless Compact 3/8In Impact Wrench (DCF913B) (Tool Only) | brand DEWALT; MPN B09HW8XD6T; GTIN 885911769525; marketplace_seller; www.bestbuy.ca | **other_line**: "DCF913B" 3/8in impact wrench is a different tool line. | **other_model**: "Compact 3/8In Impact Wrench (DCF913B)" is a different model. | **other_line**: "Compact 3/8In Impact Wrench (DCF913B)" is an impact wrench, a different tool line from the DCF850B impact driver. |  |
| `dcf850-s20` | DEWALT DCK268P2 MAX Brushless Cordless Drywall Screw Gun & Impact Driver Kit, 20 V, Lithium-Ion | brand DEWALT; costcutindustrial.ca | **other_line**: "DCK268P2 ... Drywall Screw Gun & Impact Driver Kit" is a different combo product. | **other_model**: "DCK268P2 ... Drywall Screw Gun & Impact Driver Kit" is a different model kit. | **other_model**: "DCK268P2 ... Drywall Screw Gun & Impact Driver Kit" is a different kit model, not DCF850B tool only. |  |
| `dcf850-s21` | DEWALT 20V MAX Cordless Impact Driver & 1/2-in Impact Wrench Combo Kit (DCK242D2) | brand DEWALT; MPN DCK242D2; GTIN 693070943355; marketplace_seller; www.bestbuy.ca | **other_line**: "DCK242D2" impact driver and wrench combo kit is a different product. | **other_model**: "Impact Driver & 1/2-in Impact Wrench Combo Kit (DCK242D2)" is a different DEWALT kit model. | **other_model**: "Impact Driver & 1/2-in Impact Wrench Combo Kit (DCK242D2)" is a different kit model, not DCF850B tool only. |  |

## happybrush-de (personal-care, DE)

Target: brand **happybrush**, model **Eco Vibe 3**, GTIN `4260486330596`, must have: colour: Black-Mint; set: Set S

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `happybrush-de-s11` | Eco R2 Zahnbürste \| Allblack | brand happybrush; GTIN 4260486335058; www.happybrush.de | **other_line**: "Eco R2 Zahnbürste" is a manual toothbrush line, not Eco Vibe. | **other_model**: "Eco R2 Zahnbürste \| Allblack" is the R2 model, not Eco Vibe 3. | **other_line**: "Eco R2 Zahnbürste \| Allblack" is happybrush's R2 toothbrush line, not the Eco Vibe sonic family; GTIN 4260486335058 differs. |  |
| `happybrush-de-s14` | Aufsteckbürsten R2 \| Allblack | brand happybrush; GTIN 4260486335072; Größe=3er Set; www.happybrush.de | **other_line**: "Aufsteckbürsten R2" heads for R2 manual brush, not Eco Vibe family. | **accessory_or_part**: "Aufsteckbürsten R2 \| Allblack" 3er Set are brush heads. | **other_line**: "Aufsteckbürsten R2 \| Allblack" are heads for the R2 line, not for the Eco Vibe family, so not an accessory for the target. |  |
| `happybrush-de-s15` | Aufsteckbürsten R2 \| Allblack | brand happybrush; GTIN 4260486335072; Größe=6er Set; www.happybrush.de | **other_line**: "Aufsteckbürsten R2" heads for R2 line, unrelated to Eco Vibe 3. | **accessory_or_part**: "Aufsteckbürsten R2 \| Allblack" are brush heads for the R2 family. | **other_line**: "Aufsteckbürsten R2 \| Allblack" 6er Set are heads for the R2 line, unrelated to the Eco Vibe 3. |  |
| ⚑ `happybrush-de-s17` | Vorteilsset Schallzahnbürste Eco Vibe 3 | brand happybrush; GTIN 4260486338790; Farbe=Black-Mint; www.happybrush.de | **variant**: "Vorteilsset Schallzahnbürste Eco Vibe 3" Black-Mint is a value set, not Set S; GTIN 4260486338790 differs. | **bundle**: "Vorteilsset Schallzahnbürste Eco Vibe 3" Black-Mint is a value set; GTIN 4260486338790 differs from target. | **variant**: "Vorteilsset Schallzahnbürste Eco Vibe 3" in Black-Mint is the value-set configuration, not Set S; GTIN 4260486338790 differs. |  |
| ⚑ `happybrush-de-s18` | Vorteilsset Schallzahnbürste Eco Vibe 3 | brand happybrush; GTIN 4260486338783; Farbe=Ocean; www.happybrush.de | **variant**: "Vorteilsset ... Eco Vibe 3" value set in "Ocean" colour. | **bundle**: "Vorteilsset Schallzahnbürste Eco Vibe 3" value set, Farbe Ocean; GTIN 4260486338783 differs. | **variant**: "Vorteilsset ... Eco Vibe 3" is the value set (not Set S) in Farbe "Ocean", not Black-Mint; GTIN 4260486338783 differs. |  |
| `happybrush-de-s21` (W) | Eco Vibe Kids Lern-Zahnbürste Paw Patrol \| BLACK DEAL | brand happybrush; GTIN 4260486335492; Set=Set S; www.happybrush.de | **other_model**: "Eco Vibe Kids Lern-Zahnbürste Paw Patrol" is the kids model, not Eco Vibe 3. | **other_line**: "Eco Vibe Kids Lern-Zahnbürste Paw Patrol" is a kids toothbrush line, not Eco Vibe 3. | **other_model**: "Eco Vibe Kids Lern-Zahnbürste Paw Patrol" is the Eco Vibe Kids model, not Eco Vibe 3; GTIN 4260486335492 differs. |  |
| `happybrush-de-s22` (W) | Eco Vibe Kids Lern-Zahnbürste Paw Patrol \| BLACK DEAL | brand happybrush; GTIN 4260486335492; Set=Set M; www.happybrush.de | **other_model**: "Eco Vibe Kids ... Paw Patrol", Set M; different model. | **other_line**: "Eco Vibe Kids Lern-Zahnbürste Paw Patrol" is a kids toothbrush line, not Eco Vibe 3. | **other_model**: "Eco Vibe Kids Lern-Zahnbürste Paw Patrol" in Set M is the Kids model, not Eco Vibe 3. |  |

## hd-600-us (audio, US)

Target: brand **Sennheiser**, model **HD 600**, GTIN `615104340459`

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `hd-600-us-s10` | Sennheiser IE 600 High Fidelity Earphones | brand Sennheiser; GTIN 810091270387; www.audio46.com | **other_line**: "Sennheiser IE 600 ... Earphones" is an in-ear line, not HD headphones. | **other_model**: "Sennheiser IE 600 High Fidelity Earphones" is a different model. | **other_line**: "Sennheiser IE 600 High Fidelity Earphones" is the IE in-ear line, not the HD open-back headphone family; GTIN 810091270387 differs. |  |
| `hd-600-us-s14` | Sennheiser Momentum 5 Wireless Headphones | brand Sennheiser; GTIN 810091274132; Color=Black; www.headphones.com | **other_line**: "Sennheiser Momentum 5 Wireless" is a different product line. | **other_model**: "Sennheiser Momentum 5 Wireless" is a different model. | **other_line**: "Sennheiser Momentum 5 Wireless Headphones" belongs to the Momentum wireless line, not the HD wired open-back family. |  |
| `hd-600-us-s21` (W) | Sennheiser IE 600 In-Ear Headphones | brand Sennheiser; GTIN 810091270387; www.headphones.com | **other_line**: "Sennheiser IE 600 In-Ear" is a different product line. | **other_model**: "Sennheiser IE 600 In-Ear" is a different model than HD 600. | **other_line**: "Sennheiser IE 600 In-Ear Headphones" is the IE in-ear line, not HD open-back headphones; GTIN 810091270387 differs. |  |
| `hd-600-us-s22` (W) | Sennheiser MOMENTUM 5 Wireless Adaptive Noise-Cancelling Headphones | brand Sennheiser; GTIN 810091274163; Color=Bronze; www.audio46.com | **other_line**: "Sennheiser MOMENTUM 5 Wireless" is a different product line. | **other_model**: "Sennheiser MOMENTUM 5 Wireless" is a different Sennheiser headphone model, not HD 600. | **other_line**: "Sennheiser MOMENTUM 5 Wireless Adaptive Noise-Cancelling Headphones" is the Momentum line, not the HD open-back family. |  |

## kobra-3-max-v2-combo-de (3d-printing, DE)

Target: brand **Anycubic**, model **Kobra 3 Max V2 Combo**, must have: configuration: Kobra 3 Max V2 with the 4-colour ACE 2 Pro (Combo), no extra bundle items; filament: none included

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `kobra-3-max-v2-combo-de-s11` (W) | Anycubic doppelseitige 3D-Effektplatte | brand ANYCUBIC; Kompatible 3D Drucker=Kobra X, KOMBINATION=Oktagramm + Diamantoberfläche; de.anycubic3d.com | **other_line**: "3D-Effektplatte" for "Kobra X", not compatible target accessory. | **accessory_or_part**: "doppelseitige 3D-Effektplatte" for "Kobra X" is a build plate accessory. | **accessory_or_part**: "doppelseitige 3D-Effektplatte" is a build plate accessory for the Anycubic Kobra family ("Kobra X"), not the printer itself. |  |
| `kobra-3-max-v2-combo-de-s12` | Anycubic doppelseitige 3D-Effektplatte | brand ANYCUBIC; Kompatible 3D Drucker=Kobra X, KOMBINATION=Phantom + Kugeloberfläche; de.anycubic3d.com | **other_line**: "3D-Effektplatte" for "Kobra X", not compatible target accessory. | **accessory_or_part**: "doppelseitige 3D-Effektplatte" for "Kobra X" is a build plate accessory. | **accessory_or_part**: "doppelseitige 3D-Effektplatte" is a build plate accessory for the Anycubic Kobra family ("Kobra X"), not the printer itself. |  |
| `kobra-3-max-v2-combo-de-s15` | Anycubic Live View Kamera für FDM 3D-Drucker | brand ANYCUBIC; Kompatible 3D Drucker=Kobra X / Kobra 4; de.anycubic3d.com | **other_line**: "Live View Kamera" for "Kobra X / Kobra 4", not the target. | **accessory_or_part**: "Live View Kamera" for "Kobra X / Kobra 4"; camera accessory for the Kobra family, not the printer. | **accessory_or_part**: "Live View Kamera" is a camera add-on for Kobra printers ("Kobra X / Kobra 4"), not the printer itself. |  |
| `kobra-3-max-v2-combo-de-s16` | Anycubic Live View Kamera für FDM 3D-Drucker | brand ANYCUBIC; Kompatible 3D Drucker=Kobra S1 Max; de.anycubic3d.com | **other_line**: "Live View Kamera" for "Kobra S1 Max", not the target. | **accessory_or_part**: "Live View Kamera" accessory, compatible "Kobra S1 Max"; a camera add-on, not the printer. | **accessory_or_part**: "Live View Kamera" is a camera add-on for the Kobra family ("Kobra S1 Max"), not the printer itself. |  |

## laifen-swift-us (personal-care, US)

Target: brand **Laifen**, model **Swift**, GTIN `6976973852103`, must have: colour: Matte Black

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `laifen-swift-us-s21` | Laifen Premium High-Speed Hair Dryer Love-Bound Box | brand Laifen-US; GTIN 6976973858471; Color=Golden Pink; us.laifentech.com | **other_model**: "Laifen Premium High-Speed Hair Dryer Love-Bound Box" is a different Laifen dryer, Golden Pink. | **unknown**: "Laifen Premium High-Speed Hair Dryer Love-Bound Box" names no model; Golden Pink colour differs, model undetermined. | **unknown**: Title "Laifen Premium High-Speed Hair Dryer Love-Bound Box" names no model; GTIN 6976973858471 differs and colour "Golden Pink" differs, so model cannot be determined. |  |

## makita-xfd131 (power-tools, US)

Target: brand **Makita**, model **XFD131**, MPN `XFD131`, GTIN `088381866347`, must have: kit: driver-drill kit with 3.0 Ah battery and charger

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `makita-xfd131-s02` | Makita 12V max CXT Lithium-Ion Cordless 3/8-in. Driver-Drill Kit, 2.0Ah (FD09R1) | brand Makita; GTIN 088381872591; www.toolnut.com | **other_model**: Makita 12V CXT 3/8-in. driver-drill FD09R1 is a different model than XFD131. | **other_line**: Makita 12V max CXT FD09R1, different line. | **other_model**: Makita "12V max CXT 3/8-in. Driver-Drill Kit (FD09R1)" is another Makita driver-drill model, not 18V LXT XFD131; model differs. |  |
| `makita-xfd131-s06` | Makita 12V max CXT Lithium-Ion Cordless 1/4-in. Hex Screwdriver Kit, 2.0Ah (FD10R1) | brand Makita; GTIN 088381872782; www.toolnut.com | **other_model**: Makita FD10R1 12V hex screwdriver kit is a different model. | **other_line**: Makita 12V max CXT screwdriver FD10R1, different line. | **other_line**: Makita "12V max CXT 1/4-in. Hex Screwdriver Kit (FD10R1)" is a screwdriver, a different tool line from the XFD131 driver-drill. |  |
| `makita-xfd131-s10` | Makita 12V max CXT Lithium-Ion Cordless 2-Piece Combo Kit, 1.5Ah (CT232) | brand Makita; GTIN 088381874113; www.toolnut.com | **other_model**: Makita CT232 12V 2-piece combo kit is a different model. | **other_line**: Makita 12V max CXT combo CT232, different line. | **other_line**: Makita "12V max CXT 2-Piece Combo Kit (CT232)" is a multi-tool combo kit, not the XFD131 driver-drill kit. |  |
| `makita-xfd131-s17` | Makita 7.2V Lithium-Ion Cordless 1/4-in. Hex Driver-Drill Kit with Auto-Stop Clutch (DF012DSE) | brand Makita; GTIN 088381837989; www.toolnut.com | **other_model**: Makita 7.2V DF012DSE hex driver-drill kit is a different model. | **other_line**: Makita 7.2V hex driver-drill DF012DSE, different line than 18V LXT. | **other_model**: Makita "7.2V 1/4-in. Hex Driver-Drill Kit (DF012DSE)" is a different driver-drill model than the 18V LXT XFD131; model differs. |  |

## mx-master-3s (computing, CA)

Target: brand **Logitech**, model **MX Master 3S**, MPN `910-006556`, GTIN `097855174819`, must have: colour: Graphite (black); edition: standard (not for Business, not for Mac)

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| ⚑ `mx-master-3s-s09` | Logitech MX Master 3S - Wireless Performance Mouse with Ultra-fast Scrolling, Ergo, 8K DPI, Track on Glass, Quiet Clicks | brand LOGITECH; MPN B09HM94VDS; GTIN 097855174789; marketplace_seller; www.bestbuy.ca | **variant**: GTIN 097855174789 differs from target; title names MX Master 3S without colour, likely another colour variant. | **unknown**: "MX Master 3S" but GTIN 097855174789 differs from the target and no colour is stated; the variant cannot be determined. | **unknown**: Title "Logitech MX Master 3S" states no colour or edition; GTIN 097855174789 differs from target 097855174819, and the field values do not show which variant it is. |  |

## ninja-af101 (kitchen-appliances, CA)

Target: brand **Ninja**, model **AF101C**, MPN `AF101C`, must have: capacity: 4 qt (3.8 L)

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| ⚑ `ninja-af101-s01` | Ninja Air Fryer - 3.79L - Black - Open Box | brand NINJA; MPN AF100WM/AF101; GTIN 617285152395; condition open_box; marketplace_seller; www.bestbuy.ca | **exact**: MPN "AF100WM/AF101", 3.79L Ninja Air Fryer; open box condition is not part of the relation. | **unknown**: MPN "AF100WM/AF101" is ambiguous between models and does not name AF101C; GTIN 617285152395 differs; 3.79L matches. | **exact**: Ninja Air Fryer "3.79L" (4 qt) with MPN "AF100WM/AF101" on bestbuy.ca; AF101C is the Canadian code of AF101. Open box condition is recorded separately. |  |

## oral-b-io5 (personal-care, CA)

Target: brand **Oral-B**, model **iO Series 5**, GTIN `069055133026`, must have: colour: Black

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `oral-b-io5-s12` | Oral B FlossAction Electric Toothbrush Replacement Brush Head Refills, 10-pack | brand ORAL-B; MPN 2024; GTIN 089727814947; marketplace_seller; www.bestbuy.ca | **other_line**: "FlossAction ... Replacement Brush Head Refills" fit non-iO Oral-B brushes, not the iO family. | **accessory_or_part**: "FlossAction ... Replacement Brush Head Refills, 10-pack" are brush heads. | **other_line**: "FlossAction ... Replacement Brush Head Refills" fit classic Oral-B oscillating brushes, not the iO family; incompatible with target. |  |
| `oral-b-io5-s19` | Oral-B Cross Action Replacement Heads – 3 Count | brand Oral-B; GTIN 069055125205; perlastore.ca | **other_line**: "Cross Action Replacement Heads" fit non-iO Oral-B brushes, not the iO family. | **accessory_or_part**: "Cross Action Replacement Heads – 3 Count" are brush heads. | **other_line**: "Cross Action Replacement Heads" fit non-iO Oral-B brushes; not an accessory for the iO Series 5. |  |
| `oral-b-io5-s21` (W) | Oral-B FlossAction Replacement Heads – 5 Pack | brand Oral-B; GTIN 069055126523; perlastore.ca | **other_line**: "FlossAction Replacement Heads – 5 Pack" fit non-iO Oral-B brushes. | **accessory_or_part**: "FlossAction Replacement Heads – 5 Pack" are brush heads, not the toothbrush. | **other_line**: "FlossAction Replacement Heads – 5 Pack" fit non-iO Oral-B brushes; not compatible with iO Series 5. |  |

## polylite-pla-us (3d-printing, US)

Target: brand **Polymaker**, model **PolyLite PLA**, must have: colour: Black; diameter: 1.75 mm; weight: 1 kg

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `polylite-pla-us-s22` | Panchroma™ Basic PLA | brand Polymaker; GTIN 6938936716839; Color=Black, Type=Spool, Net Weight=1kg; us.polymaker.com | **other_model**: "Panchroma™ Basic PLA" Black 1kg; Panchroma excluded, different line. | **other_line**: "Panchroma™ Basic PLA" Black is a different line, explicitly excluded. | **other_model**: Brand Polymaker, title "Panchroma™ Basic PLA" Black 1kg: same brand and PLA filament family, but Panchroma model, explicitly excluded from target PolyLite PLA. |  |
| `polylite-pla-us-s23` | Panchroma™ Basic PLA | brand Polymaker; GTIN 6938936716785; Color=White, Type=Spool, Net Weight=1kg; us.polymaker.com | **other_model**: "Panchroma™ Basic PLA" White; different line and colour. | **other_line**: "Panchroma™ Basic PLA" is a different Polymaker line, explicitly excluded from target. | **other_model**: Brand Polymaker, title "Panchroma™ Basic PLA", Color White: different Polymaker PLA model (Panchroma, excluded) and colour differs from Black. |  |

## polyterra-pla (3d-printing, CA)

Target: brand **Polymaker**, model **PolyTerra PLA**, GTIN `6938936708209`, must have: colour: Charcoal Black; diameter: 1.75 mm; weight: 1 kg

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| ⚑ `polyterra-pla-s13` (W) | Polymaker Panchroma Matte PLA | brand Polymaker; GTIN 6938936714927; Color=Charcoal Black; voxelfactory.com | **exact**: "Panchroma Matte PLA" (renamed PolyTerra) Color "Charcoal Black"; GTIN 6938936714927 likely rebranded packaging code. | **unknown**: "Panchroma Matte PLA" Charcoal Black but GTIN 6938936714927 differs from target; may be new-packaging code, unclear. | **other_model**: Title "Polymaker Panchroma Matte PLA" names a different line than PolyTerra PLA; GTIN 6938936714927 differs from target 6938936708209 despite matching "Charcoal Black". |  |

## remington-f5-us (personal-care, US)

Target: brand **Remington**, model **F5 Power Series Foil Shaver**, MPN `F5-5800`, GTIN `074590518665`

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `remington-f5-us-s02` (W) | Foil Shaver Attachment for WPG4020 & WPG4030 | brand Remington; MPN RP00253; www.remingtonproducts.com | **other_line**: "Foil Shaver Attachment for WPG4020 & WPG4030" is a part for a different groomer line. | **accessory_or_part**: "Foil Shaver Attachment for WPG4020 & WPG4030" is an attachment. | **other_line**: "Foil Shaver Attachment for WPG4020 & WPG4030" is a part for a different groomer line, not the F5-5800. |  |
| `remington-f5-us-s05` | Replacement Foil Shaver Head for Pf7580 | brand Remington; MPN SPF-7580; GTIN 074590555905; www.remingtonproducts.com | **other_line**: "Replacement Foil Shaver Head for Pf7580" is a part for another shaver line. | **accessory_or_part**: "Replacement Foil Shaver Head for Pf7580" is a spare part. | **other_line**: "Replacement Foil Shaver Head for Pf7580" (SPF-7580) is a part for another shaver line, not the F5. |  |
| `remington-f5-us-s06` | Replacement Shaver Head for PF7300 | brand Remington; MPN SPF-PF73; GTIN 074590540178; www.remingtonproducts.com | **other_line**: "Replacement Shaver Head for PF7300" is a part for another line. | **accessory_or_part**: "Replacement Shaver Head for PF7300" is a spare part. | **other_line**: "Replacement Shaver Head for PF7300" (SPF-PF73) is a part for another shaver line. |  |
| `remington-f5-us-s09` | Replacement Shaver Head Combi Pack for PF7400/PF7500 | brand Remington; MPN SPF-PF; GTIN 074590540185; www.remingtonproducts.com | **other_line**: "Replacement Shaver Head Combi Pack for PF7400/PF7500" is a part for another line. | **accessory_or_part**: "Replacement Shaver Head Combi Pack for PF7400/PF7500" is a spare part. | **other_line**: "Replacement Shaver Head Combi Pack for PF7400/PF7500" is a part for another shaver line. |  |
| `remington-f5-us-s12` | Spare Rotary Shaver Head | brand Remington; MPN SPRCDN; GTIN 074590508949; www.remingtonproducts.com | **other_line**: "Spare Rotary Shaver Head" is for rotary shavers, not the foil F5. | **accessory_or_part**: "Spare Rotary Shaver Head" SPRCDN is a spare part. | **other_line**: "Spare Rotary Shaver Head" SPRCDN is for rotary shavers, not the F5 foil shaver. |  |
| `remington-f5-us-s13` | Foil and Cutters for Remington® Shavers | brand Remington; MPN SPW530NA; www.remingtonproducts.com | **other_line**: "Foil and Cutters" SPW530NA is for women's shavers, not F5. | **accessory_or_part**: "Foil and Cutters for Remington Shavers" is a replacement part. | **other_line**: "Foil and Cutters" SPW530NA is a women's shaver part, not for the F5. |  |
| `remington-f5-us-s15` | Electric Shaver Head Replacement | brand Remington; MPN SPW-WDF48; www.remingtonproducts.com | **other_line**: "Electric Shaver Head Replacement" SPW-WDF48 fits women's WDF48 shaver. | **accessory_or_part**: "Electric Shaver Head Replacement" SPW-WDF48 is a spare part. | **other_line**: "Electric Shaver Head Replacement" SPW-WDF48 fits the women's WDF48 shaver. |  |
| `remington-f5-us-s17` | Replacement Foil Head Part for F7000 | brand Remington; MPN SPF-25A; www.remingtonproducts.com | **other_line**: "Replacement Foil Head Part for F7000" is a part for another model. | **accessory_or_part**: "Replacement Foil Head Part for F7000" is a spare part. | **other_line**: "Replacement Foil Head Part for F7000" SPF-25A is a part for a different shaver model. |  |
| `remington-f5-us-s18` | Dual Foil Spare Trimmer | brand Remington; MPN SPF300-AT1; GTIN 074590519150; www.remingtonproducts.com | **other_line**: "Dual Foil Spare Trimmer" SPF300-AT1 is a part not tied to F5. | **accessory_or_part**: "Dual Foil Spare Trimmer" SPF300-AT1 is a spare part. | **accessory_or_part**: "Dual Foil Spare Trimmer" SPF300-AT1 is from the SPF-300 spare series used by F-series foil shavers; it is a part, not the shaver. |  |
| `remington-f5-us-s20` | Replacement Shaver Head for PF7200 | brand Remington; MPN SPF-PF72; GTIN 074590540161; www.remingtonproducts.com | **other_line**: "Replacement Shaver Head for PF7200" is a part for another line. | **accessory_or_part**: "Replacement Shaver Head for PF7200" is a spare part, not the F5 shaver. | **other_line**: "Replacement Shaver Head for PF7200" (SPF-PF72) is a part for another shaver line. |  |

## space-one-de (audio, DE)

Target: brand **Soundcore**, model **Space One**, MPN `A3035G11`, GTIN `194644127015`, must have: colour: Black (Nachtschwarz)

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `space-one-de-s21` (W) | Soundcore Space A40 Ohrstöpsel-Kit - Schwarz | brand Soundcore; MPN A3936011-94; de.soundcore.com | **accessory_or_part**: "Space A40 Ohrstöpsel-Kit" ear tips for earbuds; spare part. | **other_line**: "Space A40 Ohrstöpsel-Kit" is ear tips for the A40 earbuds, a different line. | **other_line**: "Space A40 Ohrstöpsel-Kit" is an ear-tip kit for the Space A40 earbuds, not an accessory for Space One headphones; a different product line. |  |

## sunlu-pla-plus (3d-printing, US)

Target: brand **SUNLU**, model **PLA+**, must have: material: PLA+ (PLA Plus), not PLA+ 2.0, Silk or High Speed; colour: Black; diameter: 1.75 mm; weight: 1 kg

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| ⚑ `sunlu-pla-plus-s05` | SUNLU SILK PLA+ 2.0(SILK PLA+ V2) 3D Filament 1KG, High Gloss Shiny SILK Filament | brand SUNLU Official Store; Shipment=Ship to USA, Material=SILK PLA+ 2.0, Color=Black; store.sunlu.com | **variant**: "SILK PLA+ 2.0" Black; material differs from plain PLA+. | **other_model**: "SILK PLA+ 2.0" Black: Silk line, not PLA+. | **other_model**: Title "SILK PLA+ 2.0", Color Black: Silk PLA+ 2.0 line, not plain PLA+. |  |
| ⚑ `sunlu-pla-plus-s06` | SUNLU SILK PLA+ 2.0(SILK PLA+ V2) 3D Filament 1KG, High Gloss Shiny SILK Filament | brand SUNLU Official Store; Shipment=Ship to USA, Material=SILK PLA+ 2.0, Color=Vivid Rose; store.sunlu.com | **variant**: "SILK PLA+ 2.0" in "Vivid Rose"; material and colour differ. | **other_model**: "SILK PLA+ 2.0" Vivid Rose: Silk line, not PLA+. | **other_model**: "SILK PLA+ 2.0" in "Vivid Rose": Silk line and different colour, not plain PLA+ black. |  |
| ⚑ `sunlu-pla-plus-s07` | SUNLU PLA 3D Printer Filament 1KG | brand SUNLU Official Store; GTIN 6949550958949; Shipment =Ship to USA, Material=PLA, Material/Color=PLA Black; store.sunlu.com | **variant**: "SUNLU PLA 3D Printer Filament 1KG", "PLA Black"; PLA not PLA+. | **other_model**: "SUNLU PLA 3D Printer Filament" PLA Black: plain PLA, not PLA+. | **other_model**: "SUNLU PLA 3D Printer Filament 1KG", "PLA Black": plain PLA, not PLA+. |  |
| ⚑ `sunlu-pla-plus-s08` | SUNLU PLA 3D Printer Filament 1KG | brand SUNLU Official Store; GTIN 6949550958956; Shipment =Ship to USA, Material=PLA, Material/Color=PLA White; store.sunlu.com | **variant**: "SUNLU PLA" "PLA White"; material PLA and colour white differ. | **other_model**: "SUNLU PLA 3D Printer Filament" PLA White: plain PLA, not PLA+. | **other_model**: "SUNLU PLA", "PLA White": plain PLA and white, not PLA+ black. |  |
| ⚑ `sunlu-pla-plus-s09` | SUNLU High Speed PLA+(PLA Plus), HS_PLA+ 3D Printer Filament 1KG | brand SUNLU Official Store; Shipment=Ship to USA, Item=High Speed PLA+, Color=Black; store.sunlu.com | **variant**: "High Speed PLA+" Black; High Speed material differs from PLA+. | **other_model**: "High Speed PLA+" Black: High Speed line, not standard PLA+. | **other_model**: "High Speed PLA+", Color Black: High Speed line, excluded by target. |  |
| ⚑ `sunlu-pla-plus-s10` | SUNLU High Speed PLA+(PLA Plus), HS_PLA+ 3D Printer Filament 1KG | brand SUNLU Official Store; Shipment=Ship to USA, Item=High Speed PLA+, Color=White; store.sunlu.com | **variant**: "High Speed PLA+" White; material and colour differ. | **other_model**: "High Speed PLA+" White: High Speed line excluded. | **other_model**: "High Speed PLA+", Color White: High Speed line and white colour. |  |
| ⚑ `sunlu-pla-plus-s11` | SUNLU Multi-Color SILK Filament(Dual-color, Tri-color and Four-color) 3D Printer Filament 1KG | brand Affordable 3D Printing Filaments and Resins; Shipment=Ship to Europe, Item=Muti-Color SILK PLA+, Color=Four-Color \| Red+Yellow+Green+Black; store.sunlu.com | **variant**: "Muti-Color SILK PLA+" Four-Color; silk material and multi colour differ. | **other_model**: "Muti-Color SILK PLA+" four-color: Silk material, not PLA+. | **other_model**: "Muti-Color SILK PLA+", Four-Color: Silk line and multi-colour, not PLA+ black. |  |
| ⚑ `sunlu-pla-plus-s12` | SUNLU Multi-Color SILK Filament(Dual-color, Tri-color and Four-color) 3D Printer Filament 1KG | brand Affordable 3D Printing Filaments and Resins; GTIN 6949575278138; Shipment=Ship to Europe, Item=Muti-Color SILK PLA+, Color=Dual-Color \| Black+Purple; store.sunlu.com | **variant**: "Muti-Color SILK PLA+" "Black+Purple"; silk material and dual colour differ. | **other_model**: "Muti-Color SILK PLA+" Black+Purple: Silk material, not PLA+. | **other_model**: "Muti-Color SILK PLA+", "Black+Purple": Silk line and dual colour. |  |
| ⚑ `sunlu-pla-plus-s13` | SUNLU PLA+ 2.0, Upgraded PLA+(PLA Plus), 3D Printer Filament 1KG | brand Affordable 3D Printing Filaments and Resins; Shipment=Ship to Europe, ITEM=PLA Plus 2.0 (PLA+ 2.0), Color=PLA+ 2.0 \| Black; store.sunlu.com | **variant**: "PLA+ 2.0" Black; PLA+ 2.0 excluded by target material. | **other_model**: "PLA+ 2.0 \| Black": PLA+ 2.0, explicitly not the target. | **other_model**: "PLA+ 2.0 \| Black": PLA+ 2.0 is explicitly excluded by the target. |  |
| ⚑ `sunlu-pla-plus-s14` | SUNLU PLA+ 2.0, Upgraded PLA+(PLA Plus), 3D Printer Filament 1KG | brand Affordable 3D Printing Filaments and Resins; Shipment=Ship to Europe, ITEM=PLA Plus 2.0 (PLA+ 2.0), Color=PLA+ 2.0 \| White; store.sunlu.com | **variant**: "PLA+ 2.0 \| White"; material and colour differ. | **other_model**: "PLA+ 2.0 \| White": PLA+ 2.0 excluded and white. | **other_model**: "PLA+ 2.0 \| White": PLA+ 2.0 excluded, and white not black. |  |
| ⚑ `sunlu-pla-plus-s15` | SUNLU High Speed PLA+ 2.0(HSPLA Plus 2.0), High Speed 3D Printer Filament 1KG | brand SUNLU Official Store; Shipment=Ship to USA, Item=High Speed PLA+ 2.0, Color=Black; store.sunlu.com | **variant**: "High Speed PLA+ 2.0" Black; material differs. | **other_model**: "High Speed PLA+ 2.0" Black: High Speed line, not standard PLA+. | **other_model**: "High Speed PLA+ 2.0", Black: High Speed 2.0 line, excluded. |  |
| ⚑ `sunlu-pla-plus-s16` | SUNLU High Speed PLA+ 2.0(HSPLA Plus 2.0), High Speed 3D Printer Filament 1KG | brand SUNLU Official Store; Shipment=Ship to USA, Item=High Speed PLA+ 2.0, Color=White; store.sunlu.com | **variant**: "High Speed PLA+ 2.0" White; material and colour differ. | **other_model**: "High Speed PLA+ 2.0" White: High Speed line, excluded by target. | **other_model**: "High Speed PLA+ 2.0", White: High Speed line and white colour. |  |
| ⚑ `sunlu-pla-plus-s17` | SUNLU Rainbow Filament 3D Printer Filament 1KG, PLA Rainbow, SILK PLA+ Rainbow | brand Affordable 3D Printing Filaments and Resins; GTIN 6949575279036; Shipment=Ship to Europe, Material=PLA Rainbow, Color=Rainbow-01; store.sunlu.com | **variant**: "PLA Rainbow" "Rainbow-01"; material and colour differ. | **other_model**: Material "PLA Rainbow", Rainbow-01: plain PLA rainbow, not PLA+ black. | **other_model**: Material "PLA Rainbow", "Rainbow-01": plain PLA rainbow, not PLA+ black. |  |
| ⚑ `sunlu-pla-plus-s18` | SUNLU Rainbow Filament 3D Printer Filament 1KG, PLA Rainbow, SILK PLA+ Rainbow | brand Affordable 3D Printing Filaments and Resins; GTIN 6949575279043; Shipment=Ship to Europe, Material=PLA Rainbow, Color=Rainbow-02; store.sunlu.com | **variant**: "PLA Rainbow" "Rainbow-02"; material and colour differ. | **other_model**: Material "PLA Rainbow", Rainbow-02: plain PLA rainbow, not PLA+ black. | **other_model**: Material "PLA Rainbow", "Rainbow-02": plain PLA rainbow, not PLA+ black. |  |
| ⚑ `sunlu-pla-plus-s19` | SUNLU PLA New Color Collection, Fluorescent & Transparent Series 1.75mm 1KG | brand SUNLU Official Store; Shipment=Ship to USA, Material=PLA Transparent Series, Material/Color=Mist Black; store.sunlu.com | **variant**: "PLA Transparent Series" "Mist Black"; PLA transparent, not PLA+ black. | **other_model**: "PLA Transparent Series" Mist Black: plain PLA, not PLA+. | **other_model**: "PLA Transparent Series", "Mist Black": plain PLA transparent, not PLA+ black. |  |
| ⚑ `sunlu-pla-plus-s20` (W) | SUNLU PLA New Color Collection, Fluorescent & Transparent Series 1.75mm 1KG | brand SUNLU Official Store; Shipment=Ship to USA, Material=PLA Fluorescent Series, Material/Color=Fluorescent Yellow; store.sunlu.com | **variant**: "PLA Fluorescent Series" "Fluorescent Yellow"; material and colour differ. | **other_model**: "SUNLU PLA New Color Collection" Fluorescent Yellow: plain PLA, not PLA+. | **other_model**: "PLA Fluorescent Series", "Fluorescent Yellow": plain PLA, yellow. |  |

## ugreen-nexode-65w-de (computing, DE)

Target: brand **UGREEN**, model **Nexode Pro USB-C Mini Ladegerät 65W 3-Port**, MPN `25261`, GTIN `6941876222612`, must have: power: 65 W; ports: 3

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `ugreen-nexode-65w-de-s16` | UGREEN Desktop Schnellladegerät (65W, 5-Port, GaN) | brand UGREEN DE; MPN 65195; de.ugreen.com | **other_model**: "Desktop Schnellladegerät (65W, 5-Port)" MPN 65195 is a desktop model with 5 ports. | **other_line**: "Desktop Schnellladegerät (65W, 5-Port)", MPN 65195, not Nexode Pro. | **other_model**: "Desktop Schnellladegerät (65W, 5-Port, GaN)" MPN 65195: same UGREEN GaN charger family, different desktop model with 5 ports. |  |
| `ugreen-nexode-65w-de-s19` | UGREEN 65W USB-C GaN Ladegerät + 60W USB-C Ladekabel*2 | brand UGREEN DE; MPN 10335+50150P; GTIN 6938622715061; Sets=65 W USB-C Ladegerät + 60 W USB-C Ladekabel*2 (1 M); de.ugreen.com | **other_model**: "65W USB-C GaN Ladegerät + Ladekabel*2" MPN 10335+50150P bundles a different charger model. | **other_line**: "65W USB-C GaN Ladegerät + Ladekabel*2", MPN 10335+50150P, different charger than 25261. | **other_model**: "65W USB-C GaN Ladegerät + Ladekabel*2" MPN 10335+50150P: a different UGREEN charger model (10335, not 25261), bundled with cables. |  |
| `ugreen-nexode-65w-de-s20` | UGREEN 65W USB-C GaN Ladegerät + 60W USB-C Ladekabel*2 | brand UGREEN DE; MPN 40747+50150P; GTIN 6938622715078; Sets=100 W USB-C Ladegerät + 60 W USB-C Ladekabel*2 (1 M); de.ugreen.com | **other_model**: Selected set "100 W USB-C Ladegerät + 60 W Ladekabel*2" MPN 40747+50150P is a different charger. | **other_line**: Set "100 W USB-C Ladegerät + 60 W Ladekabel*2", MPN 40747+50150P, not the Nexode Pro Mini. | **other_model**: Set "100 W USB-C Ladegerät + 60 W Ladekabel*2" MPN 40747+50150P: a different 100 W charger model, not 25261. |  |
| ⚑ `ugreen-nexode-65w-de-s21` | UGREEN Nexode Pro USB-C Mini Ladegerät (100W, 3-Ports, GaN) | brand UGREEN DE; MPN 15203; GTIN 6941876212033; de.ugreen.com | **other_model**: "Nexode Pro USB-C Mini Ladegerät (100W, 3-Ports)" MPN 15203 differs in power: 100W vs 65W. | **variant**: "Nexode Pro USB-C Mini Ladegerät (100W, 3-Ports)" same Mini line, power 100W not 65W, MPN 15203. | **other_model**: "Nexode Pro USB-C Mini Ladegerät (100W, 3-Ports)" MPN 15203 is a separate 100W model with its own MPN/GTIN, versus target 65W. |  |

## ugreen-nexode-65w-us (computing, US)

Target: brand **UGREEN**, model **Nexode 65W 3-Port Travel Charger**, MPN `90409`, GTIN `6957303894093`, must have: configuration: charger only (no cable)

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `ugreen-nexode-65w-us-s03` | UGREEN Uno Charger 65W (Cyan) | brand UGREEN; MPN 35856; GTIN 6941876238569; us.ugreen.com | **other_model**: "Uno Charger 65W", MPN 35856; different UGREEN charger model. | **other_line**: "Uno Charger 65W (Cyan)" is the Uno line, not Nexode. | **other_model**: "UGREEN Uno Charger 65W (Cyan)", MPN 35856; same brand, a 65W GaN charger but a different model than Nexode 90409. |  |
| ⚑ `ugreen-nexode-65w-us-s09` | UGREEN Nexode 65W 3-Port Travel Charger with US/UK/EU Plug | brand UGREEN; MPN 90409+70427P; GTIN 6938622716020; Style=65W Travel GaN Charger+3.3FT 100W USB C Cable 2 Pack; us.ugreen.com | **bundle**: MPN "90409+70427P", style "Charger+3.3FT 100W USB C Cable 2 Pack"; target with extra cables. | **variant**: Same title, but Style "65W Travel GaN Charger+3.3FT 100W USB C Cable 2 Pack", MPN 90409+70427P; includes cables. | **bundle**: MPN "90409+70427P", Style "65W Travel GaN Charger+3.3FT 100W USB C Cable 2 Pack"; the target charger sold with extra cables. |  |
| `ugreen-nexode-65w-us-s11` | UGREEN 145W Power Bank + 65W GaN Charger Bundle | brand UGREEN US; MPN 90597A+75813; us.ugreen.com | **other_line**: "145W Power Bank + 65W GaN Charger Bundle", MPN 90597A+75813; does not contain 90409. | **other_model**: "145W Power Bank + 65W GaN Charger" MPN 90597A+75813, not 90409. | **other_model**: "145W Power Bank + 65W GaN Charger Bundle", MPN 90597A+75813; the charger is 75813, not 90409. |  |
| `ugreen-nexode-65w-us-s14` | UGREEN 25000mAh Power Bank & Nexode Air 65W Charger | brand UGREEN US; MPN 35525+75813; us.ugreen.com | **other_line**: Power bank + Nexode Air 65W, MPN 35525+75813; no 90409. | **other_model**: "25000mAh Power Bank & Nexode Air 65W" MPN 35525+75813, not the 90409 travel charger. | **other_model**: "25000mAh Power Bank & Nexode Air 65W Charger", MPN 35525+75813; Nexode Air, not the 90409 travel charger. |  |
| `ugreen-nexode-65w-us-s15` | UGREEN Nexode Pro 160W + Nexode Air 65W Charger Bundle | brand UGREEN US; MPN 65636+75813; us.ugreen.com | **other_line**: Nexode Pro 160W + Nexode Air 65W, MPN 65636+75813; no 90409. | **other_model**: "Nexode Pro 160W + Nexode Air 65W" bundle of other models, MPN 65636+75813. | **other_model**: "Nexode Pro 160W + Nexode Air 65W Charger Bundle", MPN 65636+75813; other Nexode models, no 90409. |  |

## wf-1000xm5 (audio, CA)

Target: brand **Sony**, model **WF-1000XM5**, MPN `WF1000XM5/B`, GTIN `027242930391`, must have: colour: Black

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `wf-1000xm5-s06` | Replacement Ear Pads Compatible with Sony WH-1000XM3 - Beige | brand SYMLIS; MPN EP014; GTIN 7454416920866; marketplace_seller; www.bestbuy.ca | **other_line**: SYMLIS ear pads for WH-1000XM3 headphones, a different brand and line. | **accessory_or_part**: "Replacement Ear Pads Compatible with Sony WH-1000XM3" is an accessory part. | **other_line**: SYMLIS "Replacement Ear Pads Compatible with Sony WH-1000XM3" fit over-ear headphones, not the WF-1000XM5 earbuds family; an unrelated third-party item. |  |

## wh-1000xm5-us (audio, US)

Target: brand **Sony**, model **WH-1000XM5**, MPN `WH1000XM5/B`, GTIN `027242923232`, must have: colour: Black

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `wh-1000xm5-us-s01` | Sony WF-1000XM5 Wireless In-Ear Headphones | brand Sony; GTIN 027242925601; Color=Black; www.headphones.com | **other_model**: "Sony WF-1000XM5" in-ear earbuds, a different model in the Sony 1000X family than WH-1000XM5. | **other_line**: "Sony WF-1000XM5 Wireless In-Ear" is the earbud line, not WH over-ear headphones. | **other_line**: "Sony WF-1000XM5 Wireless In-Ear Headphones" is the WF in-ear earbud line, not the WH over-ear WH-1000XM5; GTIN 027242925601 differs. |  |
| `wh-1000xm5-us-s02` | Sony WF-1000XM5 Wireless In-Ear Headphones | brand Sony; GTIN 027242925618; Color=Silver; www.headphones.com | **other_model**: "Sony WF-1000XM5" in-ear, Silver; different model than WH-1000XM5. | **other_line**: "Sony WF-1000XM5 Wireless In-Ear" is the earbud line, not WH over-ear headphones. | **other_line**: "Sony WF-1000XM5 Wireless In-Ear Headphones", Silver, is the WF earbud line, not WH over-ear; GTIN 027242925618 differs. |  |
| `wh-1000xm5-us-s14` | Sony WF-1000XM6 True Wireless Noise Cancelling Earbuds | brand Sony; GTIN 027242933460; Color=Black; www.audio46.com | **other_model**: "Sony WF-1000XM6" earbuds; a different model. | **other_line**: "Sony WF-1000XM6 True Wireless ... Earbuds" is an earbud line, not WH over-ear headphones. | **other_line**: "Sony WF-1000XM6 True Wireless Noise Cancelling Earbuds" is the WF earbud line, not WH over-ear headphones; GTIN 027242933460 differs. |  |
| `wh-1000xm5-us-s15` | Sony WF-1000XM6 True Wireless Noise Cancelling Earbuds | brand Sony; GTIN 027242933477; Color=White; www.audio46.com | **other_model**: "Sony WF-1000XM6" White earbuds; a different model. | **other_line**: "Sony WF-1000XM6 True Wireless ... Earbuds" is an earbud line, not WH over-ear headphones. | **other_line**: "Sony WF-1000XM6 True Wireless Noise Cancelling Earbuds", White, is the WF earbud line, not WH over-ear; GTIN 027242933477 differs. |  |

## wh-1000xm5 (audio, CA)

Target: brand **Sony**, model **WH-1000XM5**, MPN `WH1000XM5/B`, GTIN `027242923232`, must have: colour: Black

| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |
|---|---|---|---|---|---|---|
| `wh-1000xm5-s06` (W) | Sony WH-CH530 Headphones Mint | www.visions.ca | **other_line**: "WH-CH530" is a different headphone line. | **other_model**: "Sony WH-CH530 Headphones Mint" is a different model. | **other_line**: "Sony WH-CH530 Headphones Mint" is Sony's budget CH line, not the 1000X family of the WH-1000XM5. |  |
| `wh-1000xm5-s08` | Sony WH-CH530 Headphones Blue | www.visions.ca | **other_line**: "WH-CH530" is a different line. | **other_model**: "Sony WH-CH530 Headphones Blue" is a different model. | **other_line**: "Sony WH-CH530 Headphones Blue" belongs to the CH line, a different product line from WH-1000XM5. |  |
| `wh-1000xm5-s10` | Sony WH-CH730N Headphones White | www.visions.ca | **other_line**: "WH-CH730N" is a different line. | **other_model**: "Sony WH-CH730N Headphones White" is a different model. | **other_line**: "Sony WH-CH730N Headphones White" is the CH line, not the 1000X family of the WH-1000XM5. |  |
| `wh-1000xm5-s14` | Sony WH-CH530 Headphones Pink | www.visions.ca | **other_line**: "WH-CH530" is a different line. | **other_model**: "Sony WH-CH530 Headphones Pink" is a different model. | **other_line**: "Sony WH-CH530 Headphones Pink" belongs to the CH line, a different product line from WH-1000XM5. |  |
| `wh-1000xm5-s16` | Sony WH-CH730N Headphones Blue | www.visions.ca | **other_line**: "WH-CH730N" is a different line. | **other_model**: "Sony WH-CH730N Headphones Blue" is a different model. | **other_line**: "Sony WH-CH730N Headphones Blue" is the CH line, not the 1000X family of the WH-1000XM5. |  |
| `wh-1000xm5-s18` | Sony WH-CH730N Headphones Black | www.visions.ca | **other_line**: "WH-CH730N Headphones Black" is a different line. | **other_model**: "Sony WH-CH730N Headphones Black" is a different Sony headphone model. | **other_line**: "Sony WH-CH730N Headphones Black" matches the colour but is the CH line, not the WH-1000XM5's 1000X family. |  |
