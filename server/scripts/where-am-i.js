// server/scripts/where-am-i.js
//
// "Am I on the latest code?" — run it on the PC and on the server and compare.
// Checks three things git status alone will not tell you together:
//   1. what commit this checkout is on, and how it compares to origin
//   2. whether anything is uncommitted here
//   3. whether client/build is older than client/src — the server can be on the
//      newest commit and STILL serve stale JavaScript to every browser
//
//   node server/scripts/where-am-i.js
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..', '..');
const SLASH = ROOT.split(path.sep).join('/');
const git = args => {
  try {
    return execSync('git -c safe.directory=' + SLASH + ' ' + args,
                    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { return null; }
};

const line = s => console.log(s);
line('');
line('  repo    : ' + ROOT);

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch) { line('  NOT A GIT REPOSITORY (or git is not on PATH)'); process.exit(1); }
line('  branch  : ' + branch);
line('  HEAD    : ' + git('log --oneline -1'));
line('  changed : ' + (git('log -1 --format=%ci') || '?'));

process.stdout.write('  fetching origin... ');
const fetched = git('fetch origin') !== null;
line(fetched ? 'ok' : 'FAILED — no network or no remote; the comparison below is stale');

line('');
const remote = git('log --oneline -1 origin/' + branch);
if (!remote) {
  line('  >> cannot see origin/' + branch + ' — nothing to compare against');
} else {
  line('  origin  : ' + remote);
  const ahead  = git('rev-list --count origin/' + branch + '..HEAD');
  const behind = git('rev-list --count HEAD..origin/' + branch);
  line('');
  if (ahead === null || behind === null) {
    line('  >> could not compare with origin/' + branch);
  } else if (Number(behind) > 0 && Number(ahead) > 0) {
    line('  >> DIVERGED: ' + ahead + ' local commit(s) not pushed, ' + behind + ' remote commit(s) not pulled');
  } else if (Number(behind) > 0) {
    line('  >> BEHIND by ' + behind + ' commit(s).  git pull origin ' + branch);
  } else if (Number(ahead) > 0) {
    line('  >> AHEAD by ' + ahead + ' commit(s), not pushed.  git push origin ' + branch);
  } else {
    line('  >> in sync with origin/' + branch);
  }
}

const dirty = (git('status --porcelain') || '').split('\n').filter(Boolean);
line('  >> ' + (dirty.length ? dirty.length + ' uncommitted change(s):' : 'working tree clean'));
dirty.slice(0, 12).forEach(l => line('       ' + l));
if (dirty.length > 12) line('       ... and ' + (dirty.length - 12) + ' more');

// ── the part git cannot tell you ────────────────────────────────────────────
const newestIn = dir => {
  let newest = 0, file = null;
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      let m; try { m = fs.statSync(p).mtimeMs; } catch (_) { continue; }
      if (m > newest) { newest = m; file = p; }
    }
  })(dir);
  return { newest, file };
};

const src   = path.join(ROOT, 'client', 'src');
const build = path.join(ROOT, 'client', 'build');
line('');
if (!fs.existsSync(build)) {
  line('  >> client/build is MISSING — browsers have nothing to load.');
  line('     cd client  &&  set "CI="  &&  npm run build');
} else if (!fs.existsSync(src)) {
  line('  >> client/src not found — skipping the build check');
} else {
  const s = newestIn(src), b = newestIn(build);
  const fmt = ms => (ms ? new Date(ms).toLocaleString() : '—');
  line('  client/src   newest : ' + fmt(s.newest));
  line('  client/build newest : ' + fmt(b.newest));
  if (b.newest >= s.newest) {
    line('  >> build is up to date with the sources');
  } else {
    line('  >> BUILD IS STALE — this machine serves OLD JavaScript no matter what git says.');
    line('     newer than the build: ' + String(s.file).slice(ROOT.length + 1));
    line('     cd client  &&  set "CI="  &&  npm run build');
  }
}
line('');
