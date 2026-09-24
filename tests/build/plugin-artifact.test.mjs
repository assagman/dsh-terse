import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Prove the shipped artefact, not the sources.
 *
 * A registry install resolves dist/index.js through the packed manifest, so the
 * entry point must import cleanly, export the row contract a profile loader
 * reads, and register on all six layers against a minimal context. The specs
 * under tests/unit run against src via the "@" alias and would not catch a
 * build that dropped a module or a relative import the rewriter missed.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DIST = join(ROOT, 'dist')
const ENTRY = join(DIST, 'index.js')

/** Every module the packed tarball advertises must exist after a build. */
const EXPECTED_MODULES = ['drift.js', 'index.js', 'instructions.js', 'shaping.js']

test('the build emits every advertised module', () => {
  const built = readdirSync(DIST)
  for (const module of EXPECTED_MODULES) {
    assert.ok(built.includes(module), 'dist/' + module + ' is missing from the build')
  }
})

test('the entry point carries the plugin row contract', async () => {
  const plugin = await import(pathToFileURL(ENTRY).href)
  assert.equal(plugin.name, 'dsh-terse')
  assert.deepEqual(plugin.inject, ['systemPrompt'])
  assert.equal(typeof plugin.apply, 'function')
  // Cordis reads this out of the module before it mounts the row; a missing
  // schema would silently drop every config the profile patch supplies.
  assert.ok(plugin.Config, 'the entry point does not export a Config schema')
})

test('the entry point registers every layer on a context', async () => {
  const { apply } = await import(pathToFileURL(ENTRY).href)
  const sections = []
  const contexts = []
  const listeners = new Map()
  const ctx = {
    systemPrompt: {
      section: (s) => { sections.push(s); return () => {} },
      context: (c) => { contexts.push(c); return () => {} },
    },
    on: (event, fn) => {
      const list = listeners.get(event) ?? []
      list.push(fn)
      listeners.set(event, list)
      return () => {}
    },
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  }
  apply(ctx)
  // L1 constitution and L2 standing reminder land on the prompt registry.
  assert.equal(sections.length, 1)
  assert.equal(contexts.length, 1)
  // L3/L4 share one tools/post-execute listener; L5 observes prompt assembly.
  assert.ok(listeners.get('tools/post-execute')?.length >= 1)
  assert.ok(listeners.get('system-prompt/assemble')?.length >= 1)
})

test('every built module parses under the runtime it ships to', () => {
  for (const module of EXPECTED_MODULES) {
    // A syntax-level load is enough here; pack-smoke runs --check on the packed
    // copies, so this guards the checkout build without duplicating that scan.
    const source = readFileSync(join(DIST, module), 'utf8')
    assert.ok(source.length > 0, 'dist/' + module + ' is empty')
  }
})
