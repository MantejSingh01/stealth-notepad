/**
 * Lists tests marked test.fails. Vitest flips those to green while the
 * assertion still fails, which is how this suite stays runnable.
 * A known-bug test that starts passing fails the run until `.fails` is removed.
 */
export default class KnownBugReporter {
  onTestRunEnd(modules) {
    const stillBroken = [];
    const fixedOrBrokenHarness = [];
    for (const mod of modules) {
      for (const test of mod.children.allTests()) {
        const known = test.options?.fails || test.name.startsWith('[known bug]');
        if (!known) continue;
        const state = test.result().state;
        if (state === 'skipped' || state === 'pending') continue;
        const where = `${mod.moduleId.split('/').slice(-2).join('/')} — ${test.name}`;
        if (state === 'passed') stillBroken.push(where);
        else fixedOrBrokenHarness.push(`${where} (${state})`);
      }
    }
    const lines = [];
    if (stillBroken.length) {
      lines.push('');
      lines.push(`Known bugs still reproduced: ${stillBroken.length}.`);
      lines.push('Each one asserts the correct behavior, fails on this build, and is marked test.fails so the command can exit 0.');
      lines.push('When a bug is fixed, that test fails with "Expect test to fail" until you remove `.fails`.');
      for (const line of stillBroken) lines.push(`  - ${line}`);
    }
    if (fixedOrBrokenHarness.length) {
      lines.push('');
      lines.push('Known-bug tests that did not fail as expected:');
      for (const line of fixedOrBrokenHarness) lines.push(`  - ${line}`);
    }
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  }
}
