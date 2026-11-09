'use strict';

const { execFileSync } = require('child_process');
const chalk = require('chalk');
const { loadConfig } = require('../../config/loader');
const { loadGraph } = require('../../cache');
const { verifyChange } = require('../../verify');

/** Files changed in the working tree against `ref` (default HEAD), plus new untracked files. */
function changedFilesFromGit(ref) {
  const run = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const changed = run(['diff', '--name-only', ref || 'HEAD']);
  const untracked = run(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...changed, ...untracked])];
}

function printHuman(result) {
  const color = result.verdict === 'pass' ? chalk.green : result.verdict === 'fail' ? chalk.red : chalk.yellow;
  console.log('');
  console.log(chalk.bold('─── qa-probe verify ──────────────────────────────'));
  console.log(`  Verdict: ${color.bold(result.verdict.toUpperCase())}  (confidence: ${result.confidence})`);
  if (result.summary) console.log(`  ${result.summary}`);
  if (result.reason) console.log(`  ${result.reason}`);
  const shown = (result.endpoints || []).filter((e) => !(e.verdict === 'unverified' && e.kind === 'write'));
  for (const e of shown) {
    const icon = e.verdict === 'ok' ? chalk.green('✓') : e.verdict === 'broken' ? chalk.red('✗') : chalk.yellow('?');
    console.log(`  ${icon} ${e.endpoint}  ${chalk.gray(`${e.why}${e.status ? ` · HTTP ${e.status}` : ''}`)}`);
    if (e.affectedPages && e.affectedPages.length) console.log(chalk.gray(`      pages: ${e.affectedPages.join(', ')}`));
    if (e.fixHint && e.verdict === 'broken') console.log(chalk.gray(`      hint: ${e.fixHint}`));
  }
  for (const note of result.notChecked || []) console.log(chalk.gray(`  not checked: ${note}`));
  console.log('');
}

module.exports = async function verify(opts) {
  try {
    const config = loadConfig(opts.config);
    const graph = await loadGraph(config);
    let files = [];
    if (opts.files) files = String(opts.files).split(',').map((s) => s.trim()).filter(Boolean);
    else if (!opts.all) files = changedFilesFromGit(opts.git === true ? 'HEAD' : opts.git);

    const result = await verifyChange({ changedFiles: files, graph, config, all: !!opts.all });
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
    // Only a proven failure fails the run, unless --strict also fails "inconclusive" (nothing proven either way).
    const failed = result.verdict === 'fail' || (opts.strict && result.verdict === 'inconclusive');
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
};

module.exports.changedFilesFromGit = changedFilesFromGit;
