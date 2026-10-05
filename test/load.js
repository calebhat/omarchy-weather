// Loading a QML library into Node.
//
// The plugin's pure logic lives in `.pragma library` files, which are plain
// JavaScript once the QML-only directives are removed. Running the real file
// rather than a copy is the whole point: a test that exercised a duplicate
// would pass while the shell loaded something else.
//
// The source is evaluated in this realm rather than in a fresh `vm` context. A
// separate context would give the library its own Array and Object, so an array
// it returned would fail `deepStrictEqual` against an identical one built here
// — a failure about realms, not about the code.

const { readFileSync } = require("node:fs")
const { join } = require("node:path")
const vm = require("node:vm")

const PLUGIN = join(__dirname, "..")

// Top-level declarations, which the wrapper re-exports. Anchored at column
// zero: a `var` indented inside a function is scoped to that function, and
// naming it here would be a reference error rather than an export.
const DECLARATION = /^(?:var|function)\s+([A-Za-z_$][\w$]*)/gm

// `.import "Other.js" as Name` becomes a parameter holding that library, so a
// library that leans on another is tested against the real one.
const IMPORT = /^\s*\.import\s+"([^"]+)"\s+as\s+(\w+)/gm

function loadLibrary(fileName) {
  const raw = readFileSync(join(PLUGIN, fileName), "utf8")
  const imports = [...raw.matchAll(IMPORT)].map(match => [match[2], loadLibrary(match[1])])
  const source = raw.replace(/^\s*\.(pragma|import)\b.*$/gm, "")

  const exported = [...new Set([...source.matchAll(DECLARATION)].map(match => match[1]))]
  if (exported.length === 0) throw new Error(`${fileName} declares nothing at the top level`)

  const factory = vm.runInThisContext(
    `(function (${imports.map(pair => pair[0]).join(", ")}) {\n${source}\nreturn { ${exported.join(", ")} }\n})`,
    { filename: fileName })

  return factory(...imports.map(pair => pair[1]))
}

module.exports = { loadLibrary, RadarModel: loadLibrary("RadarModel.js") }
