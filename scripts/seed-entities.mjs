#!/usr/bin/env node
/**
 * Bulk-create entities (clubs/departments/offices/organizations/programs) against a live
 * deployment's API, from a JSON file of [{ name, type }, ...] (see clubs-2025-2026.json for the
 * shape). Generates a random temporary password per entity — same as the admin-reset-password
 * flow — and writes a CSV mapping name -> temp password so they can be relayed to each entity;
 * every one is created with must_change_password set, same as any other admin-created entity.
 *
 * This intentionally goes through the real /api/auth/admin and /api/entities endpoints rather
 * than writing to D1 directly, so it gets the app's own validation (name uniqueness, password
 * length, valid type) for free instead of duplicating that logic here.
 *
 * Usage:
 *   ADMIN_PASSWORD=... node scripts/seed-entities.mjs <path-to-json> --base-url https://your-site.pages.dev
 *
 * Already-existing entities (by name) are skipped, not treated as a failure — safe to re-run
 * after fixing a few entries or adding more to the JSON file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generateTempPassword(length = 12) {
  const bytes = randomBytes(length);
  return Array.from(bytes, b => TEMP_PASSWORD_ALPHABET[b % TEMP_PASSWORD_ALPHABET.length]).join('');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url') args.baseUrl = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jsonPath = args._[0];
  if (!jsonPath || !args.baseUrl) {
    console.error('Usage: ADMIN_PASSWORD=... node scripts/seed-entities.mjs <path-to-json> --base-url https://your-site.pages.dev');
    process.exit(1);
  }
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('Set ADMIN_PASSWORD in the environment (not as a CLI arg, so it doesn\'t end up in shell history).');
    process.exit(1);
  }

  const baseUrl = args.baseUrl.replace(/\/$/, '');
  const entities = JSON.parse(readFileSync(jsonPath, 'utf8'));

  console.log(`Logging in to ${baseUrl} as admin...`);
  const loginRes = await fetch(`${baseUrl}/api/auth/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error('Admin login failed:', loginData.error || loginRes.status);
    process.exit(1);
  }
  const token = loginData.token;

  const results = [];
  for (const { name, type } of entities) {
    const password = generateTempPassword();
    const res = await fetch(`${baseUrl}/api/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, type, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 201) {
      results.push({ name, type, status: 'created', password });
      console.log(`✓ created: ${name}`);
    } else if (res.status === 409) {
      results.push({ name, type, status: 'already existed', password: '' });
      console.log(`- skipped (already exists): ${name}`);
    } else {
      results.push({ name, type, status: `FAILED: ${data.error || res.status}`, password: '' });
      console.error(`✗ failed: ${name} — ${data.error || res.status}`);
    }
  }

  const created = results.filter(r => r.status === 'created').length;
  const skipped = results.filter(r => r.status === 'already existed').length;
  const failed = results.filter(r => r.status.startsWith('FAILED')).length;
  console.log(`\n${created} created, ${skipped} already existed, ${failed} failed.`);

  const outPath = `scripts/seed-results-${Date.now()}.csv`;
  const csv = ['name,type,status,temp_password']
    .concat(results.map(r => [r.name, r.type, r.status, r.password].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')))
    .join('\n');
  writeFileSync(outPath, csv);
  console.log(`\nWrote ${outPath} (temp passwords for newly-created entities — handle it like the credentials it contains, and delete it once distributed).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
