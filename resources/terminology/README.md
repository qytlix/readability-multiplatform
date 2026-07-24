# Offline terminology pack

`terminology-libraries.sqlite` is the generated, read-only runtime resource.
Translation never queries a remote terminology service. It contains the
existing AGROVOC baseline plus the pinned 34-library Immersive Translate
catalog. Rebuild it with:

```sh
npm run build:terminology-libraries
```

The adjacent manifest records the catalog URL/hash, every downloaded CSV URL
and `langsHash`, normalized entry counts, warnings, the AGROVOC base hash, and
the final SQLite SHA-256. Runtime code reads only this committed artifact.

Current M4 artifact:

- catalog SHA-256:
  `69a53b41d883a3ed3016706ad65252c5bfe1275f2c1c2ec0aa1627da0dca4ed6`;
- 34 built-in libraries and 4,521 normalized catalog entries;
- 41,632 AGROVOC concepts merged logically into `builtin:default`;
- only `builtin:default` is enabled on first install;
- final SQLite SHA-256:
  `7b312d935eb464e22ead4e54becb7ac514a94295fd51164e6f9722a996bc2f43`.

The upstream snapshot contains a small number of missing optional columns,
trailing empty columns, unquoted product-name quotes, duplicates, and
conflicts. The build compiler normalizes the pinned inputs deterministically
and records warnings. User CSV import remains strict RFC 4180.

`terminology.sqlite` remains the reproducible AGROVOC-only base. Rebuild that
base from the approved official bulk source with:

```sh
node scripts/build-terminology-pack.mjs
```

Current source:

- FAO AGROVOC English/Chinese preferred and alternative labels, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The builder downloads FAO's published `agrovoc_core.nt.zip` snapshot, records
its hash/version/license metadata, and creates the compact runtime database.
The source archive is used only while building and is not queried by the app.

Attribution: Food and Agriculture Organization of the United Nations (FAO),
AGROVOC. This project extracts the English/Chinese labels, normalizes lookup
keys, and builds SQLite/FTS indexes; FAO does not endorse this derived pack.
The exact AGROVOC snapshot date and archive hash are stored in
`terminology.sqlite.manifest.json`; the combined runtime provenance is stored
in `terminology-libraries.sqlite.manifest.json`.

WIPO Pearl is intentionally excluded because its terms prohibit web scraping and
bulk storage. Microsoft Terminology must not be added until redistribution terms
have been reviewed.
