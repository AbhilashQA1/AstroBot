# Knowledge schema

Everything AstroBot says about a chart comes from a file in `knowledge/`. Nothing is
improvised at runtime. There are two kinds of file.

## Reference data — `knowledge/base/`

Invariant facts the engine computes with: `planets.json`, `rashis.json`, `houses.json`,
`sources.json`. These change only when a doctrine is found to be mis-stated.

## Rules — `knowledge/rules/`

Each rule is one judgement, matched against a chart. Files are grouped by family and
listed in `knowledge/index.json`.

```json
{
  "id": "pih.su.10",
  "family": "planet-in-house",
  "when": { "planetInHouse": { "planet": "su", "house": 10 } },
  "says": "Work becomes the arena where the person is recognised.",
  "themes": ["work", "status"],
  "polarity": "favourable",
  "tradition": "parashari",
  "sources": [{ "key": "bphs", "locus": "ch. 11" }],
  "confidence": 0.9,
  "status": "active"
}
```

### Fields

| Field | Meaning |
| --- | --- |
| `id` | Stable. Never reused, never renumbered. Prefix names the family. |
| `family` | Which matcher the rule belongs to; see below. |
| `when` | A condition expression. See *Conditions*. |
| `says` | The judgement, in AstroBot's own words. One or two clauses. No book text. |
| `themes` | Used to group the reading into sections. |
| `polarity` | `favourable`, `difficult`, `mixed` or `neutral`. Drives conflict detection. |
| `tradition` | `parashari`, `jaimini`, `lal-kitab`, `nadi`, `community`. Rules from different traditions are never silently merged. |
| `sources` | One or more `{ key, locus }` against `knowledge/base/sources.json`. |
| `confidence` | 0–1. How settled the doctrine is, independent of the source's authority. |
| `status` | `active`, `disputed` (shown under "differing views") or `retired` (kept for history, never shown). |
| `conflictsWith` | Optional list of rule ids this one directly contradicts. |
| `supersedes` | Optional. Set by ingestion when a rule is replaced. |
| `added` / `reviewed` | ISO dates. |

### Conditions

Leaf conditions:

| Condition | Matches when |
| --- | --- |
| `{"planetInHouse": {"planet": "su", "house": 1}}` | That planet occupies that house |
| `{"planetInSign": {"planet": "su", "sign": 1}}` | That planet occupies that rashi |
| `{"lordInHouse": {"lordOf": 1, "house": 10}}` | The lord of house 1 sits in house 10 |
| `{"conjunct": ["ju", "mo"]}` | All listed planets share one house |
| `{"aspect": {"from": "sa", "to": "mo"}}` | Saturn casts a full aspect on the Moon |
| `{"dignity": {"planet": "su", "is": "exalted"}}` | `exalted`, `debilitated`, `ownSign`, `moolatrikona`, `friendly`, `enemy`, `neutral` |
| `{"inHouseClass": {"planet": "sa", "class": "dusthana"}}` | Planet sits in a house of that class |
| `{"retrograde": "sa"}` | Marked retrograde on entry |
| `{"emptyHouse": 7}` | No planet occupies that house |

Combinators: `{"all": [...]}`, `{"any": [...]}`, `{"not": {...}}`.

A rule whose `when` references anything the engine does not recognise is skipped and
reported by `npm run validate` — it is never silently ignored at runtime.

### Families

| Prefix | Family | Directory |
| --- | --- | --- |
| `pih` | `planet-in-house` | `rules/planet-in-house/` |
| `pis` | `planet-in-sign` | `rules/planet-in-sign/` |
| `lih` | `lord-in-house` | `rules/lord-in-house/` |
| `yog` | `yoga` | `rules/yogas.json` |
| `cnj` | `conjunction` | `rules/conjunctions.json` |
| `asp` | `aspect` | `rules/aspects.json` |

## Conflicts

Two rules conflict when they match the same chart, address the same themes, and carry
opposing polarity — or when one names the other in `conflictsWith`. The app never resolves
a conflict by itself. It shows both, with their sources and traditions, and leaves the
judgement to the reader. The ingestion workflow does the same: it opens a pull request and
labels it `knowledge-conflict` rather than overwriting a rule.

## Adding a rule by hand

Append to the right file, run `npm run validate`, commit. The app picks it up on next
load; no build step and no version bump.
