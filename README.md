# AstroBot

A Vedic astrology chart reader that runs entirely in your phone's browser, hosted on
GitHub Pages. Bookmark it to your home screen and it works offline.

## What it does

1. **Enter a chart** — pick the Lagna rashi, then tap planets into the twelve squares of a
   North Indian chart. No birth-time maths, no ambiguity.
2. **Confirm the reading of the chart** — AstroBot lists every planet with its rashi and
   square number and asks you to approve before interpreting anything. Uranus, Neptune
   and Pluto can be entered so a chart drawn by modern software can be copied as it
   stands; they are drawn and confirmed, and marked as carrying no classical rule.
3. **Explain the chart** — a deterministic rules engine matches the chart against the
   knowledge base. Every sentence carries a citation to the classical source it came from.
4. **Save what matters** — keep a kundali to reopen later, and snapshot a reading as it
   reads today. A saved reading stores its own text rather than recomputing, so when the
   knowledge base grows you can set the old reading beside a new one instead of losing it.
   Everything lives in the browser, so there is an export and an import.
5. **Add knowledge from your phone** — paste something you found on social media; AstroBot
   files it to this repo as an issue.
6. **Improve over time** — a GitHub Action has Claude reconcile new submissions into the
   knowledge base and open a pull request, flagging any rule that contradicts what is
   already there so you can judge it yourself.

## Why there is no AI in the app itself

GitHub Pages serves static files, so there is no server to hold an API key. Rather than
putting a key in the browser, the app is a rules engine over plain JSON knowledge files:
free to run, instant, works offline, and every claim is traceable to a source. Claude runs
in CI, where a secret can live safely, and its job is to maintain the knowledge files —
not to improvise readings.

## Layout

| Path | What it holds |
| --- | --- |
| `index.html` | The whole app shell |
| `assets/js/` | ES modules, no build step, no dependencies |
| `knowledge/base/` | Planets, rashis, houses — the invariant reference data |
| `knowledge/rules/` | Interpretation rules, one file per rule family |
| `knowledge/incoming/` | Submissions awaiting reconciliation |
| `scripts/` | Validation and ingestion tooling (Node) |
| `.github/workflows/` | Pages deploy and the Claude ingestion pipeline |

## Running it locally

```bash
python -m http.server 8080
```

Then open <http://localhost:8080>. There is no build step and nothing to install.

If you change a file and the browser keeps serving the old one, the service worker
is holding a cached copy — open DevTools → Application → Service Workers →
Unregister, or hard-reload twice.

## Computing a kundali from birth details

AstroBot calculates charts itself. No API, no key, no network — the whole
ephemeris runs in the browser and works offline like everything else here.

```bash
node scripts/kundali.mjs --date 1991-08-23 --time 05:45 --lat 26.8467 --lon 80.9462
```

Add `--read` to interpret the result in the same command.

| Decision | What AstroBot does |
| --- | --- |
| Houses | Whole sign. The first square is the rising rashi; there is no house system to choose. |
| Ayanamsa | Lahiri (Chitrapaksha) by default. Raman and KP are offered for comparison and are marked unverified in `ayanamsa.js`, because their zero points have not been checked against a published table. |
| Nodes | Mean node, as the classical texts use. `--true-node` switches, which can move Rahu a sign. |
| Timezone | The IANA database that ships with every browser, so India's `+05:21:10` before 1906 and `+06:30` wartime daylight saving are handled. |
| Precision | Longitudes are apparent, in the true ecliptic of date. Degrees reach the engine, so moolatrikona, combustion and nakshatra can be judged exactly. |

Before standard time, a zone carries one local mean time taken from its reference
city — a birth in Ulm resolves to Berlin's, and a birth in Delhi before 1906 to
Madras's. Where the real offset is known, pass `--offset` in minutes.

In the app, **Calculate it from birth details instead** on the Chart screen opens
the same calculation: name, date, time and place, with a searchable list of 7,260
Indian towns and cities. Villages GeoNames has never sized are missing, so
coordinates can be entered directly. A computed chart goes to the confirmation
screen like any other — the arithmetic can be right while the birth certificate
is wrong.

The place list is fetched the first time that screen is opened, not at start-up,
so anyone who only enters charts by hand never downloads it. Rebuild it with:

```bash
curl -o IN.zip https://download.geonames.org/export/dump/IN.zip
curl -o admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
unzip IN.zip
node scripts/build-places.mjs IN.txt admin1CodesASCII.txt
```

`node scripts/test-astro.mjs` checks the ayanamsa against published Lahiri values,
asserts the ascendant against hand-derived geometry, sweeps it across all 24 hours,
and verifies Einstein's chart against his published one.

## Working on the knowledge base

```bash
node scripts/validate.mjs
```

Checks every rule for a malformed condition, an unknown source key, a theme that
maps to no section, a duplicate id, and a condition the engine cannot evaluate.
Run it before committing; CI runs it before every deploy.

```bash
node scripts/read.mjs --lagna 5 --su 10 --mo 4 --ma 6 --me 10 --ju 9 --ve 11 --sa 3 --ra 1 --ke 7
```

```bash
node scripts/test-library.mjs
```

Checks the saved-kundali and saved-reading rules against a stub localStorage: that
saving one chart twice updates it rather than duplicating it, that one chart can hold
several readings taken at different times, and that an export re-imports without
losing or doubling anything.

Prints a full reading in the terminal — the fastest way to see what a new rule
actually does to a chart.

## Setting it up on GitHub

1. **Pages.** Settings → Pages → Source: *GitHub Actions*. The next push to `main`
   publishes the site.
2. **Ingestion.** Settings → Secrets and variables → Actions → New secret:
   `ANTHROPIC_API_KEY`. Without it, submissions still arrive as issues; only the
   automatic reconciliation is skipped.
3. **Labels.** Create `knowledge-submission`, `knowledge`, `knowledge-conflict`
   and `not-encoded`. The app applies the first; the workflow applies the rest.
4. **On the phone.** Open the Pages URL, add it to the home screen, then
   Settings → paste `owner/AstroBot` and a fine-grained personal access token
   scoped to this repository with **Issues: read and write** and nothing else.
   The token is kept in that browser only.

### What happens to a submission

The app opens an issue labelled `knowledge-submission`. The workflow asks Claude
to express the claim in AstroBot's own rule format, checks it against the rules
that already cover those planets and houses, and opens a pull request. Where the
claim disagrees with existing knowledge, the conflict is written into the pull
request body and the pull request is labelled `knowledge-conflict`; the existing
rule is left exactly as it was. Both readings then appear in the app under
*Where the sources differ* until someone decides between them.

## Sources and copyright

Rules cite classical texts — Brihat Parashara Hora Shastra, Phaladeepika, Saravali,
Jataka Parijata and others — by chapter. The wording of every rule in this repository is
original; no book text is reproduced here. See `knowledge/base/sources.json` for the
citation keys.

Place names and coordinates in `assets/data/places-in.json` come from
[GeoNames](https://www.geonames.org/), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The attribution is a
condition of that licence, not a courtesy.

Positions are computed with [astronomy-engine](https://github.com/cosinekitty/astronomy)
by Don Cross, MIT licensed, vendored at `assets/vendor/astronomy.js` with its licence
header intact. Swiss Ephemeris was not used: it is AGPL, which would have placed
conditions on this repository.

Astrology is not a predictive science. Nothing here is advice about health, money, law or
relationships.
