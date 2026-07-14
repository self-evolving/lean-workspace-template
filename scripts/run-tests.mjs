import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

// CI supplies a deliberately narrow Quartz test list. Keep bare `npm test`
// discovery unchanged, but make every explicit test-file run include focused
// browser-script regression suites that are otherwise easy to omit.
const requiredQuartzTests = [
  "quartz/components/scripts/popoverClearScheduler.test.mjs",
  "quartz/plugins/local/canvas-page/canvas-page.test.mjs",
  "quartz/plugins/local/canvas-page/canvas-focus.test.mjs",
  "quartz/plugins/local/canvas-page/canvas-interaction.test.mjs",
]
const requestedArgs = process.argv.slice(2)
const hasExplicitTestFiles = requestedArgs.some(
  (arg) => !arg.startsWith("-") && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(arg),
)
const testArgs = hasExplicitTestFiles
  ? [...requestedArgs, ...requiredQuartzTests.filter((test) => !requestedArgs.includes(test))]
  : requestedArgs

const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), "--test", ...testArgs], {
  stdio: "inherit",
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
