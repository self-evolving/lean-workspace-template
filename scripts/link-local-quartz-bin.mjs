#!/usr/bin/env node
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const binDir = path.join(root, "node_modules", ".bin")
const posixBin = path.join(binDir, "quartz")
const windowsBin = path.join(binDir, "quartz.cmd")

fs.mkdirSync(binDir, { recursive: true })

fs.writeFileSync(
  posixBin,
  `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")
exec node "$basedir/../../quartz/bootstrap-cli.mjs" "$@"
`,
  { mode: 0o755 },
)

fs.writeFileSync(
  windowsBin,
  `@ECHO off
SETLOCAL
SET "basedir=%~dp0"
node "%basedir%\\..\\..\\quartz\\bootstrap-cli.mjs" %*
`,
)
