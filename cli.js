#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PLUGIN_ID = "workbench-explorer-sort";
const DATA_PATH = path.join(".obsidian", "plugins", PLUGIN_ID, "data.json");
const VALID_MODES = new Set([
  "name-asc",
  "name-desc",
  "ctime-desc",
  "ctime-asc",
  "mtime-desc",
  "mtime-asc",
]);

function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const vault = resolveVault(args);
  const dataFile = path.join(vault, DATA_PATH);
  const data = readData(dataFile);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "list") {
    console.log(JSON.stringify(data.rules ?? {}, null, 2));
    return;
  }

  if (command === "get") {
    const folder = normalizeFolder(args[0] ?? "");
    console.log(JSON.stringify((data.rules ?? {})[folder] ?? null, null, 2));
    return;
  }

  if (command === "set") {
    const folder = normalizeFolder(required(args, 0, "folder"));
    const mode = required(args, 1, "mode");
    if (!VALID_MODES.has(mode)) {
      die(`Invalid mode: ${mode}`);
    }
    data.rules ??= {};
    data.rules[folder] = { mode };
    writeData(dataFile, data);
    console.log(`Set ${folder || "Vault root"} -> ${mode}`);
    return;
  }

  if (command === "clear") {
    const folder = normalizeFolder(required(args, 0, "folder"));
    data.rules ??= {};
    delete data.rules[folder];
    writeData(dataFile, data);
    console.log(`Cleared ${folder || "Vault root"}`);
    return;
  }

  die(`Unknown command: ${command}`);
}

function resolveVault(args) {
  const index = args.indexOf("--vault");
  if (index !== -1) {
    const vault = args[index + 1];
    if (!vault) {
      die("--vault requires a path.");
    }
    args.splice(index, 2);
    return path.resolve(vault);
  }

  return process.cwd();
}

function readData(dataFile) {
  if (!fs.existsSync(dataFile)) {
    return { rules: {} };
  }
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function writeData(dataFile, data) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, `${JSON.stringify(data, null, 2)}\n`);
}

function normalizeFolder(folder) {
  return folder.replace(/^\/+|\/+$/g, "");
}

function required(args, index, name) {
  const value = args[index];
  if (!value) {
    die(`Missing ${name}.`);
  }
  return value;
}

function die(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Workbench Explorer Sort CLI

Usage:
  workbench-sort list [--vault <path>]
  workbench-sort get <folder> [--vault <path>]
  workbench-sort set <folder> <mode> [--vault <path>]
  workbench-sort clear <folder> [--vault <path>]

Modes:
  name-asc
  name-desc
  ctime-desc
  ctime-asc
  mtime-desc
  mtime-asc
`);
}

main();
