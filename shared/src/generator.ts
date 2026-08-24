import { DEFAULT_GENERATOR_OPTIONS, type PasswordGeneratorOptions } from "./models.js";

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/";
const AMBIGUOUS = new Set("Il1O0o|`'\"{}[]()<>".split(""));

function secureIndex(upperBound: number): number {
  if (!Number.isSafeInteger(upperBound) || upperBound <= 0 || upperBound > 0x1_0000_0000) {
    throw new RangeError("Invalid random range");
  }
  const limit = Math.floor(0x1_0000_0000 / upperBound) * upperBound;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0]! >= limit);
  return buffer[0]! % upperBound;
}

function choose(characters: string, previous?: string): string {
  if (characters.length === 0) throw new RangeError("Character set is empty");
  if (characters.length === 1) return characters;
  let selected: string;
  do {
    selected = characters[secureIndex(characters.length)]!;
  } while (selected === previous);
  return selected;
}

export function generatePassword(
  requested: Partial<PasswordGeneratorOptions> = {},
): string {
  const options = { ...DEFAULT_GENERATOR_OPTIONS, ...requested };
  if (!Number.isSafeInteger(options.length) || options.length < 8 || options.length > 256) {
    throw new RangeError("Password length must be between 8 and 256");
  }

  const sets = [
    options.lowercase ? LOWERCASE : "",
    options.uppercase ? UPPERCASE : "",
    options.digits ? DIGITS : "",
    options.symbols ? SYMBOLS : "",
  ]
    .filter(Boolean)
    .map((set) => options.excludeAmbiguous ? [...set].filter((character) => !AMBIGUOUS.has(character)).join("") : set);

  if (sets.length === 0 || options.length < sets.length) {
    throw new RangeError("Select at least one character set and allow room for every selected set");
  }
  const combined = sets.join("");
  const password = sets.map((set) => choose(set));
  while (password.length < options.length) {
    const previous = options.avoidRepeatingCharacters ? password.at(-1) : undefined;
    password.push(choose(combined, previous));
  }
  for (let index = password.length - 1; index > 0; index -= 1) {
    const target = secureIndex(index + 1);
    [password[index], password[target]] = [password[target]!, password[index]!];
  }
  return password.join("");
}
