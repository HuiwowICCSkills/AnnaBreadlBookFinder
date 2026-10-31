import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  annaSearchUrl,
  availablePath,
  chooseCandidate,
  contentDispositionFilename,
  decodeOnclickUrl,
  extractRequestCodeFromText,
  isRequestCode,
  normalizeBookTarget,
  parseCli,
  safeFilename,
} from "./anna_breadl_book_finder.mjs";

test("Anna search URL uses the site path format", () => {
  assert.equal(
    annaSearchUrl("The Prince Machiavelli"),
    "https://annas-archive.cc/s/The%20Prince%20Machiavelli?",
  );
});

test("book targets accept numeric IDs and Anna book URLs only", () => {
  assert.equal(
    normalizeBookTarget("18497390"),
    "https://annas-archive.cc/book/18497390",
  );
  assert.equal(
    normalizeBookTarget("https://annas-archive.cc/book/18497390"),
    "https://annas-archive.cc/book/18497390",
  );
  assert.throws(() => normalizeBookTarget("https://example.com/book/1"));
});

test("request code parsing is exact and case-normalized", () => {
  assert.equal(isRequestCode("ZLIBIO4398714"), true);
  assert.equal(isRequestCode("not a code"), false);
  assert.equal(
    extractRequestCodeFromText("Request Code : zlibio4398714"),
    "ZLIBIO4398714",
  );
});

test("base64 onclick links are decoded", () => {
  const url = "https://gateway.ipfs.io/ipfs/bafyexample?filename=book.pdf";
  const encoded = Buffer.from(url).toString("base64");
  assert.equal(decodeOnclickUrl(`openLinkNewTab('${encoded}')`), url);
});

test("candidate selection prefers the requested mirror", () => {
  const candidates = [
    { label: "Mirror 1", url: "https://one.example/book.pdf", downloadable: true },
    { label: "Mirror 2", url: "https://two.example/book.pdf", downloadable: true },
    {
      label: "Tor",
      url: "http://example.onion/book.pdf",
      downloadable: false,
    },
  ];
  assert.equal(chooseCandidate(candidates, "Mirror 2").url, candidates[1].url);
  assert.equal(chooseCandidate(candidates, "missing").url, candidates[0].url);
  assert.equal(chooseCandidate(candidates, "Tor").url, candidates[0].url);
});

test("filename helpers strip traversal and decode content disposition", () => {
  assert.equal(safeFilename("../../book.pdf"), ".._.._book.pdf");
  assert.equal(
    contentDispositionFilename(
      "attachment; filename*=UTF-8''Applied%20Hydrology.pdf",
    ),
    "Applied Hydrology.pdf",
  );
});

test("download paths do not overwrite an existing file", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "anna-breadl-test-"));
  const first = path.join(folder, "book.pdf");
  fs.writeFileSync(first, "first");
  assert.equal(availablePath(first), path.join(folder, "book (2).pdf"));
  const second = path.join(folder, "book (2).pdf");
  fs.writeFileSync(second, "second");
  assert.equal(availablePath(first), path.join(folder, "book (3).pdf"));
  fs.rmSync(folder, { recursive: true, force: true });
});

test("CLI parsing supports documented options", () => {
  const options = parseCli([
    "request",
    "ZLIBIO4398714",
    "--timeout",
    "60",
    "--out",
    "result.json",
    "--no-probe",
  ]);
  assert.equal(options.positionals[0], "request");
  assert.equal(options.positionals[1], "ZLIBIO4398714");
  assert.equal(options.timeoutMs, 60000);
  assert.equal(options.out, "result.json");
  assert.equal(options.probe, false);
});
