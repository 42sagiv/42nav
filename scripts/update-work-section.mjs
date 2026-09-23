#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const GITHUB_USER = process.env.GITHUB_USER || "42sagiv";
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN_READ || "";
const INDEX_PATH = "index.html";
const MANUAL_PATH = "data/manual-work-cards.json";
const TOPIC_INCLUDE = "work-showcase";
const TOPIC_LIVE = "status-live";
const START_MARKER = "<!-- WORK-CARDS-START -->";
const END_MARKER = "<!-- WORK-CARDS-END -->";

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchGithub(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "42nav-work-section-updater",
      ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {})
    }
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function getTaggedRepos() {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await fetchGithub(
      `/users/${GITHUB_USER}/repos?per_page=100&page=${page}&type=owner&sort=pushed`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return repos
    .filter((r) => !r.archived && !r.fork)
    .filter((r) => Array.isArray(r.topics) && r.topics.includes(TOPIC_INCLUDE))
    .map((r) => ({
      name: r.name,
      description: r.description || "",
      url: r.html_url,
      live: r.topics.includes(TOPIC_LIVE),
      pushedAt: r.pushed_at
    }));
}

async function getManualEntries() {
  try {
    const raw = await readFile(MANUAL_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function renderCard(entry) {
  const tagClass = entry.live ? "live" : "dev";
  const tagLabel = entry.live ? "Open Source" : "In Development";
  const desc = escapeHtml(entry.description);
  const name = escapeHtml(entry.name);

  const linkOrNote = entry.url
    ? `<a class="work-link" href="${entry.url}" target="_blank" rel="noopener">View on GitHub →</a>`
    : `<span class="no-link">${escapeHtml(entry.noLinkText || "Details available on request")}</span>`;

  return `      <div class="work-card">
        <span class="work-tag ${tagClass}">${tagLabel}</span>
        <h3>${name}</h3>
        <p>${desc}</p>
        ${linkOrNote}
      </div>`;
}

async function main() {
  const [manual, auto] = await Promise.all([getManualEntries(), getTaggedRepos()]);

  auto.sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt));

  const allCards = [...manual, ...auto].map(renderCard).join("\n\n");

  const html = await readFile(INDEX_PATH, "utf8");
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Could not find ${START_MARKER} / ${END_MARKER} markers in ${INDEX_PATH}.`
    );
  }

  const before = html.slice(0, startIdx + START_MARKER.length);
  const after = html.slice(endIdx);
  const updated = `${before}\n${allCards}\n      ${after}`;

  if (updated === html) {
    console.log("No changes — Work section already up to date.");
    return;
  }

  await writeFile(INDEX_PATH, updated, "utf8");
  console.log(`Updated ${INDEX_PATH} with ${manual.length + auto.length} work card(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
