#!/usr/bin/env node
/**
 * Package smoke test.
 *
 * A registry install is the only install most users ever see, so the artefact
 * must be proven shippable before a tag can reach the publish job: every entry
 * point a loader resolves must be inside the tarball, the packed manifest must
 * point at files that shipped, and nothing that belongs to development may
 * travel with them. The tarball's own manifest is inspected rather than the
 * checkout's, because a local-path spec that only exists before packing would
 * still break the install users get.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Entries a profile loader or a reader needs in the tarball. */
const REQUIRED = [
  'package/package.json',
  'package/cordis.patch.yml',
  'package/README.md',
  'package/LICENSE',
  'package/dist/index.js',
  'package/dist/drift.js',
  'package/dist/instructions.js',
  'package/dist/shaping.js',
]

/** Entries that must never ship: development inputs and local state. */
const FORBIDDEN = [
  /^package\/(src|tests|tools|scripts|node_modules|\.harness)\//u,
  /^package\/(tsconfig[^/]*\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/u,
  /^package\/\.github\//u,
]

/** The bundle row this plugin owns, exactly as a profile loader resolves it. */
const PATCH_ROW = "name: '@sagmans/dsh-terse'"

/** Dependency protocols that cannot be resolved from a registry tarball. */
const LOCAL_PROTOCOLS = ['link:', 'workspace:', 'file:']

function walk(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

const problems = []
const out = mkdtempSync(join(tmpdir(), 'dsh-terse-pack-'))
try {
  execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: ROOT, stdio: 'inherit' })
  const tarball = readdirSync(out).find(name => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error('pnpm pack produced no tarball')
  const archive = join(out, tarball)
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(entry => entry !== '')
  const read = (entry) => execFileSync('tar', ['-xOzf', archive, entry], { encoding: 'utf8' })

  for (const entry of REQUIRED) {
    if (!entries.includes(entry)) problems.push('missing from the tarball: ' + entry)
  }
  for (const entry of entries) {
    if (FORBIDDEN.some(pattern => pattern.test(entry))) problems.push('should not ship: ' + entry)
  }

  const packed = JSON.parse(read('package/package.json'))
  if (packed.private === true) problems.push('the packed manifest is private, so npm would refuse it')
  const shipped = (target) => typeof target === 'string' && entries.includes('package/' + target.replace(/^\.\//u, ''))
  const declared = packed.dsh?.bundle?.patch
  if (!shipped(declared)) problems.push('the manifest does not point at a bundle patch that ships')
  // An export may be a bare path or a conditions object ("types"/"default"), and
  // every string a resolver can pick must ship; a nested path that only exists in
  // the checkout would still break the install users get.
  const targets = (value, label) => {
    if (typeof value === 'string') return [[label, value]]
    if (value !== null && typeof value === 'object') {
      return Object.entries(value).flatMap(([condition, nested]) => targets(nested, label + '.' + condition))
    }
    return []
  }
  const declaredTargets = [
    ['main', packed.main],
    ...Object.entries(packed.exports ?? {}).flatMap(([key, value]) => targets(value, 'exports["' + key + '"]')),
  ]
  for (const [label, target] of declaredTargets) {
    if (!shipped(target)) problems.push(label + ' points at ' + String(target) + ', which is not in the tarball')
  }

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(packed[field] ?? {})) {
      if (typeof spec === 'string' && LOCAL_PROTOCOLS.some(protocol => spec.startsWith(protocol))) {
        problems.push(field + '.' + name + ' uses ' + spec.split(':')[0] + ':, which a registry install cannot resolve')
      }
    }
  }

  const patch = read('package/cordis.patch.yml')
  if (!patch.includes(PATCH_ROW)) problems.push('the bundle patch no longer names ' + PATCH_ROW)

  const modules = walk(join(ROOT, 'dist')).filter(file => file.endsWith('.js'))
  for (const module of modules) execFileSync(process.execPath, ['--check', module], { stdio: 'inherit' })

  console.log('\npacked ' + entries.length + ' entries, ' + modules.length + ' modules parse')
  console.log('tarball: ' + archive)
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error))
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error('\npack-smoke: the artefact is not shippable')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('pack-smoke: ok')
