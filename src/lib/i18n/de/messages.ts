import type { Dict } from "../core";

/*
 * Finished English messages from the server: action results, domain errors,
 * validation messages, document match reasons and history summaries.
 * Keys with {placeholders} work as patterns (see translateMessage in ../core).
 * Some families of keys are generated below (status pairs, match reasons).
 */

// Enum values as they appear in summaries (underscores replaced by spaces).
const ITEM_STATUS: [string, string][] = [
  ["available", "verfügbar"],
  ["on project", "auf Projekt"],
  ["in use", "im Einsatz"],
  ["ready for return", "bereit zur Rückgabe"],
  ["missing", "fehlt"],
  ["returned", "zurückgegeben"],
];
const CONDITION: [string, string][] = [
  ["unknown", "unbekannt"],
  ["ok", "OK"],
  ["minor wear", "leichte Gebrauchsspuren"],
  ["damaged", "beschädigt"],
  ["defective", "defekt"],
];
const PROJECT_STATUS: [string, string][] = [
  ["planning", "Planung"],
  ["prep", "Vorbereitung"],
  ["shooting", "Dreh"],
  ["wrap", "Wrap"],
  ["closed", "abgeschlossen"],
];

function pairs(values: [string, string][], en: (a: string, b: string) => string, de: (a: string, b: string) => string): Dict {
  const out: Dict = {};
  for (const [a, aDe] of values) for (const [b, bDe] of values) if (a !== b) out[en(a, b)] = de(aDe, bDe);
  return out;
}

/** "{label}: on project → in use", "{label}: condition ok → damaged", "Project {name}: status prep → shooting". */
const transitions: Dict = {
  ...pairs(ITEM_STATUS, (a, b) => `{label}: ${a} → ${b}`, (a, b) => `{label}: ${a} → ${b}`),
  ...pairs(CONDITION, (a, b) => `{label}: ${a} → ${b}`, (a, b) => `{label}: ${a} → ${b}`),
  ...pairs(CONDITION, (a, b) => `{label}: condition ${a} → ${b}`, (a, b) => `{label}: Zustand ${a} → ${b}`),
  ...pairs(PROJECT_STATUS, (a, b) => `Project {name}: status ${a} → ${b}`, (a, b) => `Projekt {name}: Status ${a} → ${b}`),
};

/** Reasons for splitting bulk items ("BNC: 2 of 10 split off (status in use)"). */
const splitReasons: Dict = {
  split: "aufgeteilt",
  packing: "Packen",
  "taken out of set": "aus dem Set genommen",
  "removed from project": "vom Projekt entfernt",
  status: "Status",
  condition: "Zustand",
  case: "Set",
  "status, condition": "Status, Zustand",
  "status, case": "Status, Set",
  "condition, case": "Zustand, Set",
  "status, condition, case": "Status, Zustand, Set",
  ...Object.fromEntries(ITEM_STATUS.map(([en, de]) => [`status ${en}`, `Status ${de}`])),
  ...Object.fromEntries(CONDITION.map(([en, de]) => [`condition ${en}`, `Zustand ${de}`])),
};

/** "Status and condition saved." (item page, fields that changed). */
const savedFields: Dict = {};
for (const [en, de] of [
  ["Status", "Status"],
  ["Condition", "Zustand"],
  ["Case", "Set"],
  ["Status and condition", "Status und Zustand"],
  ["Status and case", "Status und Set"],
  ["Condition and case", "Zustand und Set"],
  ["Status and condition and case", "Status, Zustand und Set"],
] as const) {
  savedFields[`${en} saved.`] = `${de} gespeichert.`;
  savedFields[`${en} saved for {item} — listed separately now.`] = `${de} für {item} gespeichert — jetzt separat aufgeführt.`;
}

/** Return-note match reasons: "<how>: <item>" with the ways an item was found. */
const returnHow: [string, string][] = [
  ["chosen by reviewer", "manuell gewählt"],
  ["same serial number", "gleiche Seriennummer"],
  ["same asset number", "gleiche Inventarnummer"],
  ["same equipment type", "gleicher Equipment-Typ"],
  ["removed with this note", "mit diesem Schein entfernt"],
  ["the only one on the project", "das einzige auf dem Projekt"],
  ["the only {n} on the project", "die einzigen {n} auf dem Projekt"],
];
const returnReasons: Dict = {};
for (const [en, de] of returnHow) {
  returnReasons[`${en}: {item}`] = `${de}: {item}`;
  returnReasons[`${en}: {item} ({units} of {total} - the rest stays)`] = `${de}: {item} ({units} von {total} – der Rest bleibt)`;
  returnReasons[`${en}: {item} - already removed from the project ✓`] = `${de}: {item} – bereits vom Projekt entfernt ✓`;
}

/** Delivery-note match reasons: how an equipment type or item was recognised. */
const typeHow: [string, string][] = [
  ["catalog match", "Katalogtreffer"],
  ["same spelling as before", "gleiche Schreibweise wie zuvor"],
  ["model number in the text", "Modellnummer im Text"],
  ["similar name", "ähnlicher Name"],
];
const deliveryReasons: Dict = {};
for (const [en, de] of typeHow) {
  deliveryReasons[`${en}: {type}`] = `${de}: {type}`;
  deliveryReasons[`${en}: {type} (new serial)`] = `${de}: {type} (neue Seriennummer)`;
}
for (const [en, de] of [
  ["same serial number", "gleiche Seriennummer"],
  ["same asset number", "gleiche Inventarnummer"],
] as const) {
  deliveryReasons[`${en} as {item}, but a different equipment type was chosen`] = `${de} wie {item}, aber ein anderer Equipment-Typ wurde gewählt`;
  deliveryReasons[`${en} - on the project ✓`] = `${de} – auf dem Projekt ✓`;
  deliveryReasons[`${en} - known item ({item})`] = `${de} – bekanntes Teil ({item})`;
  deliveryReasons[`${en} - {item}`] = `${de} – {item}`;
}

/** Document kinds at the start of summaries. */
const documentKinds: Dict = {};
for (const [en, de] of [
  ["Delivery note", "Lieferschein"],
  ["Return note", "Rückgabeschein"],
  ["Current list", "Bestandsliste"],
] as const) {
  documentKinds[`${en} uploaded (1 file)`] = `${de} hochgeladen (1 Datei)`;
  documentKinds[`${en} uploaded ({n} files)`] = `${de} hochgeladen ({n} Dateien)`;
  documentKinds[`${en} {number} uploaded`] = `${de} {number} hochgeladen`;
  documentKinds[`${en} {number} discarded`] = `${de} {number} verworfen`;
  documentKinds[`${en} discarded`] = `${de} verworfen`;
}

export const messages: Dict = {
  ...transitions,
  ...splitReasons,
  ...savedFields,
  ...returnReasons,
  ...deliveryReasons,
  ...documentKinds,

  // ---------------------------------------------------------------------------
  // General (runAction, permissions, not found)
  "Please check the highlighted fields.": "Bitte die markierten Felder prüfen.",
  "Something went wrong. Please try again.": "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  "You do not have permission to do this.": "Dafür fehlt die Berechtigung.",
  "{what} not found.": "{what} nicht gefunden.",
  "Category not found.": "Kategorie nicht gefunden.",
  "Document not found.": "Dokument nicht gefunden.",
  "Equipment item not found.": "Equipment-Teil nicht gefunden.",
  "Equipment type not found.": "Equipment-Typ nicht gefunden.",
  "Expected item not found.": "Soll-Position nicht gefunden.",
  "History entry not found.": "Verlaufseintrag nicht gefunden.",
  "Image not found.": "Bild nicht gefunden.",
  "Line not found.": "Zeile nicht gefunden.",
  "Photo not found.": "Foto nicht gefunden.",
  "Project not found.": "Projekt nicht gefunden.",
  "Reference image not found.": "Referenzbild nicht gefunden.",
  "Rental house not found.": "Verleih nicht gefunden.",
  "Running search not found.": "Laufende Suche nicht gefunden.",
  "Set template not found.": "Set-Vorlage nicht gefunden.",
  "Set not found.": "Set nicht gefunden.",
  "Template line not found.": "Vorlagenzeile nicht gefunden.",
  "Member not found.": "Mitglied nicht gefunden.",
  "Parent category not found.": "Übergeordnete Kategorie nicht gefunden.",
  "This item was changed by someone else in the meantime. Reload and try again.":
    "Dieses Teil wurde inzwischen von jemand anderem geändert. Neu laden und erneut versuchen.",

  // ---------------------------------------------------------------------------
  // Validation (custom texts and zod's default English messages)
  Required: "Pflichtfeld",
  "At least 1": "Mindestens 1",
  "At least 8 characters": "Mindestens 8 Zeichen",
  "Enter a valid email address": "Gültige E-Mail-Adresse eingeben",
  "Choose an equipment type or category": "Equipment-Typ oder Kategorie wählen",
  "Choose a limit": "Anzahl wählen",
  "Enter a search": "Suchbegriff eingeben",
  "Manufacturer?": "Hersteller?",
  "Model?": "Modell?",
  "Please give a short reason": "Bitte kurz begründen",
  "Paste the image address (it starts with https://)": "Bildadresse einfügen (beginnt mit https://)",
  "Invalid input: expected string, received undefined": "Pflichtfeld",
  "Invalid input: expected number, received undefined": "Pflichtfeld",
  "Invalid input: expected number, received NaN": "Bitte eine Zahl eingeben",
  "Invalid input: expected int, received number": "Bitte eine ganze Zahl eingeben",
  "Invalid input: expected {expected}, received {received}": "Ungültige Eingabe: {expected} erwartet, {received} erhalten",
  "Invalid input: expected {value}": "Ungültige Eingabe: {value} erwartet",
  "Invalid option: expected one of {options}": "Ungültige Auswahl: erlaubt ist eines von {options}",
  "Invalid input: more than one option matched": "Ungültige Eingabe: mehrere Möglichkeiten passen",
  "Invalid input": "Ungültige Eingabe",
  "Invalid email address": "Ungültige E-Mail-Adresse",
  "Invalid UUID": "Ungültige Auswahl",
  "Invalid ISO date": "Ungültiges Datum",
  "Invalid ISO datetime": "Ungültige Zeitangabe",
  "Invalid ISO time": "Ungültige Uhrzeit",
  "Invalid URL": "Ungültige Adresse (URL)",
  "Invalid string: must match pattern {pattern}": "Ungültiger Text: muss dem Muster {pattern} entsprechen",
  "Invalid string: must start with {prefix}": "Ungültiger Text: muss mit {prefix} beginnen",
  "Invalid string: must end with {suffix}": "Ungültiger Text: muss mit {suffix} enden",
  "Invalid string: must include {text}": "Ungültiger Text: muss {text} enthalten",
  "Invalid number: must be a multiple of {n}": "Ungültige Zahl: muss ein Vielfaches von {n} sein",
  "Too big: expected string to have <={max} characters": "Zu lang: höchstens {max} Zeichen",
  "Too big: expected string to have <{max} characters": "Zu lang: weniger als {max} Zeichen",
  "Too small: expected string to have >={min} characters": "Zu kurz: mindestens {min} Zeichen",
  "Too small: expected string to have >{min} characters": "Zu kurz: mehr als {min} Zeichen",
  "Too big: expected number to be <={max}": "Zu groß: höchstens {max}",
  "Too big: expected number to be <{max}": "Zu groß: kleiner als {max}",
  "Too small: expected number to be >={min}": "Zu klein: mindestens {min}",
  "Too small: expected number to be >{min}": "Zu klein: größer als {min}",
  "Too big: expected array to have <={max} items": "Zu viele Einträge: höchstens {max}",
  "Too small: expected array to have >={min} items": "Zu wenige Einträge: mindestens {min}",
  "Too big: expected file to have <={max} bytes": "Datei zu groß: höchstens {max} Bytes",
  "Too big: {detail}": "Zu groß: {detail}",
  "Too small: {detail}": "Zu klein: {detail}",
  "Unrecognized key: {keys}": "Unbekanntes Feld: {keys}",
  "Unrecognized keys: {keys}": "Unbekannte Felder: {keys}",

  // ---------------------------------------------------------------------------
  // Sign-in, sign-up, workspace members
  "Invalid email or password.": "E-Mail oder Passwort ist falsch.",
  "Invalid email or password": "E-Mail oder Passwort ist falsch",
  "Invalid email": "Ungültige E-Mail-Adresse",
  "Invalid password": "Ungültiges Passwort",
  "Password too short": "Passwort zu kurz",
  "Password too long": "Passwort zu lang",
  "User already exists.": "Dieses Konto gibt es bereits.",
  "User already exists. Use another email.": "Dieses Konto gibt es bereits. Bitte eine andere E-Mail-Adresse verwenden.",
  "Failed to create user": "Konto konnte nicht angelegt werden",
  "Email not verified": "E-Mail-Adresse nicht bestätigt",
  "Sign-up is disabled on this server. Ask an admin for an account.":
    "Die Registrierung ist auf diesem Server deaktiviert. Bitte einen Admin um ein Konto bitten.",
  "Could not create the account.": "Das Konto konnte nicht angelegt werden.",
  "This person has no account yet — enter their name and a temporary password.":
    "Diese Person hat noch kein Konto — Name und ein vorläufiges Passwort eingeben.",
  "Set a temporary password for the new account.": "Ein vorläufiges Passwort für das neue Konto festlegen.",
  "{name} is already a member.": "{name} ist bereits Mitglied.",
  "Only an owner can change another owner's role.": "Nur ein Eigentümer kann die Rolle eines anderen Eigentümers ändern.",
  "A workspace needs at least one owner.": "Ein Arbeitsbereich braucht mindestens einen Eigentümer.",
  "Workspace renamed.": "Arbeitsbereich umbenannt.",
  "{name} added.": "{name} hinzugefügt.",
  "Role updated.": "Rolle geändert.",

  // ---------------------------------------------------------------------------
  // Generic action results
  "Saved.": "Gespeichert.",
  "Added.": "Hinzugefügt.",
  "Created.": "Angelegt.",
  "Restored.": "Wiederhergestellt.",
  "Undone.": "Rückgängig gemacht.",
  "Nothing changed.": "Nichts geändert.",
  "Unknown action.": "Unbekannte Aktion.",

  // ---------------------------------------------------------------------------
  // Projects
  "A project named “{name}” already exists.": "Ein Projekt namens „{name}“ gibt es bereits.",
  "End date must be on or after the start date.": "Das Enddatum darf nicht vor dem Startdatum liegen.",
  "Project {name} is closed.": "Projekt {name} ist abgeschlossen.",
  "The project is closed.": "Das Projekt ist abgeschlossen.",
  "Project {name} is closed; equipment cannot be added to it.": "Projekt {name} ist abgeschlossen; es kann kein Equipment hinzugefügt werden.",
  "{name} still has 1 piece of equipment. Return or remove it first.": "{name} hat noch 1 Stück Equipment. Zuerst zurückgeben oder entfernen.",
  "{name} still has {n} pieces of equipment. Return or remove them first.": "{name} hat noch {n} Stück Equipment. Zuerst zurückgeben oder entfernen.",
  "Added to project.": "Zum Projekt hinzugefügt.",
  "Removed from project.": "Vom Projekt entfernt.",
  "Tick some equipment first.": "Zuerst Equipment ankreuzen.",
  "Choose what to do with it.": "Auswählen, was damit geschehen soll.",
  "1 piece added to the set.": "1 Stück ins Set gepackt.",
  "{n} pieces added to the set.": "{n} Stück ins Set gepackt.",
  "1 piece taken out of their set.": "1 Stück aus dem Set genommen.",
  "{n} pieces taken out of their set.": "{n} Stück aus ihrem Set genommen.",
  "1 piece updated (status).": "1 Stück geändert (Status).",
  "{n} pieces updated (status).": "{n} Stück geändert (Status).",
  "1 piece updated (condition).": "1 Stück geändert (Zustand).",
  "{n} pieces updated (condition).": "{n} Stück geändert (Zustand).",
  "Choose the sets or items to remove.": "Die zu entfernenden Sets oder Teile wählen.",
  "The return note belongs to another project.": "Der Rückgabeschein gehört zu einem anderen Projekt.",
  "A chosen set is not on this project.": "Ein gewähltes Set ist nicht auf diesem Projekt.",
  "{item} is no longer on {project}. Reload the page.": "{item} ist nicht mehr auf {project}. Seite neu laden.",

  // ---------------------------------------------------------------------------
  // Rental houses, categories, standard catalog, settings
  "A rental house named “{name}” already exists.": "Einen Verleih namens „{name}“ gibt es bereits.",
  "A category named “{name}” already exists here.": "Eine Kategorie namens „{name}“ gibt es hier bereits.",
  "A category cannot be moved below one of its own subcategories.": "Eine Kategorie kann nicht unter eine ihrer eigenen Unterkategorien verschoben werden.",
  "Category “{name}” added.": "Kategorie „{name}“ hinzugefügt.",
  "Choose at least one area to import.": "Mindestens einen Bereich zum Importieren wählen.",
  "Choose at least one region to import.": "Mindestens eine Region zum Importieren wählen.",
  "Unknown catalog area: {area}": "Unbekannter Katalogbereich: {area}",
  "Unknown region: {region}": "Unbekannte Region: {region}",
  "Nothing new to add — all {n} types of these areas are already in your catalog.":
    "Nichts Neues — alle {n} Typen dieser Bereiche sind bereits im Katalog.",
  "1 equipment type added.": "1 Equipment-Typ hinzugefügt.",
  "{n} equipment types added.": "{n} Equipment-Typen hinzugefügt.",
  "1 equipment type added ({skipped} already present, left unchanged).": "1 Equipment-Typ hinzugefügt ({skipped} bereits vorhanden, unverändert).",
  "{n} equipment types added ({skipped} already present, left unchanged).": "{n} Equipment-Typen hinzugefügt ({skipped} bereits vorhanden, unverändert).",
  "1 equipment type added; {corrected} corrected.": "1 Equipment-Typ hinzugefügt; {corrected} korrigiert.",
  "{n} equipment types added; {corrected} corrected.": "{n} Equipment-Typen hinzugefügt; {corrected} korrigiert.",
  "1 equipment type added ({skipped} already present, left unchanged); {corrected} corrected.":
    "1 Equipment-Typ hinzugefügt ({skipped} bereits vorhanden, unverändert); {corrected} korrigiert.",
  "{n} equipment types added ({skipped} already present, left unchanged); {corrected} corrected.":
    "{n} Equipment-Typen hinzugefügt ({skipped} bereits vorhanden, unverändert); {corrected} korrigiert.",
  "Nothing new to add — all {n} rental houses of these regions are already in your list.":
    "Nichts Neues — alle {n} Verleihe dieser Regionen sind bereits in der Liste.",
  "1 rental house added.": "1 Verleih hinzugefügt.",
  "{n} rental houses added.": "{n} Verleihe hinzugefügt.",
  "1 rental house added ({skipped} already present, left unchanged).": "1 Verleih hinzugefügt ({skipped} bereits vorhanden, unverändert).",
  "{n} rental houses added ({skipped} already present, left unchanged).": "{n} Verleihe hinzugefügt ({skipped} bereits vorhanden, unverändert).",

  // ---------------------------------------------------------------------------
  // Equipment types and items
  "{manufacturer} {model} already exists in the equipment database.": "{manufacturer} {model} gibt es bereits in der Equipment-Datenbank.",
  "Choose the types to delete.": "Die zu löschenden Typen wählen.",
  "Still in use: {list}. Remove those pieces from their project first.": "Noch in Gebrauch: {list}. Diese Teile zuerst von ihrem Projekt entfernen.",
  "{type} ({n} on a project)": "{type} ({n} auf einem Projekt)",
  "{type} deleted. Undo it in the history if needed.": "{type} gelöscht. Bei Bedarf im Verlauf rückgängig machen.",
  "{n} types deleted. Undo in the history if needed.": "{n} Typen gelöscht. Bei Bedarf im Verlauf rückgängig machen.",
  "Another item already has serial number “{value}”. Physical items are never merged automatically — open the existing item instead.":
    "Ein anderes Teil hat bereits die Seriennummer „{value}“. Physische Teile werden nie automatisch zusammengeführt — stattdessen das vorhandene Teil öffnen.",
  "Another item already has asset number “{value}”. Physical items are never merged automatically — open the existing item instead.":
    "Ein anderes Teil hat bereits die Inventarnummer „{value}“. Physische Teile werden nie automatisch zusammengeführt — stattdessen das vorhandene Teil öffnen.",
  "Serialized items always have quantity 1. Create one item per serial number.":
    "Teile mit Seriennummer haben immer die Menge 1. Pro Seriennummer ein Teil anlegen.",
  "Serialized items always have quantity 1.": "Teile mit Seriennummer haben immer die Menge 1.",
  "{item} is tracked individually.": "{item} wird einzeln geführt.",
  "{item} is tracked individually and cannot be split.": "{item} wird einzeln geführt und kann nicht aufgeteilt werden.",
  "Choose between 1 and {max} units.": "Zwischen 1 und {max} Stück wählen.",
  "Only equipment on a project can change status. Add it to a project first.":
    "Nur Equipment auf einem Projekt kann den Status ändern. Zuerst zu einem Projekt hinzufügen.",
  "{item} is still on {project}. Return it or remove it from that project first.":
    "{item} ist noch auf {project}. Zuerst zurückgeben oder von diesem Projekt entfernen.",
  "{item} is still on another project. Return it or remove it from that project first.":
    "{item} ist noch auf einem anderen Projekt. Zuerst zurückgeben oder von diesem Projekt entfernen.",
  "{item} is not on a project.": "{item} ist auf keinem Projekt.",
  "No equipment to change.": "Kein Equipment zum Ändern.",
  "There is already a {type} with serial number {serial}.": "Es gibt bereits ein {type} mit der Seriennummer {serial}.",
  "That status can only be restored on a project.": "Dieser Status kann nur auf einem Projekt wiederhergestellt werden.",

  // ---------------------------------------------------------------------------
  // Sets and set templates
  "Set {name} is archived.": "Set {name} ist archiviert.",
  "This project already has a set named “{name}”.": "Dieses Projekt hat bereits ein Set namens „{name}“.",
  "Another set already uses this barcode.": "Ein anderes Set verwendet diesen Barcode bereits.",
  "A template named “{name}” already exists.": "Eine Vorlage namens „{name}“ gibt es bereits.",
  "Set {name} still contains 1 item. Unpack them first.": "Set {name} enthält noch 1 Teil. Zuerst auspacken.",
  "Set {name} still contains {n} items. Unpack them first.": "Set {name} enthält noch {n} Teile. Zuerst auspacken.",
  "{set} is empty. Pack it first, then use its contents.": "{set} ist leer. Zuerst packen, dann den Inhalt übernehmen.",
  "{item} is on another project and cannot go into this set.": "{item} ist auf einem anderen Projekt und kann nicht in dieses Set.",
  "{item} is not on this project. Add it to the project first.": "{item} ist nicht auf diesem Projekt. Zuerst zum Projekt hinzufügen.",
  "{item} is packed in {set}. Move it here?": "{item} ist in {set} gepackt. Hierher umpacken?",
  "{item} is packed in another case. Move it here?": "{item} ist in einem anderen Set gepackt. Hierher umpacken?",
  "Choose how many to pack.": "Anzahl zum Packen wählen.",
  "{item} has a serial number. Pack it on its own.": "{item} hat eine Seriennummer. Einzeln packen.",
  "Nothing left to pack. Reload the page.": "Nichts mehr zu packen. Seite neu laden.",
  "Choose how many to take out.": "Anzahl zum Herausnehmen wählen.",
  "{item} has a serial number. Take it out on its own.": "{item} hat eine Seriennummer. Einzeln herausnehmen.",
  "Scan or type a code first.": "Zuerst einen Code scannen oder eingeben.",
  "No equipment with code “{code}”.": "Kein Equipment mit dem Code „{code}“.",
  "No equipment or set with code “{code}”.": "Kein Equipment und kein Set mit dem Code „{code}“.",
  "Code “{code}” matches several items. Pick the item from the list instead.":
    "Der Code „{code}“ passt zu mehreren Teilen. Stattdessen das Teil aus der Liste wählen.",
  "This set has no expected contents to save.": "Dieses Set hat keinen Soll-Inhalt zum Speichern.",
  "This template is archived.": "Diese Vorlage ist archiviert.",
  "Added — 1 piece packed.": "Hinzugefügt — 1 Stück gepackt.",
  "Added — {n} pieces packed.": "Hinzugefügt — {n} Stück gepackt.",
  "Expected contents set: 1 type.": "Soll-Inhalt festgelegt: 1 Typ.",
  "Expected contents set: {n} types.": "Soll-Inhalt festgelegt: {n} Typen.",
  "Tick what goes into this set.": "Ankreuzen, was in dieses Set kommt.",
  "1 piece added.": "1 Stück hinzugefügt.",
  "{n} pieces added.": "{n} Stück hinzugefügt.",
  "{item} is already in this set.": "{item} ist bereits in diesem Set.",
  "{item} moved here.": "{item} hierher umgepackt.",
  "{item} packed.": "{item} gepackt.",

  // ---------------------------------------------------------------------------
  // Photos and images
  "Choose at least one photo.": "Mindestens ein Foto wählen.",
  "Upload at most 12 photos at once.": "Höchstens 12 Fotos auf einmal hochladen.",
  "Photo added.": "Foto hinzugefügt.",
  "{n} photos added.": "{n} Fotos hinzugefügt.",
  "Photo removed.": "Foto entfernt.",
  "Choose a photo first.": "Zuerst ein Foto wählen.",
  "{n} images found.": "{n} Bilder gefunden.",
  "No images found. Try other words, or use Google Images.": "Keine Bilder gefunden. Andere Suchbegriffe versuchen oder Google Bilder verwenden.",
  "Image saved as the reference image.": "Bild als Referenzbild gespeichert.",
  "Main image changed.": "Hauptbild geändert.",
  "Image found and applied (auto-selected). Not right? Use “Change image”.":
    "Bild gefunden und übernommen (automatisch gewählt). Nicht passend? „Bild ändern“ verwenden.",
  "This type already has an image.": "Dieser Typ hat bereits ein Bild.",
  "No image was clearly right. Pick one yourself.": "Kein Bild passte eindeutig. Bitte selbst eines auswählen.",
  "Started: 1 equipment type.": "Gestartet: 1 Equipment-Typ.",
  "Started: {n} equipment types.": "Gestartet: {n} Equipment-Typen.",
  "Stopping after the current type…": "Wird nach dem aktuellen Typ beendet…",
  "Image search is not configured (BRAVE_SEARCH_API_KEY).": "Die Bildsuche ist nicht eingerichtet (BRAVE_SEARCH_API_KEY).",
  "Image search is not configured on this server (BRAVE_SEARCH_API_KEY). Use “Open in Google Images” or paste an image address.":
    "Die Bildsuche ist auf diesem Server nicht eingerichtet (BRAVE_SEARCH_API_KEY). „In Google Bilder öffnen“ verwenden oder eine Bildadresse einfügen.",
  "A search is already running. Wait for it or cancel it.": "Es läuft bereits eine Suche. Abwarten oder abbrechen.",
  "Every equipment type with items already has an image (or is waiting in the review list).":
    "Jeder Equipment-Typ mit Teilen hat bereits ein Bild (oder wartet in der Prüfliste).",
  "Every equipment type already has an image (or is waiting in the review list).":
    "Jeder Equipment-Typ hat bereits ein Bild (oder wartet in der Prüfliste).",
  "Only an interrupted or failed search can be resumed.": "Nur eine unterbrochene oder fehlgeschlagene Suche kann fortgesetzt werden.",
  "No search results": "Keine Suchergebnisse",
  "No result was a confident match": "Kein Ergebnis passte sicher",
  "Unexpected error": "Unerwarteter Fehler",
  "Image search is unreachable. Try again.": "Die Bildsuche ist nicht erreichbar. Erneut versuchen.",
  "The image search API key is invalid (BRAVE_SEARCH_API_KEY).": "Der API-Schlüssel der Bildsuche ist ungültig (BRAVE_SEARCH_API_KEY).",
  "Image search limit reached. Try again later.": "Limit der Bildsuche erreicht. Später erneut versuchen.",
  "Image search failed ({status}).": "Bildsuche fehlgeschlagen ({status}).",
  "The file is empty.": "Die Datei ist leer.",
  "Photos can be at most 25 MB.": "Fotos dürfen höchstens 25 MB groß sein.",
  "This file is not an image we can read. Use JPEG, PNG or WebP.": "Diese Datei ist kein lesbares Bild. JPEG, PNG oder WebP verwenden.",
  "Unsupported image format. Use JPEG, PNG or WebP.": "Nicht unterstütztes Bildformat. JPEG, PNG oder WebP verwenden.",
  "Unsupported image format ({format}). Use JPEG, PNG or WebP.": "Nicht unterstütztes Bildformat ({format}). JPEG, PNG oder WebP verwenden.",
  "The image could not be processed. It may be damaged or in an unsupported format (e.g. HEIC).":
    "Das Bild konnte nicht verarbeitet werden. Es ist eventuell beschädigt oder in einem nicht unterstützten Format (z. B. HEIC).",
  "That is not a valid image address.": "Das ist keine gültige Bildadresse.",
  "Only http(s) image addresses are allowed.": "Nur http(s)-Bildadressen sind erlaubt.",
  "Image addresses with credentials are not allowed.": "Bildadressen mit Zugangsdaten sind nicht erlaubt.",
  "This address is not allowed.": "Diese Adresse ist nicht erlaubt.",
  "This address points to a private network and is not allowed.": "Diese Adresse zeigt in ein privates Netzwerk und ist nicht erlaubt.",
  "The image could not be downloaded (site unreachable or too slow).": "Das Bild konnte nicht heruntergeladen werden (Seite nicht erreichbar oder zu langsam).",
  "The site answered with error {status}.": "Die Seite antwortete mit Fehler {status}.",
  "That address is not an image (or it is an SVG, which is not accepted).": "Diese Adresse ist kein Bild (oder ein SVG, das nicht angenommen wird).",
  "The image is too large.": "Das Bild ist zu groß.",
  "Too many redirects.": "Zu viele Weiterleitungen.",
  "The server cannot save files: the storage folder is not writable ({code}). Ask the administrator to fix the permissions of the storage volume.":
    "Der Server kann keine Dateien speichern: Der Speicherordner ist nicht beschreibbar ({code}). Bitte die Administration, die Berechtigungen des Speichervolumes zu korrigieren.",

  // ---------------------------------------------------------------------------
  // Documents: upload, reading, review, confirm
  "Add the PDF or photos of the document.": "PDF oder Fotos des Dokuments hinzufügen.",
  "At most {n} files per document.": "Höchstens {n} Dateien pro Dokument.",
  "The files are larger than 100 MB together. Upload fewer pages or smaller photos.":
    "Die Dateien sind zusammen größer als 100 MB. Weniger Seiten oder kleinere Fotos hochladen.",
  "{file} is empty.": "{file} ist leer.",
  "{file} is larger than 25 MB.": "{file} ist größer als 25 MB.",
  "Choose the project (AI reading is not configured, so it cannot be detected from the document).":
    "Projekt wählen (KI-Erkennung ist nicht eingerichtet, daher kann es nicht aus dem Dokument erkannt werden).",
  "This document is already confirmed and can no longer be changed.": "Dieses Dokument ist bereits bestätigt und kann nicht mehr geändert werden.",
  "This document was discarded.": "Dieses Dokument wurde verworfen.",
  "The document is still being read. Wait a moment.": "Das Dokument wird noch gelesen. Einen Moment warten.",
  "File {file} is missing from storage.": "Datei {file} fehlt im Speicher.",
  "Reading the document failed unexpectedly. Try again or enter the lines manually.":
    "Das Lesen des Dokuments ist unerwartet fehlgeschlagen. Erneut versuchen oder die Zeilen manuell eingeben.",
  "AI reading is not configured on this server.": "KI-Lesen ist auf diesem Server nicht eingerichtet.",
  "AI reading is not configured on this server. Enter the lines manually.": "KI-Lesen ist auf diesem Server nicht eingerichtet. Die Zeilen manuell eingeben.",
  "This document cannot be read again.": "Dieses Dokument kann nicht erneut gelesen werden.",
  "Reading was interrupted. Try again.": "Das Lesen wurde unterbrochen. Erneut versuchen.",
  "No readable file (PDF or image) in this document.": "Keine lesbare Datei (PDF oder Bild) in diesem Dokument.",
  "The Anthropic API key is invalid. Check ANTHROPIC_API_KEY.": "Der Anthropic-API-Schlüssel ist ungültig. ANTHROPIC_API_KEY prüfen.",
  "The AI service is busy (rate limit). Try again in a minute.": "Der KI-Dienst ist ausgelastet (Rate-Limit). In einer Minute erneut versuchen.",
  "The AI service rejected the document: {error}": "Der KI-Dienst hat das Dokument abgelehnt: {error}",
  "AI service error ({status}). Try again.": "Fehler beim KI-Dienst ({status}). Erneut versuchen.",
  "The AI declined to read this document. Enter the lines manually.": "Die KI hat das Lesen dieses Dokuments abgelehnt. Die Zeilen manuell eingeben.",
  "The document is too long to read in one go. Split it into smaller uploads.":
    "Das Dokument ist zu lang, um es in einem Durchgang zu lesen. In kleinere Uploads aufteilen.",
  "The AI response could not be read. Try again.": "Die Antwort der KI konnte nicht gelesen werden. Erneut versuchen.",
  "Confirmed documents cannot be discarded; their history must stay intact.":
    "Bestätigte Dokumente können nicht verworfen werden; ihr Verlauf muss erhalten bleiben.",
  "Choose the project.": "Projekt wählen.",
  "Choose the rental house the equipment goes back to.": "Den Verleih wählen, an den das Equipment zurückgeht.",
  "Choose the rental house that delivered the equipment.": "Den Verleih wählen, der das Equipment geliefert hat.",
  "There are no equipment lines to confirm.": "Es gibt keine Equipment-Zeilen zum Bestätigen.",
  "Line {n}: choose the item that is returned (or ignore the line).": "Zeile {n}: das zurückgegebene Teil wählen (oder die Zeile ignorieren).",
  "Line {n}: choose the equipment type (or ignore the line).": "Zeile {n}: den Equipment-Typ wählen (oder die Zeile ignorieren).",
  "Line {n}: {msg} — fix it or ignore the line.": "Zeile {n}: {msg} — korrigieren oder die Zeile ignorieren.",
  "resolve the conflict": "Konflikt lösen",
  "{item} is on another project. Return it there first.": "{item} ist auf einem anderen Projekt. Zuerst dort zurückgeben.",
  "Line {n}: serial or asset number already exists. Reload the document to re-check.":
    "Zeile {n}: Serien- oder Inventarnummer existiert bereits. Dokument neu laden, um erneut zu prüfen.",
  "Only delivery notes can be confirmed here.": "Hier können nur Lieferscheine bestätigt werden.",
  "Only return notes can be confirmed as a return.": "Nur Rückgabescheine können als Rückgabe bestätigt werden.",
  "Line {n}: {item} is no longer on this project. Reload the note.": "Zeile {n}: {item} ist nicht mehr auf diesem Projekt. Schein neu laden.",
  "Confirm the delivery note first; then its sets can be created.": "Zuerst den Lieferschein bestätigen; dann können seine Sets angelegt werden.",
  "No set “{name}” on this note.": "Kein Set „{name}“ auf diesem Schein.",
  "{name} makes {copies} identical sets, not {n}.": "{name} ergibt {copies} gleiche Sets, nicht {n}.",
  "Give every set a name.": "Jedem Set einen Namen geben.",
  "Set names can be at most 80 characters.": "Set-Namen dürfen höchstens 80 Zeichen lang sein.",
  "Each set needs its own name.": "Jedes Set braucht einen eigenen Namen.",
  "There is already a set called {name} on this project.": "Auf diesem Projekt gibt es bereits ein Set namens {name}.",
  "Only current lists are compared with the database.": "Nur Bestandslisten werden mit der Datenbank abgeglichen.",
  "This list is closed.": "Diese Liste ist abgeschlossen.",
  "Choose the project first.": "Zuerst das Projekt wählen.",
  "Choose the rental house first.": "Zuerst den Verleih wählen.",
  "Nothing on the list can be added (check the open lines).": "Nichts auf der Liste kann hinzugefügt werden (offene Zeilen prüfen).",
  "This line cannot be added. Reload the page.": "Diese Zeile kann nicht hinzugefügt werden. Seite neu laden.",
  "Nothing to remove. Reload the page.": "Nichts zu entfernen. Seite neu laden.",
  "Project {name} created.": "Projekt {name} angelegt.",
  "Created and used for {n} lines.": "Angelegt und für {n} Zeilen verwendet.",
  "Saved — also used for 1 more line with the same product.": "Gespeichert — auch für 1 weitere Zeile mit demselben Produkt verwendet.",
  "Saved — also used for {n} more lines with the same product.": "Gespeichert — auch für {n} weitere Zeilen mit demselben Produkt verwendet.",
  "Line added.": "Zeile hinzugefügt.",
  "Confirmed: 1 item received.": "Bestätigt: 1 Teil erhalten.",
  "Confirmed: {n} items received.": "Bestätigt: {n} Teile erhalten.",
  "Return confirmed: {returned} returned, {remaining} still on the project.": "Rückgabe bestätigt: {returned} zurückgegeben, {remaining} noch auf dem Projekt.",
  "Return confirmed: {returned} returned.": "Rückgabe bestätigt: {returned} zurückgegeben.",
  "Issue reported.": "Problem gemeldet.",
  "{n} sets created.": "{n} Sets angelegt.",
  "1 set created.": "1 Set angelegt.",
  "1 piece added to the project.": "1 Stück zum Projekt hinzugefügt.",
  "{n} pieces added to the project.": "{n} Stück zum Projekt hinzugefügt.",
  "1 piece taken off the project.": "1 Stück vom Projekt genommen.",
  "{n} pieces taken off the project.": "{n} Stück vom Projekt genommen.",
  "List checked and closed.": "Liste geprüft und abgeschlossen.",
  "Choose the right equipment type.": "Den richtigen Equipment-Typ wählen.",
  "Nothing from this line is on the project any more.": "Nichts aus dieser Zeile ist noch auf dem Projekt.",
  "1 piece changed to {type}.": "1 Stück zu {type} geändert.",
  "{n} pieces changed to {type}.": "{n} Stück zu {type} geändert.",
  "Already {type}.": "Bereits {type}.",

  // ---------------------------------------------------------------------------
  // Document lines: match reasons
  "heading - not an item; groups the lines below it": "Überschrift – kein Teil; gruppiert die Zeilen darunter",
  "(unreadable line)": "(unlesbare Zeile)",
  "not equipment (fees, notes …)": "kein Equipment (Gebühren, Hinweise …)",
  "case - becomes a set with the items grouped under it": "Case – wird ein Set mit den darunter gruppierten Teilen",
  "case - kept as a set, not as equipment": "Case – als Set geführt, nicht als Equipment",
  "serial {serial} appears twice on this document": "Seriennummer {serial} kommt zweimal in diesem Dokument vor",
  "serial {serial} exists on {n} different products - choose the equipment type":
    "Seriennummer {serial} gibt es bei {n} verschiedenen Produkten – Equipment-Typ wählen",
  "{item} is already on this project (delivered twice?)": "{item} ist bereits auf diesem Projekt (doppelt geliefert?)",
  "{item} is still on {project} - return it there first": "{item} ist noch auf {project} – zuerst dort zurückgeben",
  "{item} is still on another project - return it there first": "{item} ist noch auf einem anderen Projekt – zuerst dort zurückgeben",
  "{item} belongs to another rental house - check the serial": "{item} gehört einem anderen Verleih – Seriennummer prüfen",
  "type chosen by reviewer": "Typ manuell gewählt",
  "no matching equipment type - choose one or create it": "kein passender Equipment-Typ – einen wählen oder anlegen",
  "ignored by reviewer": "manuell ignoriert",
  "choose the project first": "zuerst das Projekt wählen",
  "item not found": "Teil nicht gefunden",
  "{item} was already returned": "{item} wurde bereits zurückgegeben",
  "{item} is on {project}, not on this project": "{item} ist auf {project}, nicht auf diesem Projekt",
  "{item} is not on any project": "{item} ist auf keinem Projekt",
  "{item} belongs to {house}, not to the rental house of this note": "{item} gehört zu {house}, nicht zum Verleih dieses Scheins",
  "{item} belongs to another rental house, not to the rental house of this note": "{item} gehört einem anderen Verleih, nicht dem Verleih dieses Scheins",
  "only {n} of {type} left on the project, note says {units}": "nur noch {n} von {type} auf dem Projekt, laut Schein {units}",
  "quantity {n} for one individually tracked item - split the line": "Menge {n} für ein einzeln geführtes Teil – Zeile aufteilen",
  "{item} is already on another line of this note": "{item} steht bereits in einer anderen Zeile dieses Scheins",
  "serial {serial} appears twice on this note": "Seriennummer {serial} kommt zweimal auf diesem Schein vor",
  "serial {serial} matches {n} products on this project - choose the item": "Seriennummer {serial} passt zu {n} Produkten auf diesem Projekt – Teil wählen",
  "no item with serial {serial} on this project (unknown equipment)": "kein Teil mit Seriennummer {serial} auf diesem Projekt (unbekanntes Equipment)",
  "no item with asset {asset} on this project (unknown equipment)": "kein Teil mit Inventarnummer {asset} auf diesem Projekt (unbekanntes Equipment)",
  "which item is this? choose it from the project's equipment": "welches Teil ist das? aus dem Equipment des Projekts wählen",
  "only {n} {type} left on the project from this rental house, note says {units}": "nur noch {n} {type} von diesem Verleih auf dem Projekt, laut Schein {units}",
  "no {type} from this rental house left on the project": "kein {type} von diesem Verleih mehr auf dem Projekt",
  "note lists {units} {type}, only {n} on the project": "Schein listet {units} {type}, nur {n} auf dem Projekt",
  "{n} {type} on the project - choose which one is returned": "{n} {type} auf dem Projekt – wählen, welches zurückgegeben wird",
  "not matched": "nicht zugeordnet",
  "{msg} · issue reported": "{msg} · Problem gemeldet",
  "issue reported": "Problem gemeldet",
  "serial number match": "Seriennummer stimmt überein",
  "alias match": "Schreibweise bekannt",

  // ---------------------------------------------------------------------------
  // History: undo
  "Undo: {msg}": "Rückgängig: {msg}",
  "This was changed again since. Undo the newer change first (newest first).":
    "Das wurde seitdem erneut geändert. Zuerst die neuere Änderung rückgängig machen (neueste zuerst).",
  "This change cannot be undone here.": "Diese Änderung kann hier nicht rückgängig gemacht werden.",
  "This change was undone already.": "Diese Änderung wurde bereits rückgängig gemacht.",

  // History: projects and rental houses
  "Project {name} created": "Projekt {name} angelegt",
  "Project {name} updated": "Projekt {name} geändert",
  "Project {name} deleted": "Projekt {name} gelöscht",
  "Project {name} restored": "Projekt {name} wiederhergestellt",
  "Rental house {name} created": "Verleih {name} angelegt",
  "Rental house {name} created (standard catalog)": "Verleih {name} angelegt (Standardkatalog)",
  "Rental house {name} updated": "Verleih {name} geändert",
  "{house} linked to project": "{house} mit dem Projekt verknüpft",
  "{house} linked to project (order {order})": "{house} mit dem Projekt verknüpft (Auftrag {order})",
  "Rental house linked to project": "Verleih mit dem Projekt verknüpft",
  "Rental house linked to project (order {order})": "Verleih mit dem Projekt verknüpft (Auftrag {order})",
  "Rental house project number {number} saved from the document": "Projektnummer des Verleihs {number} aus dem Dokument übernommen",
  "Standard rental houses imported ({regions}): {created} added, {skipped} already present":
    "Standard-Verleihe importiert ({regions}): {created} hinzugefügt, {skipped} bereits vorhanden",

  // History: categories and equipment types
  "Category {name} created": "Kategorie {name} angelegt",
  "Category {name} created (standard catalog)": "Kategorie {name} angelegt (Standardkatalog)",
  "Category {name} moved": "Kategorie {name} verschoben",
  "Category {name} updated": "Kategorie {name} geändert",
  "Equipment type {name} created": "Equipment-Typ {name} angelegt",
  "Equipment type {name} created (standard catalog)": "Equipment-Typ {name} angelegt (Standardkatalog)",
  "Equipment type {name} updated": "Equipment-Typ {name} geändert",
  "Equipment type {name} deleted": "Equipment-Typ {name} gelöscht",
  "Equipment type {name} restored": "Equipment-Typ {name} wiederhergestellt",
  "Equipment type {name} restored (it had been deleted)": "Equipment-Typ {name} wiederhergestellt (war gelöscht)",
  "{name}: {fields} restored": "{name}: {fields} wiederhergestellt",
  "{old} corrected to {name} (standard catalog)": "{old} korrigiert zu {name} (Standardkatalog)",
  "{type}: 1 spelling added (standard catalog)": "{type}: 1 Schreibweise hinzugefügt (Standardkatalog)",
  "{type}: {n} spellings added (standard catalog)": "{type}: {n} Schreibweisen hinzugefügt (Standardkatalog)",
  "{type}: “{alias}” remembered from a document": "{type}: „{alias}“ aus einem Dokument übernommen",
  "{type}: “{text}” forgotten (it was {other})": "{type}: „{text}“ vergessen (war {other})",
  "Standard catalog imported ({areas}): {msg}": "Standardkatalog importiert ({areas}): {msg}",
  "1 equipment type added, {skipped} already present": "1 Equipment-Typ hinzugefügt, {skipped} bereits vorhanden",
  "{n} equipment types added, {skipped} already present": "{n} Equipment-Typen hinzugefügt, {skipped} bereits vorhanden",
  "1 equipment type added, {skipped} already present, {corrected} corrected": "1 Equipment-Typ hinzugefügt, {skipped} bereits vorhanden, {corrected} korrigiert",
  "{n} equipment types added, {skipped} already present, {corrected} corrected": "{n} Equipment-Typen hinzugefügt, {skipped} bereits vorhanden, {corrected} korrigiert",
  "1 equipment type added, {skipped} already present, new spellings for {aliases}":
    "1 Equipment-Typ hinzugefügt, {skipped} bereits vorhanden, neue Schreibweisen für {aliases}",
  "{n} equipment types added, {skipped} already present, new spellings for {aliases}":
    "{n} Equipment-Typen hinzugefügt, {skipped} bereits vorhanden, neue Schreibweisen für {aliases}",
  "1 equipment type added, {skipped} already present, {corrected} corrected, new spellings for {aliases}":
    "1 Equipment-Typ hinzugefügt, {skipped} bereits vorhanden, {corrected} korrigiert, neue Schreibweisen für {aliases}",
  "{n} equipment types added, {skipped} already present, {corrected} corrected, new spellings for {aliases}":
    "{n} Equipment-Typen hinzugefügt, {skipped} bereits vorhanden, {corrected} korrigiert, neue Schreibweisen für {aliases}",

  // History: equipment items
  "{item} created": "{item} angelegt",
  "{item} added to {project}": "{item} zu {project} hinzugefügt",
  "{item} added as crew-owned equipment": "{item} als Crew-eigenes Equipment hinzugefügt",
  "{item}: {fields} updated": "{item}: {fields} geändert",
  "{item}: type {from} → {to}": "{item}: Typ {from} → {to}",
  "{item} taken out of its set": "{item} aus seinem Set genommen",
  "{item} removed from project": "{item} vom Projekt entfernt",
  "{item} removed from {project}": "{item} von {project} entfernt",
  "{item} returned (removed from {project})": "{item} zurückgegeben (von {project} entfernt)",
  "{type}: {units} of {total} split off ({msg})": "{type}: {units} von {total} abgeteilt ({msg})",
  "{type} × {units} split off from {total} units ({msg})": "{type} × {units} von {total} Stück abgeteilt ({msg})",
  "{type}: {units} of {total} split off for return": "{type}: {units} von {total} für die Rückgabe abgeteilt",
  "{type} × {units} returned to rental house": "{type} × {units} an den Verleih zurückgegeben",
  "{item} unpacked for return": "{item} für die Rückgabe ausgepackt",
  "{item} returned to rental house": "{item} an den Verleih zurückgegeben",
  "Photo added to {target}": "Foto zu {target} hinzugefügt",
  "Photo removed": "Foto entfernt",
  "Reference image changed": "Referenzbild geändert",

  // History: sets and templates
  "Set {name} created": "Set {name} angelegt",
  "Set {name} created from template": "Set {name} aus Vorlage angelegt",
  "Set {name} created from template “{template}”": "Set {name} aus Vorlage „{template}“ angelegt",
  "Set {name} updated": "Set {name} geändert",
  "Set {name} archived": "Set {name} archiviert",
  "Set {name} removed from {project} with its contents": "Set {name} mit Inhalt von {project} entfernt",
  "{set}: expected contents set to what is packed ({pieces} pieces, {types} types)":
    "{set}: Soll-Inhalt auf den gepackten Inhalt gesetzt ({pieces} Stück, {types} Typen)",
  "{set}: expected item renamed to {label}": "{set}: Soll-Position umbenannt in {label}",
  "{set}: no longer expects {label}": "{set}: {label} nicht mehr im Soll",
  "{set}: expects {quantity} × {label}": "{set}: Soll {quantity} × {label}",
  "{set}: expected {label} {from} → {to}": "{set}: Soll {label} {from} → {to}",
  "{set}: expected {label} {from} → {to} after partial return": "{set}: Soll {label} {from} → {to} nach Teilrückgabe",
  "{item} packed into {set}": "{item} in {set} gepackt",
  "{item} packed into set": "{item} ins Set gepackt",
  "{item} taken out of {set}": "{item} aus {set} genommen",
  "{item} taken out of {from} (moved to {to})": "{item} aus {from} genommen (nach {to} umgepackt)",
  "Set template “{name}” created": "Set-Vorlage „{name}“ angelegt",
  "Set template “{name}” saved from set {set}": "Set-Vorlage „{name}“ aus Set {set} gespeichert",
  "Set template “{name}” updated": "Set-Vorlage „{name}“ geändert",
  "Set template “{name}” archived (existing sets keep their contents)": "Set-Vorlage „{name}“ archiviert (bestehende Sets behalten ihren Inhalt)",
  "Template “{name}”: {quantity} × {label} added": "Vorlage „{name}“: {quantity} × {label} hinzugefügt",
  "Template “{name}”: {label} {from} → {to}": "Vorlage „{name}“: {label} {from} → {to}",
  "Template “{name}”: {label} removed": "Vorlage „{name}“: {label} entfernt",

  // History: documents
  "Document {number} read by AI: 1 line": "Dokument {number} von der KI gelesen: 1 Zeile",
  "Document {number} read by AI: {n} lines": "Dokument {number} von der KI gelesen: {n} Zeilen",
  "Document {number} read by AI: 1 line · project detected: {project}": "Dokument {number} von der KI gelesen: 1 Zeile · Projekt erkannt: {project}",
  "Document {number} read by AI: {n} lines · project detected: {project}": "Dokument {number} von der KI gelesen: {n} Zeilen · Projekt erkannt: {project}",
  "Document read by AI: 1 line": "Dokument von der KI gelesen: 1 Zeile",
  "Document read by AI: {n} lines": "Dokument von der KI gelesen: {n} Zeilen",
  "Document read by AI: 1 line · project detected: {project}": "Dokument von der KI gelesen: 1 Zeile · Projekt erkannt: {project}",
  "Document read by AI: {n} lines · project detected: {project}": "Dokument von der KI gelesen: {n} Zeilen · Projekt erkannt: {project}",
  "Document {number} read by extraction service": "Dokument {number} vom Erkennungsdienst gelesen",
  "{item} received on {project}": "{item} auf {project} erhalten",
  "{item} received on project": "{item} auf dem Projekt erhalten",
  "{item} created from delivery note {number}": "{item} aus Lieferschein {number} angelegt",
  "{item} created from delivery note": "{item} aus Lieferschein angelegt",
  "{item} created from current list {number}": "{item} aus Bestandsliste {number} angelegt",
  "{item} created from current list": "{item} aus Bestandsliste angelegt",
  "Delivery note {number} confirmed": "Lieferschein {number} bestätigt",
  "Delivery note confirmed": "Lieferschein bestätigt",
  "Return note {number} confirmed": "Rückgabeschein {number} bestätigt",
  "Return note confirmed": "Rückgabeschein bestätigt",
  "Delivery {number} confirmed: {msg}": "Lieferung {number} bestätigt: {msg}",
  "Delivery confirmed: {msg}": "Lieferung bestätigt: {msg}",
  "1 item received from {house}": "1 Teil von {house} erhalten",
  "{n} items received from {house}": "{n} Teile von {house} erhalten",
  "1 item received from {house}, 1 set created ({sets})": "1 Teil von {house} erhalten, 1 Set angelegt ({sets})",
  "{n} items received from {house}, 1 set created ({sets})": "{n} Teile von {house} erhalten, 1 Set angelegt ({sets})",
  "1 item received from {house}, {k} sets created ({sets})": "1 Teil von {house} erhalten, {k} Sets angelegt ({sets})",
  "{n} items received from {house}, {k} sets created ({sets})": "{n} Teile von {house} erhalten, {k} Sets angelegt ({sets})",
  "{n} lines received from {house}": "{n} Zeilen von {house} erhalten",
  "Return {number} confirmed: {msg}": "Rückgabe {number} bestätigt: {msg}",
  "{n} of {total} items returned": "{n} von {total} Teilen zurückgegeben",
  "partial return ({n} lines); {house} equipment remains on project": "Teilrückgabe ({n} Zeilen); Equipment von {house} bleibt auf dem Projekt",
  "{checked} removed earlier, confirmed by the note · {msg}": "{checked} bereits vorher entfernt, vom Schein bestätigt · {msg}",
  "Return {number}: {returned} returned to {house}, {remaining} still on the project (partial return)":
    "Rückgabe {number}: {returned} an {house} zurückgegeben, {remaining} noch auf dem Projekt (Teilrückgabe)",
  "Return {number}: {returned} returned to {house} — nothing from them left on the project":
    "Rückgabe {number}: {returned} an {house} zurückgegeben — nichts mehr von dort auf dem Projekt",
  "Return : {returned} returned to {house}, {remaining} still on the project (partial return)":
    "Rückgabe: {returned} an {house} zurückgegeben, {remaining} noch auf dem Projekt (Teilrückgabe)",
  "Return : {returned} returned to {house} — nothing from them left on the project":
    "Rückgabe: {returned} an {house} zurückgegeben — nichts mehr von dort auf dem Projekt",
  "Current list {number} checked: {msg}": "Bestandsliste {number} geprüft: {msg}",
  "Current list checked: {msg}": "Bestandsliste geprüft: {msg}",
  "{present} match, {missing} only on the list, {extra} only in the database": "{present} stimmen überein, {missing} nur auf der Liste, {extra} nur in der Datenbank",
  "{present} match — all consistent": "{present} stimmen überein — alles stimmig",
  "Issue opened: {title}": "Problem gemeldet: {title}",
  "Issue resolved: {title}": "Problem gelöst: {title}",
  "Delivery note {number}, line {n}: {description}": "Lieferschein {number}, Zeile {n}: {description}",
  "Return note {number}, line {n}: {description}": "Rückgabeschein {number}, Zeile {n}: {description}",
  "Delivery note , line {n}: {description}": "Lieferschein, Zeile {n}: {description}",
  "Return note , line {n}: {description}": "Rückgabeschein, Zeile {n}: {description}",
};
