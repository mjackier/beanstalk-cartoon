// Checks the About Me details before anything is drawn or printed.
//
// Three layers, cheapest first. Any "no" stops the book; if a check can't run, we also stop
// (fail closed): nothing unchecked goes on a cover that gets printed and mailed.
//   1. Rules: lengths, characters a name can have, no links / emails / phone numbers.
//   2. OpenAI moderation (free): hate, harassment, sexual, violence, self-harm...
//   3. A small model reads the name and the details like a careful bookshop clerk would:
//      the name has to be a real-sounding first name (any language or culture), not an insult,
//      an epithet, a slur, a rude word or a joke; the other fields must be fit for a children's book.
import crypto from "node:crypto";
import { moderate, lookAt } from "./openai.js";

const FIELDS = {
  child_name: "Name",
  child_age: "Age",
  child_favorites: "Favourite things",
  child_about: "About",
};

// A tiny local list so the most obvious ones never even reach the API. The model is the real check.
const OBVIOUS = /\b(stupid|idiot|dumb|moron|loser|ugly|fatso|fatty|poop|poopy|butthead|retard|retarded|dummy|jerk|freak|weirdo|crap|shit|fuck|bitch|asshole|penis|vagina|sexy|nazi|hitler)\b/i;

export const detailsHash = (b) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(Object.keys(FIELDS).map((k) => String(b[k] || "").trim())))
    .digest("hex")
    .slice(0, 32);

// Rules that need no model. Returns [{ field, message }].
export function ruleProblems(b) {
  const out = [];
  const name = String(b.child_name || "").trim();
  const age = String(b.child_age || "").trim();
  if (!name) out.push({ field: "child_name", message: "Enter the child's name." });
  else {
    if (name.length < 2) out.push({ field: "child_name", message: "The name is too short." });
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(name))
      out.push({ field: "child_name", message: "A name can only have letters, spaces, hyphens and apostrophes." });
    if (name.split(/\s+/).length > 4) out.push({ field: "child_name", message: "Use the child's first name (or first and last)." });
    if (/(.)\1\1/u.test(name.toLowerCase())) out.push({ field: "child_name", message: "That doesn't look like a real name." });
  }
  if (age && !/^\d{1,2}( ?(years?|yrs?)( old)?)?$|^\d{1,2} ?(and a half|½)$/i.test(age))
    out.push({ field: "child_age", message: "Write the age as a number, like 6." });
  else if (age && Number.parseInt(age, 10) > 17) out.push({ field: "child_age", message: "These books are for children: the age must be 17 or under." });
  for (const f of ["child_name", "child_favorites", "child_about"]) {
    const v = String(b[f] || "");
    if (/https?:\/\/|www\.|\.(com|net|org|xyz|io)\b/i.test(v)) out.push({ field: f, message: "Links can't be printed in the book." });
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(v)) out.push({ field: f, message: "Email addresses can't be printed in the book." });
    if (/(\d[\s().-]*){7,}/.test(v)) out.push({ field: f, message: "Phone numbers and long numbers can't be printed in the book." });
    if (OBVIOUS.test(v)) out.push({ field: f, message: `${FIELDS[f]} has a word that can't go in a children's book.` });
  }
  return out;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name_is_real", "name_reason", "problems"],
  properties: {
    name_is_real: { type: "boolean" },
    name_reason: { type: "string" },
    problems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "reason"],
        properties: { field: { type: "string", enum: Object.keys(FIELDS) }, reason: { type: "string" } },
      },
    },
  },
};

const INSTRUCTIONS = (b) => `You check the details a parent typed for a personalised children's picture book before it is printed and mailed.
The name goes on the front cover ("<Story>, starring <Name>") and the other fields on the back cover "About Me".

Name: ${JSON.stringify(b.child_name || "")}
Age: ${JSON.stringify(b.child_age || "")}
Favourite things: ${JSON.stringify(b.child_favorites || "")}
About: ${JSON.stringify(b.child_about || "")}

1. name_is_real: true only if the name is a plausible real first name (optionally with a last name or a nickname people really use), from ANY language or culture, including unusual or modern names (e.g. Mattan, Siobhan, Nguyen, Oluwaseun, Aaliyah, Jaxon, Xiomara).
   false for: an insult or epithet ("Stupid", "Fatso", "Loser Boy"), a slur in any language, a rude, sexual or toilet word, a joke or mocking name ("Smelly Pants", "Butthead"), a name of a hated figure used as a joke ("Hitler"), random letters, a sentence, or an object/food that is clearly not used as a name.
   Give a short reason a parent would understand.
2. problems: list a field ONLY if printing it would be clearly wrong in a children's book: insults or mocking statements about the child or anyone else, slurs, sexual content, violence or threats, drugs, alcohol, hateful content, or personal details that shouldn't be printed (home address, school name with location, phone).
   Ordinary things children say are FINE, including mild dislikes and complaints: "I hate school", "hates broccoli", "doesn't like bedtime", "loves mud puddles", "farts make him laugh". When in doubt, allow it: a parent wrote it about their own child. Do not list the name here; that is question 1.
Be fair: never reject a name just because it is rare or foreign.`;

// Returns { ok, problems: [{field, message}] }. Throws (status 503) if a check couldn't run.
export async function validateDetails(b, meter = {}) {
  const rules = ruleProblems(b);
  if (rules.length) return { ok: false, problems: rules, by: "rules" };
  const text = Object.entries(FIELDS)
    .map(([k, label]) => `${label}: ${String(b[k] || "")}`)
    .join("\n");
  let mod, judge;
  try {
    [mod, judge] = await Promise.all([
      moderate(text, { ...meter, purpose: "details_moderation" }),
      lookAt({ instructions: INSTRUCTIONS(b), images: [], schema: SCHEMA, name: "details_check", meter: { ...meter, purpose: "details_check" } }),
    ]);
  } catch (err) {
    throw Object.assign(new Error("We couldn't check the details right now, so nothing was made or charged. Please try again in a minute."), {
      status: 503,
      cause: err,
    });
  }
  const problems = [];
  if (mod.flagged) problems.push({ field: "child_about", message: "Some of the details can't go in a children's book. Please change them." });
  if (!judge.name_is_real)
    problems.push({ field: "child_name", message: `Please use the child's real name. ${judge.name_reason || ""}`.trim() });
  for (const p of judge.problems || [])
    if (p.field !== "child_name") problems.push({ field: p.field, message: `${FIELDS[p.field] || "A detail"}: ${p.reason}` });
  return { ok: problems.length === 0, problems, by: mod.flagged ? "moderation" : "model", moderation: mod.categories };
}
