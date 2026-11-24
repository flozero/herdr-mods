// The grammar the editor colours a file with. A language server's language names its own (`syntax`); the others are coloured by the
// file's name, then by its extension, as the editor's grammars name them.

// .env, .env.local, .env.example, production.env, .envrc: shell assignments (KEY=value, # comments, quotes).
const DOTENV = /^(?:\.env(?:\..+)?|.+\.env|\.envrc)$/i;

// Extensions the editor has no grammar of that name for, and the grammar that fits.
const SYNTAXES = { jsonc: "json", json5: "json", webmanifest: "json", envrc: "bash" };

export const syntaxOf = (name, extension, language) => language?.syntax ?? (DOTENV.test(name) ? "bash" : SYNTAXES[extension] ?? extension);
