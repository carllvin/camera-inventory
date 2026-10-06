/**
 * Standard equipment catalog: common camera-department equipment types from
 * well-known manufacturers, importable per workspace (Settings / onboarding).
 *
 * Types only, never physical items. Each lens focal length is its own type,
 * because rental houses list lenses per focal length with their own serials.
 * Aliases are the short / German / rental-house spellings seen on delivery
 * notes; they make document matching work out of the box.
 *
 * Raise STANDARD_CATALOG_VERSION when entries are added; re-importing only adds
 * what a workspace does not have yet and never changes existing types.
 */

export const STANDARD_CATALOG_VERSION = 1;

export interface CatalogEntry {
  manufacturer: string;
  model: string;
  /** Display name; defaults to "manufacturer model". */
  name?: string;
  aliases?: string[];
  specs?: Record<string, string | number>;
  bulk?: boolean;
}

export interface CatalogGroup {
  /** [root category, subcategory] - created when missing, matched by name otherwise. */
  category: [string, string];
  entries: CatalogEntry[];
}

export interface CatalogSection {
  key: string;
  label: string;
  description: string;
  groups: CatalogGroup[];
}

const E = (manufacturer: string, model: string, opts: Omit<CatalogEntry, "manufacturer" | "model"> = {}): CatalogEntry => ({ manufacturer, model, ...opts });
const bulk = (manufacturer: string, model: string, opts: Omit<CatalogEntry, "manufacturer" | "model" | "bulk"> = {}) => E(manufacturer, model, { ...opts, bulk: true });

/**
 * One entry per focal length. `short` are the abbreviations rental houses use
 * ("SP" -> "SP25"), `series` the long form ("Signature Prime" -> "Signature Prime 25").
 */
function lenses(
  manufacturer: string,
  series: string,
  focals: (number | string | [number | string, string])[],
  o: { tStop?: string; mount?: string; format?: string; short?: string[]; extraSeries?: string[]; anamorphic?: string } = {},
): CatalogEntry[] {
  return focals.map((f) => {
    const [mm, t] = Array.isArray(f) ? f : [f, o.tStop];
    const unit = typeof mm === "number" ? "mm" : ""; // "8R" stays "8R"
    const model = `${series} ${mm}${unit}${t ? ` ${t}` : ""}`;
    const aliases = [
      `${series} ${mm}`,
      `${series} ${mm}${unit}`,
      ...(o.short ?? []).flatMap((sh) => [`${sh}${mm}`, `${sh} ${mm}`]),
      ...(o.extraSeries ?? []).map((x) => `${x} ${mm}${unit}`),
    ]
      .map((a) => a.replace(/\s+/g, " ").trim())
      .filter((a) => a.toLowerCase() !== model.toLowerCase());
    const specs: Record<string, string | number> = { focal_length_mm: typeof mm === "number" ? mm : String(mm) };
    if (t) specs.t_stop = t.replace(/^T/, "");
    if (o.mount) specs.mount = o.mount;
    if (o.format) specs.format = o.format;
    if (o.anamorphic) specs.squeeze = o.anamorphic;
    return { manufacturer, model, aliases: [...new Set(aliases)], specs };
  });
}

function zoom(manufacturer: string, model: string, aliases: string[], specs: Record<string, string | number> = {}): CatalogEntry {
  return { manufacturer, model, aliases, specs };
}

export const STANDARD_CATALOG: CatalogSection[] = [
  {
    key: "cameras",
    label: "Cameras",
    description: "Camera bodies, viewfinders, camera accessories, recording media and readers",
    groups: [
      {
        category: ["Camera", "Camera Bodies"],
        entries: [
          E("ARRI", "ALEXA 35", { aliases: ["Alexa35", "ALEXA35", "A35", "ALEXA 35 Body"], specs: { sensor: "Super 35 4.6K", mount: "LPL" } }),
          E("ARRI", "ALEXA 35 Xtreme", { aliases: ["ALEXA 35 Xtreme Body", "A35 Xtreme"], specs: { sensor: "Super 35 4.6K", mount: "LPL" } }),
          E("ARRI", "ALEXA Mini LF", { aliases: ["Mini LF", "AMLF", "Alexa MiniLF", "ALEXA Mini LF Body"], specs: { sensor: "Large Format 4.5K", mount: "LPL" } }),
          E("ARRI", "ALEXA Mini", { aliases: ["Alexa Mini Body", "AMini", "Arri Mini"], specs: { sensor: "Super 35 3.4K", mount: "PL" } }),
          E("ARRI", "ALEXA LF", { aliases: ["Alexa LF Body"], specs: { sensor: "Large Format 4.5K", mount: "LPL" } }),
          E("ARRI", "ALEXA 265", { aliases: ["Alexa 265 Body", "A265"], specs: { sensor: "65 mm 6.5K", mount: "XPL" } }),
          E("ARRI", "AMIRA", { aliases: ["Amira Body", "ARRI Amira Live"], specs: { sensor: "Super 35 3.4K", mount: "PL" } }),
          E("Sony", "VENICE 2 8K", { aliases: ["Venice 2", "Venice2 8K", "MPC-3628"], specs: { sensor: "Full Frame 8.6K", mount: "PL / E" } }),
          E("Sony", "VENICE 2 6K", { aliases: ["Venice 2 6K", "Venice2 6K", "MPC-3626"], specs: { sensor: "Full Frame 6K", mount: "PL / E" } }),
          E("Sony", "VENICE", { aliases: ["Venice 1", "MPC-3610"], specs: { sensor: "Full Frame 6K", mount: "PL / E" } }),
          E("Sony", "BURANO", { aliases: ["Burano", "MPC-2610"], specs: { sensor: "Full Frame 8.6K", mount: "PL / E" } }),
          E("Sony", "FX9", { aliases: ["PXW-FX9"], specs: { sensor: "Full Frame 6K", mount: "E" } }),
          E("Sony", "FX6", { aliases: ["ILME-FX6"], specs: { sensor: "Full Frame 4K", mount: "E" } }),
          E("Sony", "FX3", { aliases: ["ILME-FX3"], specs: { sensor: "Full Frame 4K", mount: "E" } }),
          E("RED", "V-RAPTOR 8K VV", { aliases: ["V-Raptor", "VRaptor 8K", "Raptor VV"], specs: { sensor: "VistaVision 8K", mount: "RF" } }),
          E("RED", "V-RAPTOR XL 8K VV", { aliases: ["V-Raptor XL", "Raptor XL"], specs: { sensor: "VistaVision 8K", mount: "PL" } }),
          E("RED", "V-RAPTOR [X] 8K VV", { aliases: ["V-Raptor X", "VRaptor X"], specs: { sensor: "VistaVision 8K global shutter", mount: "RF" } }),
          E("RED", "KOMODO 6K", { aliases: ["Komodo", "Komodo 6K"], specs: { sensor: "Super 35 6K", mount: "RF" } }),
          E("RED", "KOMODO-X 6K", { aliases: ["Komodo X", "KomodoX"], specs: { sensor: "Super 35 6K", mount: "RF" } }),
          E("Canon", "EOS C500 Mark II", { aliases: ["C500 MkII", "C500 Mark 2", "C500II"], specs: { sensor: "Full Frame 5.9K", mount: "EF / PL" } }),
          E("Canon", "EOS C400", { aliases: ["C400"], specs: { sensor: "Full Frame 6K", mount: "RF" } }),
          E("Canon", "EOS C300 Mark III", { aliases: ["C300 MkIII", "C300 Mark 3", "C300III"], specs: { sensor: "Super 35 4K", mount: "EF / PL" } }),
          E("Canon", "EOS C80", { aliases: ["C80"], specs: { sensor: "Full Frame 6K", mount: "RF" } }),
          E("Canon", "EOS C70", { aliases: ["C70"], specs: { sensor: "Super 35 4K", mount: "RF" } }),
          E("Blackmagic Design", "URSA Cine 12K LF", { aliases: ["URSA Cine 12K", "Blackmagic URSA Cine"], specs: { sensor: "Large Format 12K", mount: "PL / LPL" } }),
          E("Blackmagic Design", "URSA Cine 17K 65", { aliases: ["URSA Cine 17K"], specs: { sensor: "65 mm 17K", mount: "PL / LPL" } }),
          E("Blackmagic Design", "PYXIS 6K", { aliases: ["Pyxis", "Blackmagic Pyxis"], specs: { sensor: "Full Frame 6K" } }),
          E("Blackmagic Design", "Pocket Cinema Camera 6K Pro", { aliases: ["BMPCC 6K Pro", "Pocket 6K Pro"], specs: { sensor: "Super 35 6K", mount: "EF" } }),
        ],
      },
      {
        category: ["Camera", "Viewfinders"],
        entries: [
          E("ARRI", "MVF-2", { name: "ARRI MVF-2 Multi Viewfinder", aliases: ["MVF2", "Multi Viewfinder MVF-2", "ARRI Multiviewfinder MVF-2"] }),
          E("ARRI", "EVF-2", { name: "ARRI EVF-2 Viewfinder", aliases: ["EVF2", "Electronic Viewfinder EVF-2"] }),
          E("Sony", "DVF-EL200", { name: "Sony DVF-EL200 OLED Viewfinder", aliases: ["DVF EL200", "Venice Viewfinder"] }),
          E("Canon", "EVF-V70", { name: "Canon EVF-V70 Viewfinder", aliases: ["EVF V70"] }),
        ],
      },
      {
        category: ["Camera", "Camera Accessories"],
        entries: [
          E("ARRI", "Center Camera Handle CCH-2", { aliases: ["CCH-2", "CCH2", "Center Camera Handle"] }),
          E("ARRI", "Bridge Plate BP-8", { aliases: ["BP-8", "BP8", "Bridge Plate 15mm"] }),
          E("ARRI", "Bridge Plate BP-9", { aliases: ["BP-9", "BP9", "Bridge Plate 19mm"] }),
          E("ARRI", "Bridge Plate Adapter BPA-4", { aliases: ["BPA-4", "BPA4", "Bridge Plate Adapter"] }),
          E("ARRI", "PL to LPL Adapter", { aliases: ["PL-LPL Adapter", "PL to LPL", "LPL Adapter"] }),
          E("ARRI", "LPL Mount LPL-1", { aliases: ["LPL Mount", "LPL-1"] }),
          E("ARRI", "PL Mount", { aliases: ["PL Mount ALEXA Mini", "PL-Mount"] }),
          E("ARRI", "Leveling Block LB-1", { aliases: ["LB-1", "Leveling Block"] }),
          E("Sony", "Rialto 2 Extension System", { aliases: ["Rialto 2", "Rialto2", "Venice Rialto"] }),
        ],
      },
      {
        category: ["Camera", "Media & Readers"],
        entries: [
          E("Codex", "Compact Drive 1TB", { aliases: ["Codex Compact Drive 1TB", "CCD 1TB", "Compact Drive 1 TB"], specs: { capacity: "1 TB" } }),
          E("Codex", "Compact Drive 2TB", { aliases: ["Codex Compact Drive 2TB", "CCD 2TB", "Compact Drive 2 TB"], specs: { capacity: "2 TB" } }),
          E("Codex", "Compact Drive Reader", { aliases: ["Codex Reader", "Compact Drive Reader USB-C", "CDR"] }),
          E("Sony", "AXS-A1TS66 1TB", { aliases: ["AXS 1TB", "AXS Card 1TB", "AXS-A1TS66"], specs: { capacity: "1 TB" } }),
          E("Sony", "AXS-AR3 Card Reader", { aliases: ["AXS-AR3", "AXS Reader"] }),
          E("RED", "PRO CFexpress 2TB", { aliases: ["RED CFexpress 2TB", "RED Pro CFE 2TB"], specs: { capacity: "2 TB" } }),
          E("RED", "PRO CFexpress 1TB", { aliases: ["RED CFexpress 1TB", "RED Pro CFE 1TB"], specs: { capacity: "1 TB" } }),
          E("Angelbird", "AV PRO CFexpress B 1TB", { aliases: ["Angelbird CFexpress 1TB", "CFexpress Type B 1TB"], specs: { capacity: "1 TB" } }),
          E("Angelbird", "AV PRO CFast 2.0 512GB", { aliases: ["CFast 512GB", "CFast 2.0 512GB", "Angelbird CFast 512"], specs: { capacity: "512 GB" } }),
          E("Angelbird", "CFexpress B / CFast Card Reader", { aliases: ["CFexpress Reader", "CFast Reader", "Card Reader"] }),
        ],
      },
    ],
  },
  {
    key: "lenses",
    label: "Lenses",
    description: "Prime lenses per focal length (spherical and anamorphic) and cine zooms",
    groups: [
      {
        category: ["Lenses", "Spherical"],
        entries: [
          ...lenses("ARRI", "Signature Prime", [[12, "T1.8"], [15, "T1.8"], [18, "T1.8"], [21, "T1.8"], [25, "T1.8"], [29, "T1.8"], [35, "T1.8"], [40, "T1.8"], [47, "T1.8"], [58, "T1.8"], [75, "T1.8"], [95, "T1.8"], [125, "T1.8"], [150, "T1.8"], [200, "T2.5"], [280, "T2.8"]], {
            mount: "LPL",
            format: "Full Frame",
            short: ["SP", "Sig Prime "],
          }),
          ...lenses("ZEISS", "Master Prime", [12, 14, 16, 18, 21, 25, 27, 32, 35, 40, 50, 65, 75, 100, 135, 150], { tStop: "T1.3", mount: "PL", format: "Super 35", short: ["MP", "Master "], extraSeries: ["ARRI/Zeiss Master Prime"] }),
          ...lenses("ZEISS", "Ultra Prime", [["8R", "T2.8"], [10, "T2.1"], [12, "T2"], [14, "T1.9"], [16, "T1.9"], [20, "T1.9"], [24, "T1.9"], [28, "T1.9"], [32, "T1.9"], [40, "T1.9"], [50, "T1.9"], [65, "T1.9"], [85, "T1.9"], [100, "T1.9"], [135, "T1.9"], [180, "T1.9"]], {
            mount: "PL",
            format: "Super 35",
            short: ["UP", "Ultra "],
            extraSeries: ["ARRI/Zeiss Ultra Prime"],
          }),
          ...lenses("ZEISS", "Supreme Prime", [[15, "T1.8"], [18, "T1.5"], [21, "T1.5"], [25, "T1.5"], [29, "T1.5"], [35, "T1.5"], [50, "T1.5"], [65, "T1.5"], [85, "T1.5"], [100, "T1.5"], [135, "T1.5"], [150, "T1.8"], [200, "T2.2"]], {
            mount: "PL",
            format: "Full Frame",
            short: ["Supreme "],
          }),
          ...lenses("ZEISS", "Supreme Prime Radiance", [21, 25, 29, 35, 50, 65, 85, 100, 135], { tStop: "T1.5", mount: "PL", format: "Full Frame", short: ["Radiance "] }),
          ...lenses("ZEISS", "CP.3", [[15, "T2.9"], [18, "T2.9"], [21, "T2.9"], [25, "T2.1"], [28, "T2.1"], [35, "T2.1"], [50, "T2.1"], [85, "T2.1"], [100, "T2.1"], [135, "T2.1"]], {
            format: "Full Frame",
            short: ["CP3 ", "CP.3 "],
            extraSeries: ["Compact Prime CP.3"],
          }),
          ...lenses("Cooke", "S4/i", [12, 14, 16, 18, 21, 25, 27, 32, 35, 40, 50, 65, 75, 100, 135, 150, 180, [300, "T2.8"]], { tStop: "T2", mount: "PL", format: "Super 35", short: ["S4 ", "Cooke S4 "] }),
          ...lenses("Cooke", "S7/i", [16, 18, 21, 25, 27, 32, 40, 50, 65, 75, 100, 135, 180], { tStop: "T2", mount: "PL", format: "Full Frame", short: ["S7 ", "Cooke S7 "] }),
          ...lenses("Cooke", "Panchro/i Classic", [18, 21, 25, 32, 40, 50, 65, 75, 100, 135], { mount: "PL", format: "Full Frame", short: ["Panchro ", "Panchro Classic "] }),
          ...lenses("Leitz", "Summilux-C", [16, 18, 21, 25, 29, 35, 40, 50, 65, 75, 100, 135], { tStop: "T1.4", mount: "PL", format: "Super 35", short: ["Lux ", "Summilux "], extraSeries: ["Leica Summilux-C"] }),
          ...lenses("Leitz", "Summicron-C", [15, 18, 21, 25, 29, 35, 40, 50, 75, 100, 135], { tStop: "T2", mount: "PL", format: "Super 35", short: ["Cron ", "Summicron "], extraSeries: ["Leica Summicron-C"] }),
          ...lenses("Sigma", "Cine FF High Speed", [[14, "T2"], [20, "T1.5"], [24, "T1.5"], [28, "T1.5"], [35, "T1.5"], [40, "T1.5"], [50, "T1.5"], [85, "T1.5"], [105, "T1.5"], [135, "T2"]], {
            format: "Full Frame",
            short: ["Sigma Cine "],
            extraSeries: ["Sigma Cine Prime"],
          }),
          ...lenses("Canon", "CN-E Sumire Prime", [[14, "T3.1"], [20, "T1.5"], [24, "T1.5"], [35, "T1.5"], [50, "T1.3"], [85, "T1.3"], [135, "T2.2"]], { mount: "PL", format: "Full Frame", short: ["Sumire "] }),
        ],
      },
      {
        category: ["Lenses", "Anamorphic"],
        entries: [
          ...lenses("ZEISS", "Master Anamorphic", [28, 35, 40, 50, 60, 75, 100, 135, 180], { tStop: "T1.9", mount: "PL", format: "Super 35", anamorphic: "2x", short: ["MA", "Master Ana "], extraSeries: ["ARRI/Zeiss Master Anamorphic"] }),
          ...lenses("Cooke", "Anamorphic/i", [25, 32, 40, 50, 75, 100, 135, 180, 300], { tStop: "T2.3", mount: "PL", format: "Super 35", anamorphic: "2x", short: ["Cooke Ana ", "Ana/i "] }),
          ...lenses("Atlas", "Orion", [25, 32, 40, 50, 65, 80, 100], { tStop: "T2", mount: "PL", format: "Super 35", anamorphic: "2x", short: ["Orion "], extraSeries: ["Atlas Orion Anamorphic"] }),
          ...lenses("Vantage", "Hawk V-Lite", [28, 35, 45, 55, 65, 80, 110, 140], { tStop: "T2.2", mount: "PL", format: "Super 35", anamorphic: "2x", short: ["V-Lite ", "Hawk "] }),
        ],
      },
      {
        category: ["Lenses", "Zoom"],
        entries: [
          zoom("ARRI", "Signature Zoom 16-32mm T2.8", ["SZ 16-32", "Signature Zoom 16-32"], { mount: "LPL", format: "Full Frame" }),
          zoom("ARRI", "Signature Zoom 24-75mm T2.8", ["SZ 24-75", "Signature Zoom 24-75"], { mount: "LPL", format: "Full Frame" }),
          zoom("ARRI", "Signature Zoom 45-135mm T2.8", ["SZ 45-135", "Signature Zoom 45-135"], { mount: "LPL", format: "Full Frame" }),
          zoom("ARRI", "Signature Zoom 65-300mm T2.8", ["SZ 65-300", "Signature Zoom 65-300"], { mount: "LPL", format: "Full Frame" }),
          zoom("ARRI", "Alura 15.5-45mm T2.8", ["Alura 15.5-45", "Alura Wide Zoom"], { mount: "PL", format: "Super 35" }),
          zoom("ARRI", "Alura 18-80mm T2.6", ["Alura 18-80", "Alura Studio Zoom 18-80"], { mount: "PL", format: "Super 35" }),
          zoom("ARRI", "Alura 30-80mm T2.8", ["Alura 30-80", "Alura Lightweight Zoom"], { mount: "PL", format: "Super 35" }),
          zoom("ARRI", "Alura 45-250mm T2.6", ["Alura 45-250", "Alura Studio Zoom 45-250"], { mount: "PL", format: "Super 35" }),
          zoom("Angénieux", "Optimo 24-290 T2.8", ["Optimo 24-290", "Angenieux 24-290", "Optimo 12x"], { mount: "PL", format: "Super 35" }),
          zoom("Angénieux", "Optimo 28-76 T2.6", ["Optimo 28-76", "Angenieux 28-76"], { mount: "PL", format: "Super 35" }),
          zoom("Angénieux", "Optimo 15-40 T2.6", ["Optimo 15-40", "Angenieux 15-40"], { mount: "PL", format: "Super 35" }),
          zoom("Angénieux", "Optimo 45-120 T2.8", ["Optimo 45-120", "Angenieux 45-120"], { mount: "PL", format: "Super 35" }),
          zoom("Angénieux", "Optimo Ultra 12x 36-435 T4.2", ["Optimo Ultra 12x", "Angenieux 36-435", "Ultra 12x FF"], { mount: "PL", format: "Full Frame" }),
          zoom("Angénieux", "Optimo Ultra Compact 21-56 T2.9", ["Ultra Compact 21-56", "Angenieux 21-56"], { mount: "PL", format: "Full Frame" }),
          zoom("Angénieux", "Optimo Ultra Compact 37-102 T2.9", ["Ultra Compact 37-102", "Angenieux 37-102"], { mount: "PL", format: "Full Frame" }),
          zoom("Angénieux", "Optimo Style 25-250 T3.5", ["Optimo Style 25-250", "Angenieux 25-250"], { mount: "PL", format: "Super 35" }),
          zoom("Angénieux", "Type EZ-1 30-90 T2", ["EZ-1 30-90", "EZ1", "Angenieux EZ-1"], { format: "Super 35" }),
          zoom("Angénieux", "Type EZ-2 15-40 T2", ["EZ-2 15-40", "EZ2", "Angenieux EZ-2"], { format: "Super 35" }),
          zoom("Fujinon", "Premista 19-45mm T2.9", ["Premista 19-45", "Fuji Premista 19-45"], { mount: "PL", format: "Full Frame" }),
          zoom("Fujinon", "Premista 28-100mm T2.9", ["Premista 28-100", "Fuji Premista 28-100"], { mount: "PL", format: "Full Frame" }),
          zoom("Fujinon", "Premista 80-250mm T2.9-3.5", ["Premista 80-250", "Fuji Premista 80-250"], { mount: "PL", format: "Full Frame" }),
          zoom("Fujinon", "Cabrio 19-90mm T2.9", ["Cabrio 19-90", "ZK4.7x19"], { mount: "PL", format: "Super 35" }),
          zoom("Fujinon", "Cabrio 25-300mm T3.5-3.85", ["Cabrio 25-300", "ZK12x25"], { mount: "PL", format: "Super 35" }),
          zoom("Fujinon", "Premier 18-85mm T2", ["Premier 18-85", "HK4.7x18"], { mount: "PL", format: "Super 35" }),
          zoom("Fujinon", "Premier 24-180mm T2.6", ["Premier 24-180", "HK7.5x24"], { mount: "PL", format: "Super 35" }),
          zoom("Cooke", "Varotal/i FF 19-40mm T2.8", ["Varotal 19-40", "Cooke 19-40"], { mount: "PL", format: "Full Frame" }),
          zoom("Cooke", "Varotal/i FF 30-95mm T2.8", ["Varotal 30-95", "Cooke 30-95"], { mount: "PL", format: "Full Frame" }),
          zoom("Cooke", "Varotal/i FF 85-215mm T2.8", ["Varotal 85-215", "Cooke 85-215"], { mount: "PL", format: "Full Frame" }),
          zoom("ZEISS", "Lightweight Zoom LWZ.3 21-100mm T2.9-3.9", ["LWZ.3", "LWZ3 21-100", "Zeiss 21-100"], { format: "Super 35" }),
          zoom("Canon", "CN-E 30-300mm T2.95-3.7", ["CN-E 30-300", "Canon 30-300"], { mount: "PL / EF", format: "Super 35" }),
          zoom("Canon", "CN-E 14.5-60mm T2.6", ["CN-E 14.5-60", "Canon 14.5-60"], { mount: "PL / EF", format: "Super 35" }),
          zoom("Canon", "CN7x17 KAS S 17-120mm T2.95", ["CN7x17", "Canon 17-120"], { mount: "PL / EF", format: "Super 35" }),
        ],
      },
    ],
  },
  {
    key: "lens-control",
    label: "Lens control & matte boxes",
    description: "Wireless lens control, motors, follow focus, matte boxes and filters",
    groups: [
      {
        category: ["Electronics", "Lens Control"],
        entries: [
          E("ARRI", "Hi-5", { name: "ARRI Hi-5 Hand Unit", aliases: ["Hi5", "Hi-5 Hand Unit", "Hand Unit Hi-5"] }),
          E("ARRI", "WCU-4", { name: "ARRI WCU-4 Hand Unit", aliases: ["WCU4", "Wireless Compact Unit WCU-4"] }),
          E("ARRI", "RIA-1", { name: "ARRI RIA-1 Radio Interface", aliases: ["RIA1", "Radio Interface Adapter"] }),
          E("ARRI", "UMC-4", { name: "ARRI UMC-4 Motor Controller", aliases: ["UMC4"] }),
          E("ARRI", "cforce mini", { aliases: ["CForce Mini", "cforce mini motor", "Lens Motor"] }),
          E("ARRI", "cforce mini RF", { aliases: ["CForce Mini RF", "cforce RF"] }),
          E("ARRI", "cforce plus", { aliases: ["CForce Plus", "cforce+"] }),
          E("ARRI", "OCU-1", { name: "ARRI OCU-1 Operator Control Unit", aliases: ["OCU1", "Operator Control Unit"] }),
          E("ARRI", "Follow Focus FF-5", { aliases: ["FF-5", "FF5", "ARRI Follow Focus"] }),
          E("Preston", "FI+Z Hand Unit 4", { name: "Preston HU4 Hand Unit", aliases: ["HU4", "HU-4", "Preston HU4", "Preston Hand Unit"] }),
          E("Preston", "MDR-4", { name: "Preston MDR-4 Motor Driver", aliases: ["MDR4", "Preston MDR4"] }),
          E("Preston", "MDR-3", { name: "Preston MDR-3 Motor Driver", aliases: ["MDR3", "Preston MDR3"] }),
          E("Preston", "DM2X Motor", { aliases: ["DM2X", "Preston Motor DM2X"] }),
          E("Preston", "Light Ranger 2", { aliases: ["LR2", "Light Ranger"] }),
          E("cmotion", "cPRO Hand Unit", { aliases: ["cPRO", "cmotion cPRO"] }),
          E("cmotion", "cPRO Motor", { aliases: ["cPRO Motor", "cmotion motor"] }),
          E("Teradek", "RT CTRL.3", { aliases: ["RT Ctrl 3", "Teradek RT Hand Unit", "CTRL.3"] }),
          E("Teradek", "RT MK3.1 Receiver", { aliases: ["RT MK3.1", "Teradek RT Receiver"] }),
          E("Teradek", "RT Motion Motor", { aliases: ["RT Motor", "Teradek RT Motor"] }),
          E("Tilta", "Nucleus-M", { aliases: ["Nucleus M", "Tilta Nucleus"] }),
          E("Cinematography Electronics", "CineTape", { aliases: ["Cine Tape", "CineTape Measure"] }),
        ],
      },
      {
        category: ["Camera", "Matte Boxes & Filters"],
        entries: [
          E("ARRI", "LMB 4x5 Pro Set", { aliases: ["LMB 4x5", "LMB4x5", "Lightweight Matte Box 4x5"] }),
          E("ARRI", "LMB-6", { aliases: ["LMB6", "LMB-6 Matte Box"] }),
          E("Bright Tangerine", "Misfit Atom", { aliases: ["Misfit Atom", "Atom Matte Box"] }),
          E("Bright Tangerine", "Misfit Kick", { aliases: ["Misfit Kick", "Kick Matte Box"] }),
          E("Bright Tangerine", "Strummer DNA LF", { aliases: ["Strummer DNA", "Strummer LF"] }),
          bulk("Schneider", "Platinum IRND 4x5.65 0.3", { aliases: ["IRND 0.3", "ND 0.3 4x5.65", "ND3"] }),
          bulk("Schneider", "Platinum IRND 4x5.65 0.6", { aliases: ["IRND 0.6", "ND 0.6 4x5.65", "ND6"] }),
          bulk("Schneider", "Platinum IRND 4x5.65 0.9", { aliases: ["IRND 0.9", "ND 0.9 4x5.65", "ND9"] }),
          bulk("Schneider", "Platinum IRND 4x5.65 1.2", { aliases: ["IRND 1.2", "ND 1.2 4x5.65"] }),
          bulk("Schneider", "Platinum IRND 4x5.65 1.5", { aliases: ["IRND 1.5", "ND 1.5 4x5.65"] }),
          bulk("Schneider", "Platinum IRND 4x5.65 1.8", { aliases: ["IRND 1.8", "ND 1.8 4x5.65"] }),
          bulk("Schneider", "True-Pol 4x5.65", { aliases: ["Pola 4x5.65", "Polarizer 4x5.65", "Pol Filter"] }),
          bulk("Tiffen", "Black Pro-Mist 1/8 4x5.65", { aliases: ["BPM 1/8", "Black Pro Mist 1/8"] }),
          bulk("Tiffen", "Black Pro-Mist 1/4 4x5.65", { aliases: ["BPM 1/4", "Black Pro Mist 1/4"] }),
          bulk("Tiffen", "Black Pro-Mist 1/2 4x5.65", { aliases: ["BPM 1/2", "Black Pro Mist 1/2"] }),
        ],
      },
    ],
  },
  {
    key: "video",
    label: "Monitors, wireless video & timecode",
    description: "On-board and director's monitors, recorders, wireless video, timecode",
    groups: [
      {
        category: ["Electronics", "Monitors"],
        entries: [
          E("SmallHD", "Cine 7", { aliases: ["SmallHD 7", "Cine7", "Small HD Cine 7"] }),
          E("SmallHD", "Cine 13", { aliases: ["SmallHD 13", "Cine13", "Small HD Cine 13"] }),
          E("SmallHD", "Cine 18", { aliases: ["SmallHD 18", "Cine18", "Small HD Cine 18"] }),
          E("SmallHD", "Ultra 7", { aliases: ["SmallHD Ultra 7", "Ultra7"] }),
          E("TVLogic", "F-7H mk2", { aliases: ["F7H", "TV Logic F-7H"] }),
          E("Sony", "PVM-X2400", { aliases: ["PVM X2400", "Sony 24 inch HDR"] }),
          E("Sony", "PVM-A250", { aliases: ["PVM A250", "Sony 25 inch OLED"] }),
          E("Flanders Scientific", "DM241", { aliases: ["FSI DM241", "FSI 24"] }),
          E("Atomos", "Ninja V", { aliases: ["Ninja 5", "Atomos Ninja"] }),
          E("Atomos", "Shogun 7", { aliases: ["Shogun7", "Atomos Shogun"] }),
        ],
      },
      {
        category: ["Electronics", "Wireless"],
        entries: [
          E("Teradek", "Bolt 6 XT 750 TX", { aliases: ["Bolt 6 TX", "Bolt TX", "Bolt750 TX"] }),
          E("Teradek", "Bolt 6 XT 750 RX", { aliases: ["Bolt 6 RX", "Bolt RX", "Bolt750 RX"] }),
          E("Teradek", "Bolt 6 XT 1500 TX", { aliases: ["Bolt 1500 TX", "Bolt6 1500 TX"] }),
          E("Teradek", "Bolt 6 XT 1500 RX", { aliases: ["Bolt 1500 RX", "Bolt6 1500 RX"] }),
          E("Teradek", "Bolt 6 LT 750 TX", { aliases: ["Bolt LT TX", "Bolt 6 LT TX"] }),
          E("Teradek", "Bolt 6 LT 750 RX", { aliases: ["Bolt LT RX", "Bolt 6 LT RX"] }),
          E("Hollyland", "Mars 4K TX", { aliases: ["Mars 4K Transmitter"] }),
          E("Hollyland", "Mars 4K RX", { aliases: ["Mars 4K Receiver"] }),
        ],
      },
      {
        category: ["Electronics", "Timecode"],
        entries: [
          E("Tentacle Sync", "Tentacle Sync E", { aliases: ["Tentacle", "TC Box", "Tentacle E"] }),
          E("Ambient", "Lockit ACL 204", { aliases: ["Lockit", "ACL204", "Ambient Lockit"] }),
          E("Deity", "TC-1", { aliases: ["Deity TC1", "TC1"] }),
          E("Atomos", "UltraSync One", { aliases: ["Ultrasync", "UltraSync 1"] }),
        ],
      },
    ],
  },
  {
    key: "power",
    label: "Power",
    description: "Camera batteries, chargers and power distribution",
    groups: [
      {
        category: ["Power", "Batteries"],
        entries: [
          E("bebob", "B290cine", { aliases: ["B290", "B-Mount Battery 290", "Bebob B290 Cine"], specs: { mount: "B-Mount", capacity_wh: 290 } }),
          E("bebob", "B155cine", { aliases: ["B155", "Bebob B155 Cine"], specs: { mount: "B-Mount", capacity_wh: 155 } }),
          E("bebob", "B98cine", { aliases: ["B98", "Bebob B98 Cine"], specs: { mount: "B-Mount", capacity_wh: 98 } }),
          E("bebob", "V290RM-Cine", { aliases: ["V290", "Bebob V290", "V-Mount 290"], specs: { mount: "V-Mount", capacity_wh: 290 } }),
          E("bebob", "V98micro", { aliases: ["V98 micro", "Bebob V98"], specs: { mount: "V-Mount", capacity_wh: 98 } }),
          E("Core SWX", "Hypercore 98", { aliases: ["Hypercore", "HC98", "Core 98"], specs: { mount: "V-Mount", capacity_wh: 98 } }),
          E("IDX", "DUO-C98", { aliases: ["DUO C98", "IDX 98"], specs: { mount: "V-Mount", capacity_wh: 98 } }),
          E("IDX", "Imicro-98", { aliases: ["iMicro 98", "IDX Micro"], specs: { mount: "V-Mount", capacity_wh: 98 } }),
          E("Anton/Bauer", "Titon 90", { aliases: ["Titon90", "Anton Bauer 90"], specs: { mount: "Gold Mount", capacity_wh: 90 } }),
        ],
      },
      {
        category: ["Power", "Chargers"],
        entries: [
          E("bebob", "VS2-Cine Charger", { aliases: ["B-Mount Charger", "Bebob Charger"] }),
          E("IDX", "VL-4X", { aliases: ["VL4X", "IDX 4-Channel Charger", "V-Mount Charger"] }),
          E("Core SWX", "Fleet-Q4", { aliases: ["Fleet Q4", "Core Charger 4"] }),
        ],
      },
      {
        category: ["Power", "Power Distribution"],
        entries: [
          bulk("Generic", "D-Tap Splitter", { aliases: ["DTap Splitter", "P-Tap Splitter"] }),
          E("Generic", "24V Mains Power Supply", { aliases: ["Netzteil 24V", "AC Power Supply 24V", "Mains PSU"] }),
          E("Generic", "12V Mains Power Supply", { aliases: ["Netzteil 12V", "AC Power Supply 12V"] }),
        ],
      },
    ],
  },
  {
    key: "support",
    label: "Support & grip",
    description: "Tripods, heads, gimbals, stabilisers and camera-department grip",
    groups: [
      {
        category: ["Support", "Tripods"],
        entries: [
          E("OConnor", "Cine HD Tripod Legs", { name: "O'Connor Cine HD Tripod", aliases: ["OConnor Sticks", "Standard Legs", "Cine HD Legs"] }),
          E("Ronford-Baker", "Standard Tripod", { aliases: ["Ronford Standard Legs", "Ronford Tall Legs"] }),
          E("Ronford-Baker", "Baby Legs", { aliases: ["Ronford Baby Legs", "Baby Tripod", "Short Legs"] }),
          E("Ronford-Baker", "Hi-Hat", { aliases: ["High Hat", "Hihat", "Ronford Hi Hat"] }),
          E("Sachtler", "flowtech 100", { aliases: ["Flowtech 100", "Sachtler Flowtech"] }),
        ],
      },
      {
        category: ["Support", "Heads"],
        entries: [
          E("OConnor", "2575D Fluid Head", { name: "O'Connor 2575D", aliases: ["O'Connor 2575", "2575D", "OConnor 2575"] }),
          E("OConnor", "2560 Fluid Head", { name: "O'Connor 2560", aliases: ["O'Connor 2560", "OConnor 2560"] }),
          E("OConnor", "1030Ds Fluid Head", { name: "O'Connor 1030Ds", aliases: ["O'Connor 1030", "OConnor 1030"] }),
          E("OConnor", "120EX Fluid Head", { name: "O'Connor 120EX", aliases: ["O'Connor 120", "OConnor 120EX"] }),
          E("Sachtler", "Cine 30 HD", { aliases: ["Sachtler Cine 30", "Cine30"] }),
          E("Sachtler", "Video 20 S2", { aliases: ["Sachtler Video 20", "Video20"] }),
          E("ARRI", "ARRIHEAD 2", { aliases: ["Arrihead", "ARRI Geared Head", "Getriebeneiger"] }),
        ],
      },
      {
        category: ["Support", "Gimbals"],
        entries: [
          E("DJI", "Ronin 2", { aliases: ["Ronin2", "DJI Ronin II"] }),
          E("DJI", "RS 4 Pro", { aliases: ["RS4 Pro", "Ronin RS 4 Pro"] }),
          E("Freefly", "MoVI Pro", { aliases: ["Movi Pro", "Freefly Movi"] }),
          E("ARRI", "Trinity 2", { aliases: ["Trinity2", "ARRI Trinity"] }),
          E("ARRI", "SRH-360", { aliases: ["SRH360", "Stabilized Remote Head 360"] }),
          E("ARRI", "Artemis 2", { aliases: ["Artemis2", "ARRI Artemis"] }),
          E("Tiffen", "Steadicam M-2", { aliases: ["Steadicam M2", "M-2 Steadicam"] }),
          E("Easyrig", "Vario 5", { aliases: ["Easyrig", "Easy Rig Vario 5"] }),
        ],
      },
      {
        category: ["Grip", "Rigging"],
        entries: [
          E("Manfrotto", "244 Magic Arm", { aliases: ["Magic Arm", "Manfrotto 244"] }),
          E("Manfrotto", "035 Super Clamp", { aliases: ["Super Clamp", "Mafer Clamp", "Manfrotto 035"] }),
          E("Noga", "Holdit Arm", { aliases: ["Noga Arm", "Noga"] }),
          E("Matthews", "Cardellini Clamp", { aliases: ["Cardellini", "End Jaw Clamp"] }),
        ],
      },
      {
        category: ["Grip", "Weights"],
        entries: [
          bulk("Matthews", "Sandbag 15 lb", { aliases: ["Shot Bag", "Sand Bag", "Sandsack"] }),
          bulk("Matthews", "Sandbag 25 lb", { aliases: ["Sandbag 25", "Sandsack 25 lb"] }),
        ],
      },
      {
        category: ["Grip", "Stands"],
        entries: [
          bulk("Avenger", "C-Stand 40\"", { aliases: ["C Stand", "Century Stand"] }),
          bulk("Generic", "Apple Box Full", { aliases: ["Apple Box", "Full Apple"] }),
          bulk("Generic", "Apple Box Half", { aliases: ["Half Apple"] }),
          bulk("Generic", "Apple Box Quarter", { aliases: ["Quarter Apple"] }),
          bulk("Generic", "Apple Box Pancake", { aliases: ["Pancake", "Eighth Apple"] }),
        ],
      },
    ],
  },
  {
    key: "cables",
    label: "Cables",
    description: "Video, power and control cables (tracked as bulk quantities)",
    groups: [
      {
        category: ["Cables", "Video Cables"],
        entries: [
          bulk("Generic", "3G-SDI BNC Cable 1 m", { name: "BNC Cable 1 m", aliases: ["BNC 1m", "SDI Cable 1m"] }),
          bulk("Generic", "12G-SDI BNC Cable 0.3 m", { name: "BNC Cable 0.3 m", aliases: ["BNC 30cm", "BNC 0.3m"] }),
          bulk("Generic", "12G-SDI BNC Cable 3 m", { name: "BNC Cable 3 m", aliases: ["BNC 3m", "SDI Cable 3m"] }),
          bulk("Generic", "12G-SDI BNC Cable 10 m", { name: "BNC Cable 10 m", aliases: ["BNC 10m", "SDI Cable 10m"] }),
          bulk("Generic", "12G-SDI BNC Cable 30 m", { name: "BNC Cable 30 m", aliases: ["BNC 30m", "SDI Cable 30m"] }),
          bulk("Generic", "HDMI Cable 1 m", { aliases: ["HDMI 1m"] }),
        ],
      },
      {
        category: ["Cables", "Power Cables"],
        entries: [
          bulk("ARRI", "Power Cable KC-50-S", { name: "ARRI KC-50-S Power Cable 24V straight", aliases: ["KC-50-S", "KC50S", "ARRI Kabel Power KC-50-S"] }),
          bulk("ARRI", "Power Cable KC-50-SP-S", { name: "ARRI KC-50-SP-S Power Cable 24V coiled", aliases: ["KC-50-SP-S", "KC50SPS", "ARRI Kabel Power KC-50-SP-S"] }),
          bulk("Generic", "D-Tap to 2-pin LEMO Cable", { aliases: ["D-Tap to Lemo 2pin", "DTap Lemo 2", "P-Tap to 2-pin"] }),
          bulk("Generic", "2-pin LEMO to 2-pin LEMO Cable", { aliases: ["Lemo 2pin Cable", "2-pin Lemo"] }),
          bulk("Generic", "XLR 4-pin Power Cable", { aliases: ["4-pin XLR", "XLR4 Power"] }),
        ],
      },
      {
        category: ["Cables", "Control Cables"],
        entries: [
          bulk("ARRI", "LBUS Cable 0.3 m", { aliases: ["LBUS 0.3m", "LBUS 30cm"] }),
          bulk("ARRI", "LBUS Cable 0.8 m", { aliases: ["LBUS 0.8m", "LBUS 80cm"] }),
          bulk("ARRI", "LBUS Cable 1.5 m", { aliases: ["LBUS 1.5m"] }),
          bulk("Generic", "RS 3-pin Run/Stop Cable", { aliases: ["RS Cable", "3-pin Fischer RS", "Run Stop Cable"] }),
          bulk("Generic", "Ethernet Cable 10 m", { aliases: ["LAN Cable 10m", "Ethernet 10m"] }),
        ],
      },
    ],
  },
];

export function catalogSection(key: string) {
  return STANDARD_CATALOG.find((s) => s.key === key);
}

export function sectionEntries(section: CatalogSection) {
  return section.groups.flatMap((g) => g.entries.map((e) => ({ ...e, category: g.category })));
}
