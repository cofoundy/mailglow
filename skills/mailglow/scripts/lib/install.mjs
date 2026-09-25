// `mailglow init`: copy this skill into a project's agent skill folders, so any coding agent there
// can use it. Folder conventions per agent follow the open skills ecosystem (vercel-labs/skills,
// "Supported Agents" table, checked 2026-09-24): Claude Code reads .claude/skills; Codex, Cursor,
// Gemini CLI, GitHub Copilot, OpenCode, Amp and friends share .agents/skills.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(HERE, '..', '..');
export const SKILL_NAME = 'mailglow';

// agent → { project: dir under the project, global: dir under $HOME, markers: what says "this agent is used here" }
export const AGENTS = {
  claude: { label: 'Claude Code', project: '.claude/skills', global: '.claude/skills', markers: ['.claude', 'CLAUDE.md'] },
  codex: { label: 'Codex', project: '.agents/skills', global: '.codex/skills', markers: ['.codex', 'AGENTS.md'] },
  cursor: { label: 'Cursor', project: '.agents/skills', global: '.cursor/skills', markers: ['.cursor', '.cursorrules'] },
  gemini: { label: 'Gemini CLI', project: '.agents/skills', global: '.gemini/skills', markers: ['.gemini', 'GEMINI.md'] },
  copilot: { label: 'GitHub Copilot', project: '.agents/skills', global: '.copilot/skills', markers: ['.github/copilot-instructions.md'] },
  opencode: { label: 'OpenCode', project: '.agents/skills', global: '.config/opencode/skills', markers: ['.opencode', 'opencode.json'] },
  agents: { label: 'any .agents/skills reader', project: '.agents/skills', global: '.agents/skills', markers: ['.agents'] },
  windsurf: { label: 'Windsurf', project: '.windsurf/skills', global: '.codeium/windsurf/skills', markers: ['.windsurf', '.windsurfrules'] },
  kiro: { label: 'Kiro', project: '.kiro/skills', global: '.kiro/skills', markers: ['.kiro'] },
  roo: { label: 'Roo Code', project: '.roo/skills', global: '.roo/skills', markers: ['.roo'] },
};
const ALIASES = { 'claude-code': 'claude', 'gemini-cli': 'gemini', 'github-copilot': 'copilot', universal: 'agents' };

export function parseAgents(list) {
  return String(list).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).map((a) => {
    const k = ALIASES[a] || a;
    if (!AGENTS[k]) throw new Error(`unknown agent "${a}" — one of: ${Object.keys(AGENTS).join(', ')}`);
    return k;
  });
}

// Agents whose markers exist in the project. None found → Claude Code + the shared .agents/skills,
// which together cover the most agents with two folders.
export function detectAgents(project) {
  const found = Object.entries(AGENTS).filter(([, a]) => a.markers.some((m) => fs.existsSync(path.join(project, m)))).map(([k]) => k);
  return found.length ? found : ['claude', 'agents'];
}

export function plan({ project = process.cwd(), agents, global = false, home = os.homedir() } = {}) {
  const keys = agents ? (Array.isArray(agents) ? agents : parseAgents(agents)) : global ? ['claude', 'agents'] : detectAgents(project);
  const targets = new Map(); // one copy per folder, however many agents read it
  for (const k of keys) {
    const dir = path.join(global ? home : project, global ? AGENTS[k].global : AGENTS[k].project, SKILL_NAME);
    if (!targets.has(dir)) targets.set(dir, []);
    targets.get(dir).push(AGENTS[k].label);
  }
  return [...targets].map(([dir, labels]) => ({ dir, agents: labels }));
}

export function install({ project = process.cwd(), agents, global = false, force = false, dryRun = false, home, log = console.log } = {}) {
  project = path.resolve(project);
  const results = [];
  for (const t of plan({ project, agents, global, home })) {
    const shown = path.relative(project, t.dir) || t.dir;
    if (path.resolve(t.dir) === SKILL_DIR) { results.push({ ...t, status: 'self' }); log(`  · ${shown} is this skill's own folder — skipped`); continue; }
    const exists = fs.existsSync(t.dir);
    if (exists && !force) { results.push({ ...t, status: 'exists' }); log(`  · ${shown} already there (--force to update) — ${t.agents.join(', ')}`); continue; }
    if (!dryRun) {
      if (exists) fs.rmSync(t.dir, { recursive: true, force: true });
      copyDir(SKILL_DIR, t.dir);
    }
    results.push({ ...t, status: exists ? 'updated' : 'installed' });
    log(`  ✓ ${shown}${dryRun ? ' (dry run)' : ''} — ${t.agents.join(', ')}`);
  }
  return results;
}

const SKIP = new Set(['node_modules', 'shots', '.git', '.DS_Store', 'picks.json']);
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}
