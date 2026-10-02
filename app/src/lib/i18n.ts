import { createElement, Fragment, type ReactNode } from "react";
import { ES } from "./es";

// The UI's text is written in English, and each text is its own key: a
// language other than English has a dictionary from the English text to its
// own, and a text it lacks stays in English. A text can have {name} slots,
// which the call fills.

export type Language = "en" | "es";

// Each language's name in its own language, so it can be found from any other.
export const LANGUAGES: Record<Language, string> = { en: "English", es: "Español" };

// What the browser formats numbers and dates by, and HeroUI's own text follows.
export const LOCALES: Record<Language, string> = { en: "en-US", es: "es-ES" };

export type Translate = (text: string, params?: Record<string, string | number>) => string;

const DICTIONARIES: Partial<Record<Language, Record<string, string>>> = { es: ES };

export function translator(language: Language): Translate {
  const dictionary = DICTIONARIES[language];
  return (text, params) => {
    const template = dictionary?.[text] ?? text;
    return params ? template.replace(/\{(\w+)\}/g, (slot, name: string) => String(params[name] ?? slot)) : template;
  };
}

// A translated text with parts that aren't text, like a value in bold: each
// {name} slot takes the node of that name, wherever the language puts it.
export function rich(t: Translate, text: string, slots: Record<string, ReactNode>): ReactNode {
  return t(text)
    .split(/\{(\w+)\}/)
    .map((part, i) => (i % 2 === 1 ? createElement(Fragment, { key: i }, slots[part]) : part));
}

// Marks a text that's translated where it's shown, like a table of labels at
// the top of a file, so the dictionary has it.
export const msg = (text: string): string => text;
