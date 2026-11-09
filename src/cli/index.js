'use strict';

const { Command } = require('commander');
const pkg = require('../../package.json');

function applyProjectDir(dir) {
  if (!dir || !String(dir).trim()) return;
  try {
    process.chdir(String(dir));
  } catch (err) {
    console.error(`\nError: cannot use project folder "${dir}": ${err.message}`);
    process.exit(1);
  }
}

const program = new Command();

program
  .name('qa-probe')
  .description('Local QA agent — maps frontend routes → backend APIs, probes live, scores pages 0–100')
  .version(pkg.version)
  .option('--project <dir>', 'run as if started in this project folder (or set QA_PROBE_PROJECT_DIR)');

// Desktop apps start the server in their own folder, so let the caller name the project.
program.hook('preAction', () => applyProjectDir(program.opts().project || process.env.QA_PROBE_PROJECT_DIR));

program
  .command('analyze')
  .description('Parse frontend source + fetch backend OpenAPI spec → writes .qaprobe/graph.json')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .option('--headless', 'skip OpenAPI fetch, discover endpoints from frontend source only')
  .option('--har <file>', 'discover endpoints from a recorded .har file (real traffic, any stack)')
  .option('--runtime', 'open each page in a real browser and record the API calls it makes')
  .option('--frontend-url <url>', 'where the running frontend is served, for --runtime')
  .action((opts) => {
    require('./commands/analyze')(opts);
  });

program
  .command('probe')
  .description('Authenticate + hit every mapped endpoint → writes .qaprobe/probe-results.json')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .action((opts) => {
    require('./commands/probe')(opts);
  });

program
  .command('report')
  .description('Root-cause analysis + score routes → writes report.json, report.md, ai-context.md')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .option('--fail-under <score>', 'exit 1 if overall score < N (CI gate)', parseInt)
  .action((opts) => {
    require('./commands/report')(opts);
  });

program
  .command('fix')
  .description('Generate high-confidence remediation diffs from the latest qa-probe report')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .option('--apply', 'apply high-confidence fixes to disk')
  .option('--pr', 'prepare changes for a pull request branch')
  .action((opts) => {
    require('./commands/fix')(opts);
  });

program
  .command('label <endpoint> <verdict>')
  .description('Record feedback on a diagnosis, reapplied on future runs. verdict: expected|ignore|known_gate|ok (suppress) or bug|real_bug|confirm.')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .option('-r, --reason <text>', 'why this verdict (recommended — it is the audit trail)')
  .option('-s, --signal <rootCause>', 'only apply while the endpoint produces this rootCause (default: any)')
  .option('--by <name>', 'who recorded this (default: human)')
  .action((endpoint, verdict, opts) => {
    require('./commands/label')(endpoint, verdict, opts);
  });

program
  .command('mcp')
  .description('Start MCP server over stdio — wires qa-probe tools into Claude and Codex')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .action((opts) => {
    require('./commands/mcp')(opts);
  });

program
  .command('run')
  .description('Run analyze → probe → report in sequence (all-in-one pipeline)')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .option('--fail-under <score>', 'exit 1 if overall score < N (CI gate)', parseInt)
  .option('--headless', 'skip OpenAPI fetch, discover endpoints from frontend source only')
  .option('--har <file>', 'discover endpoints from a recorded .har file (real traffic, any stack)')
  .option('--runtime', 'open each page in a real browser and record the API calls it makes')
  .option('--frontend-url <url>', 'where the running frontend is served, for --runtime')
  .action((opts) => {
    require('./commands/run')(opts);
  });

program
  .command('verify')
  .description('After a change, live-probe the endpoints the changed files affect and report pass, fail or inconclusive with evidence')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .option('--files <list>', 'comma-separated changed files (default: files changed in git)')
  .option('--git [ref]', 'use files changed against a git ref (default HEAD)')
  .option('--all', 'probe every known endpoint, not only the affected ones')
  .option('--json', 'print the result as JSON')
  .option('--strict', 'also exit non-zero when the result is inconclusive (for CI)')
  .action((opts) => {
    require('./commands/verify')(opts);
  });

program
  .command('doctor')
  .description('Check setup: Node version, config, credentials, output folder, backend and OpenAPI reachability')
  .option('-c, --config <path>', 'path to qa-probe.config.js', './qa-probe.config.js')
  .action((opts) => {
    require('./commands/doctor')(opts);
  });

program.parse(process.argv);
