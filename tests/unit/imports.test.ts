import { describe, it, expect } from 'vitest';
import {
  detectSourceLanguage,
  extractImports,
  resolveImport,
  buildImportGraph,
} from '../../src/git/imports.js';

describe('detectSourceLanguage', () => {
  it.each([
    ['src/a.ts', 'ts'],
    ['src/a.tsx', 'ts'],
    ['src/a.mts', 'ts'],
    ['src/a.cts', 'ts'],
    ['src/a.js', 'js'],
    ['src/a.jsx', 'js'],
    ['src/a.mjs', 'js'],
    ['src/a.cjs', 'js'],
    ['pkg/a.py', 'py'],
    ['cmd/a.go', 'go'],
    ['src/a.rs', 'rust'],
    ['Foo.java', 'java'],
  ])('classifies %s as %s', (file, lang) => {
    expect(detectSourceLanguage(file)).toBe(lang);
  });

  it('returns unknown for unsupported extensions', () => {
    expect(detectSourceLanguage('README.md')).toBe('unknown');
    expect(detectSourceLanguage('.gitignore')).toBe('unknown');
    expect(detectSourceLanguage('src/a.zig')).toBe('unknown');
  });
});

describe('extractImports', () => {
  it('captures static, namespace, default, type, and side-effect imports (ts)', () => {
    const src = `
      import './side-effect.js';
      import foo from './foo';
      import { bar, baz as quux } from './bar';
      import * as mod from './mod';
      import type { T } from './types';
      export { x } from './reexport';
      export * from './star';
    `;
    expect(extractImports('src/a.ts', src)).toEqual([
      './side-effect.js',
      './foo',
      './bar',
      './mod',
      './types',
      './reexport',
      './star',
    ]);
  });

  it('captures require() and dynamic import() (ts/js)', () => {
    const src = `
      const a = require('./a');
      const b = await import('./b');
    `;
    const imports = extractImports('src/x.js', src);
    expect(imports).toContain('./a');
    expect(imports).toContain('./b');
  });

  it('deduplicates repeated specifiers', () => {
    const src = `
      import { a } from './shared';
      import { b } from './shared';
      const c = require('./shared');
    `;
    expect(extractImports('src/x.ts', src)).toEqual(['./shared']);
  });

  it('captures from-import and bare import (py), splitting comma lists', () => {
    const src = `
from .sibling import X
from ..parent.mod import Y
import os, sys
import json
    `;
    expect(extractImports('pkg/a.py', src)).toEqual([
      '.sibling',
      '..parent.mod',
      'os',
      'sys',
      'json',
    ]);
  });

  it('captures use, mod, and pub use (rust)', () => {
    const src = `
      use crate::a::b;
      use super::sibling;
      use self::nested::{x, y};
      pub use crate::reexport;
      mod child;
      pub mod public_child;
    `;
    const imports = extractImports('src/lib.rs', src);
    expect(imports).toContain('crate::a::b');
    expect(imports).toContain('super::sibling');
    expect(imports).toContain('crate::reexport');
    expect(imports).toContain('child');
    expect(imports).toContain('public_child');
  });

  it('captures static and wildcard imports (java)', () => {
    const src = `
      package com.example;
      import com.example.util.Helper;
      import static com.example.Constants.MAX;
      import com.example.collections.*;
    `;
    expect(extractImports('Main.java', src)).toEqual([
      'com.example.util.Helper',
      'com.example.Constants.MAX',
      'com.example.collections',
    ]);
  });

  it('returns empty for unknown languages', () => {
    expect(extractImports('README.md', 'import x from "./y"')).toEqual([]);
  });

  it('survives back-to-back calls without /g state leaking', () => {
    const src = `import a from './a';`;
    expect(extractImports('x.ts', src)).toEqual(['./a']);
    expect(extractImports('x.ts', src)).toEqual(['./a']);
    expect(extractImports('x.ts', src)).toEqual(['./a']);
  });
});

describe('resolveImport (ts/js)', () => {
  const changed = new Set([
    'src/a.ts',
    'src/b.ts',
    'src/util/index.ts',
    'src/feature/main.tsx',
    'lib/legacy.js',
  ]);

  it('resolves sibling with implicit extension', () => {
    expect(resolveImport('src/a.ts', './b', changed)).toBe('src/b.ts');
  });

  it('resolves sibling with .js specifier to a .ts file (ESM published TS)', () => {
    expect(resolveImport('src/a.ts', './b.js', changed)).toBe('src/b.ts');
  });

  it('resolves directory import via index.ts', () => {
    expect(resolveImport('src/a.ts', './util', changed)).toBe(
      'src/util/index.ts'
    );
  });

  it('resolves parent-directory imports', () => {
    expect(
      resolveImport('src/feature/main.tsx', '../a', changed)
    ).toBe('src/a.ts');
  });

  it('returns null for bare specifiers (external packages)', () => {
    expect(resolveImport('src/a.ts', 'react', changed)).toBe(null);
    expect(resolveImport('src/a.ts', 'lodash/fp', changed)).toBe(null);
    expect(resolveImport('src/a.ts', '@scope/pkg', changed)).toBe(null);
  });

  it('returns null when target is outside the changed set', () => {
    expect(resolveImport('src/a.ts', './missing', changed)).toBe(null);
  });
});

describe('resolveImport (py)', () => {
  const changed = new Set([
    'pkg/__init__.py',
    'pkg/mod.py',
    'pkg/sub/__init__.py',
    'pkg/sub/leaf.py',
  ]);

  it('resolves single-dot relative import to sibling module', () => {
    expect(resolveImport('pkg/sub/leaf.py', '.', changed)).toBe(
      'pkg/sub/__init__.py'
    );
  });

  it('resolves dotted relative import to a module file', () => {
    expect(resolveImport('pkg/sub/leaf.py', '..mod', changed)).toBe(
      'pkg/mod.py'
    );
  });

  it('resolves absolute dotted path to a module file', () => {
    expect(resolveImport('pkg/sub/leaf.py', 'pkg.mod', changed)).toBe(
      'pkg/mod.py'
    );
  });
});

describe('resolveImport (rust)', () => {
  const changed = new Set([
    'src/lib.rs',
    'src/parser.rs',
    'src/util/mod.rs',
    'src/util/helper.rs',
  ]);

  it('resolves crate-rooted use to a module file', () => {
    expect(resolveImport('src/parser.rs', 'crate::util', changed)).toBe(
      'src/util/mod.rs'
    );
  });

  it('resolves super to a sibling file via parent', () => {
    expect(
      resolveImport('src/util/helper.rs', 'super::parser', changed)
    ).toBe('src/parser.rs');
  });

  it('resolves a bare mod declaration to a sibling file', () => {
    expect(resolveImport('src/util/mod.rs', 'helper', changed)).toBe(
      'src/util/helper.rs'
    );
  });
});

describe('buildImportGraph', () => {
  it('records intra-changeset edges and ignores external specifiers', () => {
    const files = new Map([
      ['src/a.ts', `import { b } from './b';\nimport React from 'react';`],
      ['src/b.ts', `import { c } from './util';`],
      ['src/util/index.ts', `export const c = 1;`],
    ]);
    const graph = buildImportGraph(files);

    expect([...graph.get('src/a.ts')!]).toEqual(['src/b.ts']);
    expect([...graph.get('src/b.ts')!]).toEqual(['src/util/index.ts']);
    expect([...graph.get('src/util/index.ts')!]).toEqual([]);
  });

  it('includes every input file as a node, even with no edges', () => {
    const files = new Map([
      ['src/standalone.ts', `// nothing to import`],
      ['README.md', `# docs`],
    ]);
    const graph = buildImportGraph(files);
    expect(graph.has('src/standalone.ts')).toBe(true);
    expect(graph.has('README.md')).toBe(true);
    expect(graph.get('src/standalone.ts')!.size).toBe(0);
    expect(graph.get('README.md')!.size).toBe(0);
  });

  it('drops self-edges (a file importing itself via index resolution)', () => {
    const files = new Map([
      ['src/util/index.ts', `import { x } from './';`],
    ]);
    const graph = buildImportGraph(files);
    expect(graph.get('src/util/index.ts')!.has('src/util/index.ts')).toBe(false);
  });

  it('produces a deterministic graph for the same input', () => {
    const files = new Map([
      ['src/z.ts', `import './a';`],
      ['src/a.ts', `import './m';`],
      ['src/m.ts', `export {};`],
    ]);
    const a = buildImportGraph(files);
    const b = buildImportGraph(files);

    const serialize = (g: Map<string, Set<string>>): string =>
      [...g.entries()]
        .map(([k, v]) => `${k}->${[...v].join(',')}`)
        .join('\n');
    expect(serialize(a)).toBe(serialize(b));
  });
});
