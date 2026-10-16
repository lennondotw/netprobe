import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

import { configSchema, presetIds } from '../src/server/config.ts'

type Json = Record<string, unknown>

export const schemaPath = resolve(import.meta.dirname, '../config/netprobe.schema.json')

/**
 * The JSON Schema for config files, generated from the zod definition that the server validates
 * with, so editor completion and server validation never disagree. On top of the generated
 * schema, built-in ids become enums, which gives completion for `presets.exclude` and friends.
 */
export const buildSchema = (): Json => {
  const schema = z.toJSONSchema(configSchema, { io: 'input', target: 'draft-7' }) as Json
  const ids = presetIds()
  const at = (path: string[]): Json =>
    path.reduce<Json>((node, key) => {
      const next = node[key]
      if (!next || typeof next !== 'object') throw new Error(`Schema has no ${path.join('.')}`)
      return next as Json
    }, schema)

  at(['properties', 'presets', 'properties', 'exclude']).items = {
    enum: [...ids.services, ...ids.targets],
    description: 'A built-in service id, or service.target for a single target.',
  }
  at(['properties', 'presets', 'properties', 'excludeCategories']).items = {
    enum: ids.categories,
  }

  // Service ids: suggest the built-in ones (to extend them) while allowing new ones.
  const serviceId = at(['properties', 'services', 'items', 'properties', 'id'])
  at(['properties', 'services', 'items', 'properties']).id = {
    description: serviceId.description,
    anyOf: [{ enum: ids.services }, { ...serviceId, description: undefined }],
  }
  const category = at(['properties', 'services', 'items', 'properties', 'category'])
  category.examples = ids.categories

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Netprobe configuration',
    ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema')),
  }
}

export const renderSchema = () => `${JSON.stringify(buildSchema(), null, 2)}\n`

// `pnpm schema` writes the file; tests compare it with a fresh render.
if (process.argv[1] === import.meta.filename) {
  const next = renderSchema()
  const current = (() => {
    try {
      return readFileSync(schemaPath, 'utf8')
    } catch {
      return null
    }
  })()
  if (current === next) {
    console.log('config/netprobe.schema.json is up to date')
  } else {
    writeFileSync(schemaPath, next)
    console.log('wrote config/netprobe.schema.json')
  }
}
