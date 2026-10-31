#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const ANNA_BASE = "https://annas-archive.cc";
const BREADL_REQUEST_URL = "https://breadl.cc/book-request";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/155.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

export function findChrome(explicit) {
  if (explicit) return explicit;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;

  const command = process.platform === "win32" ? "where.exe" : "which";
  for (const name of [
    "chrome",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "msedge",
    "microsoft-edge",
  ]) {
    const result = spawnSync(command, [name], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim().split(/\r?\n/)[0];
    }
  }

  if (process.platform === "win32") {
    const roots = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    return firstExisting(
      roots.flatMap((root) => [
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      ]),
    );
  }
  if (process.platform === "darwin") {
    return firstExisting([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]);
  }
  return "";
}

export function annaSearchUrl(query) {
  return `${ANNA_BASE}/s/${encodeURIComponent(query.trim())}?`;
}

export function normalizeBookTarget(value) {
  const target = String(value || "").trim();
  if (!target) throw new Error("book URL or ID is empty");
  if (/^\d+$/.test(target)) return `${ANNA_BASE}/book/${target}`;
  if (/^https?:\/\/annas-archive\.(?:cc|org|gd|gl)\/book\//i.test(target)) {
    return target;
  }
  throw new Error("expected an Anna book URL or numeric book ID");
}

export function isRequestCode(value) {
  return /^[A-Z0-9][A-Z0-9_-]{3,63}$/i.test(String(value || "").trim());
}

export function extractRequestCodeFromText(text) {
  const match = String(text || "").match(
    /Request Code\s*:\s*([A-Z0-9][A-Z0-9_-]{3,63})/i,
  );
  return match ? match[1].toUpperCase() : "";
}

export function decodeOnclickUrl(onclick) {
  const value = String(onclick || "");
  const match = value.match(/openLink(?:NewTab)?\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/);
  if (!match) return "";
  try {
    return Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return "";
  }
}

export function safeFilename(value, fallback = "book.bin") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (cleaned || fallback).slice(0, 180);
}

export function contentDispositionFilename(header) {
  const value = String(header || "");
  const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].replace(/^["']|["']$/g, ""));
    } catch {
      // Fall back to the plain filename parameter.
    }
  }
  const plain = value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  return (plain?.[1] || plain?.[2] || "").trim();
}

export function chooseCandidate(candidates, selector = "Mirror 1") {
  const wanted = String(selector || "").trim().toLowerCase();
  if (wanted) {
    const exact = candidates.find(
      (item) =>
        item.downloadable &&
        [item.label, item.id, item.url]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase() === wanted),
    );
    if (exact) return exact;
  }
  return (
    candidates.find(
      (item) =>
        item.downloadable &&
        !/\.onion(?:\/|$)/i.test(item.url) &&
        /^https?:\/\//i.test(item.url),
    ) || null
  );
}

export function availablePath(target) {
  if (!fs.existsSync(target)) return target;
  const extension = path.extname(target);
  const stem = extension ? target.slice(0, -extension.length) : target;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("could not find an available output filename");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function loadStorageState(statePath) {
  if (!statePath) return null;
  const absolute = path.resolve(statePath);
  const text = await fsp.readFile(absolute, "utf8");
  const state = JSON.parse(text);
  if (Array.isArray(state)) return { cookies: state, origins: [] };
  if (!state || typeof state !== "object") {
    throw new Error("storage state must be a JSON object or cookie array");
  }
  return {
    ...state,
    cookies: Array.isArray(state.cookies) ? state.cookies : [],
    origins: Array.isArray(state.origins) ? state.origins : [],
  };
}

class HeadlessBrowser {
  constructor(options = {}) {
    this.options = options;
    this.chromePath = findChrome(options.chromePath);
    this.storageState = options.storageState || null;
    this.profileName = "";
    this.child = null;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async start() {
    if (!this.chromePath) {
      throw new Error("Chrome/Chromium not found. Set CHROME_PATH or pass --chrome-path.");
    }
    this.profileName = fs.mkdtempSync(path.join(os.tmpdir(), "anna-breadl-headless-"));
    const portFile = path.join(this.profileName, "DevToolsActivePort");
    this.child = spawn(
      this.chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--remote-debugging-port=0",
        `--user-data-dir=${this.profileName}`,
        "--window-size=1440,1000",
        "about:blank",
      ],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );

    await waitForFile(portFile, 20000);
    const [port] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((item) => item.type === "page");
    if (!page) throw new Error("No headless page target found");

    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });

    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("Network.setUserAgentOverride", {
      userAgent: DEFAULT_UA,
      acceptLanguage: "en-US,en;q=0.9",
      platform: "Win32",
    });
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `Object.defineProperty(navigator, "webdriver", { get: () => false });
               window.chrome = window.chrome || { runtime: {} };`,
    });
    await this.applyCookies();
  }

  async applyCookies() {
    const cookies = this.storageState?.cookies || [];
    for (const cookie of cookies) {
      if (!cookie || !cookie.name || cookie.value === undefined) continue;
      const params = {
        name: String(cookie.name),
        value: String(cookie.value),
        path: cookie.path || "/",
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
      };
      if (cookie.domain) params.domain = cookie.domain;
      if (cookie.sameSite) {
        const normalized = String(cookie.sameSite).toLowerCase();
        params.sameSite =
          normalized === "strict"
            ? "Strict"
            : normalized === "none"
              ? "None"
              : "Lax";
      }
      if (typeof cookie.expires === "number" && cookie.expires > 0) {
        params.expires = cookie.expires;
      }
      if (!params.domain && cookie.url) params.url = cookie.url;
      if (!params.domain && !params.url) continue;
      await this.send("Network.setCookie", params);
    }
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("headless Chrome CDP is not connected"));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const evaluated = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (evaluated.exceptionDetails) {
      throw new Error(
        evaluated.exceptionDetails.exception?.description ||
          evaluated.exceptionDetails.text ||
          "page evaluation failed",
      );
    }
    return evaluated.result.value;
  }

  async waitUntil(expression, timeoutMs, intervalMs = 300) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return true;
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }
    if (lastError) {
      throw new Error(`headless wait timed out: ${lastError.message}`);
    }
    throw new Error("headless wait timed out");
  }

  async applyLocalStorageForCurrentOrigin() {
    const origins = this.storageState?.origins || [];
    if (!origins.length) return;
    const current = await this.evaluate("location.origin");
    const entry = origins.find((item) => item.origin === current);
    if (!entry || !Array.isArray(entry.localStorage)) return;
    const encoded = JSON.stringify(entry.localStorage);
    await this.evaluate(`(() => {
      const entries = ${encoded};
      for (const item of entries) {
        if (item && item.name !== undefined) {
          localStorage.setItem(String(item.name), String(item.value ?? ""));
        }
      }
      return true;
    })()`);
  }

  async navigate(url, options = {}) {
    const timeoutMs = options.timeoutMs || 45000;
    const waitMs = options.waitMs ?? 500;
    await this.send("Page.navigate", { url });
    await this.waitUntil(
      `document.readyState !== "loading" && location.href !== "about:blank"`,
      timeoutMs,
    );
    await this.applyLocalStorageForCurrentOrigin();
    if (waitMs > 0) await sleep(waitMs);
    return this.evaluate(
      `({ url: location.href, title: document.title, readyState: document.readyState })`,
    );
  }

  async close() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    } catch {
      // ignore
    }
    try {
      this.child?.kill();
    } catch {
      // ignore
    }
    try {
      if (this.profileName) {
        await fsp.rm(this.profileName, { recursive: true, force: true });
      }
    } catch {
      // Chrome can briefly retain files on Windows.
    }
  }
}

function evidence(startUrl, snapshot) {
  return {
    requested_url: startUrl,
    final_url: snapshot?.url || "",
    page_title: snapshot?.title || "",
    checked_at: new Date().toISOString(),
  };
}

const EXTRACT_BOOK_ROWS = `(() => {
  const text = (node) => (node?.innerText || node?.textContent || "").trim();
  const rows = [...document.querySelectorAll(".bookRow")]
    .map((row) => {
      const link = row.querySelector('h3 a[href*="/book/"], a[href*="/book/"]');
      const props = {};
      row.querySelectorAll(".bookProperty").forEach((item) => {
        const label = text(item.querySelector(".property_label")).replace(/:$/, "");
        const value = text(item.querySelector(".property_value"));
        if (label && value) props[label] = value;
      });
      const fullText = text(row);
      const file = (fullText.match(/\\bFile:\\s*([^\\n]+)/i) || [])[1] || "";
      const language = (fullText.match(/\\bLanguage:\\s*([^\\n]+)/i) || [])[1] || "";
      const year = (fullText.match(/\\bYear:\\s*([^\\n]+)/i) || [])[1] || "";
      return {
        book_id: row.dataset.book_id || "",
        title: text(link),
        url: link?.href || "",
        authors: [...row.querySelectorAll('a[itemprop="author"]')].map(text),
        publisher: text(row.querySelector('a[itemprop="publisher"]')),
        year,
        language,
        file,
        request_code: text(row.querySelector("#reqcode")),
        metadata: props,
      };
    })
    .filter((item) => item.title && /\\/book\\//.test(item.url));
  const body = text(document.body);
  return {
    url: location.href,
    title: document.title,
    result_count: rows.length,
    login_prompt: /Want to get more search results\\?/i.test(body) && /\\bLogin\\b/i.test(body),
    no_results_text: /On your request nothing has been found/i.test(body),
    rows,
    body_excerpt: body.slice(0, 2000),
  };
})()`;

async function searchCommand(options) {
  const query = options.positionals[0];
  if (!query) throw new Error("search requires a query");
  const limit = Math.max(1, Math.min(50, Number(options.limit || 10)));
  const url = annaSearchUrl(query);
  const browser = new HeadlessBrowser(options);
  try {
    await browser.start();
    const nav = await browser.navigate(url, options);
    await browser.waitUntil(
      `Boolean(document.querySelector(".searchResultBox, .bookRow")) ||
       /On your request nothing has been found/i.test(document.body?.innerText || "")`,
      options.timeoutMs || 45000,
    );
    const data = await browser.evaluate(EXTRACT_BOOK_ROWS);
    const rows = data.rows.slice(0, limit);
    let status = "ok";
    if (!data.result_count && data.login_prompt) status = "auth-required";
    else if (!data.result_count && data.no_results_text) status = "no-results";
    return {
      status,
      query,
      result_count: data.result_count,
      results: rows,
      warnings:
        status === "auth-required"
          ? [
              "Anna’s Archive requested login for this search. This is not evidence that the book is absent.",
              "Provide a user-owned storage state with --state or use a direct Anna book URL with resolve.",
            ]
          : [],
      evidence: evidence(url, { ...nav, ...data }),
    };
  } finally {
    await browser.close();
  }
}

const EXTRACT_BOOK_DETAIL = `(() => {
  const text = (node) => (node?.innerText || node?.textContent || "").trim();
  const box = document.querySelector(".bookDetailsBox");
  const props = {};
  box?.querySelectorAll(".bookProperty").forEach((item) => {
    const label = text(item.querySelector(".property_label")).replace(/:$/, "");
    const value = text(item.querySelector(".property_value"));
    if (label && value) props[label] = value;
  });
  const body = text(document.body);
  const requestCode =
    text(document.querySelector("#reqcode")) ||
    (body.match(/Request Code\\s*:\\s*([A-Z0-9][A-Z0-9_-]{3,63})/i) || [])[1] ||
    "";
  const categories = (props.Categories || "")
    .split(/\\s*,\\s*|\\s*;\\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    url: location.href,
    title: document.title,
    book: {
      title: text(document.querySelector('h1[itemprop="name"]')),
      authors: [...document.querySelectorAll('a[itemprop="author"]')].map(text),
      request_code: requestCode.toUpperCase(),
      categories,
      metadata: props,
      summary:
        document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content ||
        "",
    },
    body_excerpt: body.slice(0, 2000),
  };
})()`;

async function resolveTarget(browser, target, options) {
  const url = normalizeBookTarget(target);
  const nav = await browser.navigate(url, options);
  await browser.waitUntil(
    `Boolean(document.querySelector('h1[itemprop="name"], #reqcode')) ||
     /not found|access denied|forbidden|challenge/i.test(document.body?.innerText || "")`,
    options.timeoutMs || 45000,
  );
  const data = await browser.evaluate(EXTRACT_BOOK_DETAIL);
  const book = data.book;
  let status = "ok";
  if (!book.title && !book.request_code) status = "unexpected-content";
  else if (!book.request_code) status = "no-request-code";
  return {
    status,
    book,
    evidence: evidence(url, { ...nav, ...data }),
  };
}

async function resolveCommand(options) {
  const target = options.positionals[0];
  if (!target) throw new Error("resolve requires an Anna book URL or ID");
  const browser = new HeadlessBrowser(options);
  try {
    await browser.start();
    return await resolveTarget(browser, target, options);
  } finally {
    await browser.close();
  }
}

const EXTRACT_BREADL_DOWNLOAD = `(() => {
  const text = (node) => (node?.innerText || node?.textContent || "").trim();
  const absolute = (value) => {
    try { return value ? new URL(value, location.href).href : ""; } catch { return ""; }
  };
  const decodeLink = (value) => {
    const raw = String(value || "");
    const match = raw.match(/openLink(?:NewTab)?\\(\\s*['"]([A-Za-z0-9+/=]+)['"]\\s*\\)/);
    if (!match) return "";
    try { return atob(match[1]); } catch { return ""; }
  };
  const candidates = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll("a.download_now, a[href], a[onclick]")) {
    const label = text(anchor);
    const id = anchor.id || "";
    const href = anchor.getAttribute("href") || "";
    const fromHref = /^https?:\\/\\//i.test(href) ? href : "";
    const fromClick = decodeLink(anchor.getAttribute("onclick"));
    const url = absolute(fromHref || fromClick);
    if (!url) continue;
    if (/breadl\\.cc\\/(?:ebook-reader|djvu-reader)/i.test(url)) continue;
    if (/breadl\\.cc\\/download\\/\\d+\\/update-links/i.test(url)) continue;
    if (/facebook\\.com|twitter\\.com|linkedin\\.com|pinterest\\.com/i.test(url)) continue;
    const key = url + "\\n" + label + "\\n" + id;
    if (seen.has(key)) continue;
    seen.add(key);
    const onion = /\\.onion(?:\\/|$)/i.test(url);
    const proxy = /proxy/i.test(label) || /\\/proxy(?:\\/|$)/i.test(url);
    candidates.push({
      label: label || id || "download",
      id,
      url,
      downloadable: /^https?:\\/\\//i.test(url) && !onion,
      onion,
      proxy,
    });
  }
  const body = text(document.body);
  const title = document.title.replace(/\\s*-\\s*BreaTheBook\\s*$/i, "").trim();
  const size = (body.match(/\\(([0-9.]+\\s*(?:B|KB|MB|GB))\\)/i) || [])[1] || "";
  return {
    url: location.href,
    title: document.title,
    page_title: title,
    size,
    candidates,
    body_excerpt: body.slice(0, 3000),
  };
})()`;

function locationPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

async function submitBreadl(browser, requestCode, options) {
  const nav = await browser.navigate(BREADL_REQUEST_URL, options);
  const submitted = await browser.evaluate(`(() => {
    const input = document.querySelector('input[name="link_or_code"]');
    const form = input?.closest("form");
    if (!input || !form) return false;
    input.value = ${JSON.stringify(requestCode)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
    return true;
  })()`);
  if (!submitted) throw new Error("Breadl request form not found");

  await sleep(500);
  await browser.waitUntil(
    `location.pathname.startsWith("/d/") ||
     /not found|invalid|error|book not available/i.test(document.body?.innerText || "")`,
    options.timeoutMs || 45000,
  );
  if (options.waitMs > 0) await sleep(options.waitMs);
  const data = await browser.evaluate(EXTRACT_BREADL_DOWNLOAD);
  const body = data.body_excerpt || "";
  let status = "unexpected-content";
  if (locationPath(data.url).startsWith("/d/") && data.candidates.length) {
    status = "ok";
  } else if (/not found|invalid|does not exist|book not available/i.test(body)) {
    status = "not-found";
  }
  return {
    status,
    request_code: requestCode,
    download_page_url: data.url,
    file: {
      title: data.page_title,
      size: data.size,
    },
    candidates: data.candidates,
    evidence: evidence(BREADL_REQUEST_URL, { ...nav, ...data }),
  };
}

async function codeForTarget(browser, target, options) {
  const value = String(target || "").trim();
  if (isRequestCode(value) && !/^https?:\/\//i.test(value) && !/^\d+$/.test(value)) {
    return { requestCode: value.toUpperCase(), resolved: null };
  }
  const resolved = await resolveTarget(browser, value, options);
  if (resolved.status !== "ok" || !resolved.book.request_code) {
    const error = new Error(
      resolved.status === "no-request-code"
        ? "Anna book page has no Request Code"
        : "could not resolve an Anna book Request Code",
    );
    error.payload = resolved;
    throw error;
  }
  return { requestCode: resolved.book.request_code, resolved };
}

async function requestCommand(options) {
  const target = options.positionals[0];
  if (!target) throw new Error("request requires a Request Code, Anna URL, or book ID");
  const browser = new HeadlessBrowser(options);
  try {
    await browser.start();
    const resolved = await codeForTarget(browser, target, options);
    const requested = await submitBreadl(browser, resolved.requestCode, options);
    if (resolved.resolved) requested.anna = resolved.resolved;
    return requested;
  } finally {
    await browser.close();
  }
}

function extensionForContentType(contentType) {
  const value = String(contentType || "").toLowerCase();
  if (value.includes("pdf")) return ".pdf";
  if (value.includes("epub")) return ".epub";
  if (value.includes("mobipocket")) return ".mobi";
  if (value.includes("zip")) return ".zip";
  return ".bin";
}

async function fileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function downloadCandidate(candidate, options, title) {
  const response = await fetch(candidate.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30 * 60 * 1000),
    headers: {
      "user-agent": DEFAULT_UA,
      accept: "*/*",
      referer: options.referer || "https://breadl.cc/",
    },
  });
  if (!response.ok) {
    throw new Error(`download returned HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("download response had no body");

  const dispositionName = contentDispositionFilename(
    response.headers.get("content-disposition"),
  );
  let urlName = "";
  try {
    urlName = decodeURIComponent(new URL(response.url).pathname.split("/").pop() || "");
  } catch {
    // ignore
  }
  let filename =
    dispositionName ||
    urlName ||
    `${title || "book"}${extensionForContentType(response.headers.get("content-type"))}`;
  filename = safeFilename(filename);
  if (!path.extname(filename)) {
    const inferredExt = extensionForContentType(response.headers.get("content-type"));
    if (inferredExt !== ".bin") filename += inferredExt;
  }

  const outputDir = path.resolve(options.outDir || "books");
  await fsp.mkdir(outputDir, { recursive: true });
  const requestedPath = options.outFile
    ? path.resolve(options.outFile)
    : path.join(outputDir, filename);
  if (options.outFile && fs.existsSync(requestedPath)) {
    throw new Error(`output file already exists: ${requestedPath}`);
  }
  const finalPath = availablePath(requestedPath);
  await fsp.mkdir(path.dirname(finalPath), { recursive: true });
  const partPath = `${finalPath}.part-${process.pid}`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partPath, {
      flags: "wx",
    }));
    await fsp.rename(partPath, finalPath);
  } catch (error) {
    await fsp.rm(partPath, { force: true }).catch(() => {});
    throw error;
  }
  const stat = await fsp.stat(finalPath);
  return {
    path: finalPath,
    bytes: stat.size,
    sha256: await fileSha256(finalPath),
    content_type: response.headers.get("content-type") || "",
    final_url: response.url,
  };
}

async function downloadCommand(options) {
  const target = options.positionals[0];
  if (!target) throw new Error("download requires a Request Code, Anna URL, or book ID");
  const browser = new HeadlessBrowser(options);
  let requested;
  try {
    await browser.start();
    const resolved = await codeForTarget(browser, target, options);
    requested = await submitBreadl(browser, resolved.requestCode, options);
    if (resolved.resolved) requested.anna = resolved.resolved;
  } finally {
    await browser.close();
  }

  if (requested.status !== "ok") return requested;
  const candidate = chooseCandidate(
    requested.candidates,
    options.mirror || "Mirror 1",
  );
  if (!candidate) {
    return {
      ...requested,
      status: "unexpected-content",
      error: "no downloadable http(s) candidate found",
    };
  }
  const download = await downloadCandidate(
    candidate,
    { ...options, referer: requested.download_page_url },
    requested.file?.title,
  );
  return {
    ...requested,
    status: "ok",
    selected_candidate: candidate,
    download,
  };
}

async function doctorCommand(options) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const chrome = findChrome(options.chromePath);
  const checks = {
    node: {
      ok: nodeMajor >= 22,
      version: process.versions.node,
      requirement: ">=22",
    },
    chrome: {
      ok: Boolean(chrome),
      path: chrome,
    },
    headless_only: {
      ok: true,
      launch_arg: "--headless=new",
    },
  };
  if (options.probe && chrome) {
    const browser = new HeadlessBrowser({ ...options, chromePath: chrome });
    try {
      await browser.start();
      const anna = await browser.navigate(`${ANNA_BASE}/`, options);
      const breadl = await browser.navigate(BREADL_REQUEST_URL, options);
      checks.anna = {
        ok: Boolean(anna.title),
        title: anna.title,
        url: anna.url,
      };
      checks.breadl = {
        ok: Boolean(breadl.title),
        title: breadl.title,
        url: breadl.url,
      };
    } finally {
      await browser.close();
    }
  }
  return {
    status: Object.values(checks).every((item) => item.ok) ? "ok" : "error",
    checks,
    checked_at: new Date().toISOString(),
  };
}

export function parseCli(argv) {
  const positionals = [];
  const options = {
    limit: 10,
    timeoutMs: 45000,
    waitMs: 500,
    probe: true,
  };
  const aliases = {
    "--limit": "limit",
    "--out": "out",
    "--timeout": "timeout",
    "--wait-ms": "waitMs",
    "--state": "state",
    "--chrome-path": "chromePath",
    "--out-dir": "outDir",
    "--out-file": "outFile",
    "--mirror": "mirror",
    "--no-probe": "noProbe",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = aliases[arg];
    if (!key) throw new Error(`unknown option: ${arg}`);
    if (key === "noProbe") {
      options.probe = false;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    i += 1;
    options[key] = value;
  }
  options.positionals = positionals;
  options.limit = Number(options.limit);
  options.waitMs = Number(options.waitMs);
  const timeoutSeconds = Number(options.timeout || 45);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 1800) {
    throw new Error("--timeout must be between 1 and 1800 seconds");
  }
  if (!Number.isFinite(options.waitMs) || options.waitMs < 0 || options.waitMs > 120000) {
    throw new Error("--wait-ms must be between 0 and 120000");
  }
  options.timeoutMs = timeoutSeconds * 1000;
  delete options.timeout;
  delete options.noProbe;
  return options;
}

async function writeOutput(payload, outPath) {
  const text = JSON.stringify(payload, null, 2);
  process.stdout.write(text + "\n");
  if (outPath) {
    const absolute = path.resolve(outPath);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, text + "\n", "utf8");
  }
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const command = options.positionals.shift();
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(
      [
        "Usage:",
        "  anna_breadl_book_finder.mjs search QUERY [options]",
        "  anna_breadl_book_finder.mjs resolve BOOK_URL_OR_ID [options]",
        "  anna_breadl_book_finder.mjs request REQUEST_CODE_OR_BOOK [options]",
        "  anna_breadl_book_finder.mjs download REQUEST_CODE_OR_BOOK [options]",
        "  anna_breadl_book_finder.mjs doctor [--no-probe] [options]",
        "",
      ].join("\n"),
    );
    return;
  }

  if (options.state) options.storageState = await loadStorageState(options.state);
  let payload;
  if (command === "search") payload = await searchCommand(options);
  else if (command === "resolve") payload = await resolveCommand(options);
  else if (command === "request") payload = await requestCommand(options);
  else if (command === "download") payload = await downloadCommand(options);
  else if (command === "doctor") payload = await doctorCommand(options);
  else throw new Error(`unknown command: ${command}`);
  await writeOutput(payload, options.out);
  if (payload.status !== "ok") process.exitCode = 2;
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch(async (error) => {
    const payload = {
      status: error.payload?.status || "error",
      error: error.message,
      detail: error.payload || undefined,
      checked_at: new Date().toISOString(),
    };
    process.stderr.write(JSON.stringify(payload, null, 2) + "\n");
    process.exitCode = 1;
  });
}
