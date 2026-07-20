# Offline terminology pack

`terminology.sqlite` is a generated, read-only runtime resource. Translation
never queries a remote terminology service. Rebuild the pack from approved
official bulk sources with:

```sh
node scripts/build-terminology-pack.mjs
```

The adjacent manifest records the source version, record count, SHA-256, license,
and attribution. Do not add sources that prohibit bulk acquisition, local storage,
or redistribution.

Current source:

- FAO AGROVOC English/Chinese preferred and alternative labels, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The builder downloads FAO's published `agrovoc_core.nt.zip` snapshot, records
its hash/version/license metadata, and creates the compact runtime database.
The source archive is used only while building and is not queried by the app.

Attribution: Food and Agriculture Organization of the United Nations (FAO),
AGROVOC. This project extracts the English/Chinese labels, normalizes lookup
keys, and builds SQLite/FTS indexes; FAO does not endorse this derived pack.
The exact snapshot date and archive hash are stored in
`terminology.sqlite.manifest.json`.

WIPO Pearl is intentionally excluded because its terms prohibit web scraping and
bulk storage. Microsoft Terminology must not be added until redistribution terms
have been reviewed.
