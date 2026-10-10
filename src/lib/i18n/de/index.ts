import type { Dict } from "../core";
import { common } from "./common";
import { documents } from "./documents";
import { equipment } from "./equipment";
import { messages } from "./messages";
import { projects } from "./projects";

/**
 * German texts, one file per area (English text -> German text).
 * Keys with {placeholders} also translate finished messages and history entries.
 */
const parts: Dict[] = [common, projects, equipment, documents, messages];

export const de: Dict = Object.assign({}, ...parts);
