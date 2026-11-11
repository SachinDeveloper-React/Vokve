const fs = require('fs');
const path = require('path');

const PACKAGE = 'lucide-react-native';

/**
 * Which file each icon lives in, read from the package's own index.
 *
 * The index is one line per file, each naming every export that file is
 * known by — `Flame`, `FlameIcon`, `LucideFlame`, and the old names kept as
 * aliases (`AlertTriangle` is `triangle-alert`). Reading it rather than
 * turning `AlertTriangle` into `alert-triangle` is what makes the aliases
 * work, and means an upgrade that renames an icon needs nothing changed
 * here.
 *
 * `require.resolve` is given the bare package name because the package's
 * `exports` hide everything else from Node; the ESM index is then found
 * beside the CJS one it resolves to.
 */
function readIconFiles() {
  const cjsEntry = require.resolve(PACKAGE);
  const indexPath = path.join(
    path.dirname(cjsEntry),
    '..',
    'esm',
    'lucide-react-native.mjs',
  );
  const index = fs.readFileSync(indexPath, 'utf8');

  const files = new Map();
  const line = /export \{([^}]+)\} from '\.\/icons\/([^']+)\.mjs';/g;
  for (const [, names, file] of index.matchAll(line)) {
    for (const name of names.matchAll(/default as (\w+)/g)) {
      files.set(name[1], file);
    }
  }
  if (files.size === 0) {
    throw new Error(
      `lucide-direct-imports: no icons found in ${indexPath}. The package ` +
        'has changed shape — fix this plugin or remove it from babel.config.js.',
    );
  }
  return files;
}

/**
 * Rewrites
 *
 *   import { Flame, Check as Tick, type LucideIcon } from 'lucide-react-native';
 *
 * into
 *
 *   import Flame from 'lucide-react-native/icons/flame';
 *   import Tick from 'lucide-react-native/icons/check';
 *   import { type LucideIcon } from 'lucide-react-native';
 *
 * Metro does not tree-shake. The package's index re-exports every icon it
 * has, so one named import from it put all 1,820 of them in the bundle —
 * about 590 KB — for the two hundred the app draws. The per-icon paths are
 * the package's own (`exports["./icons/*"]`), so this is the import its
 * authors intend, written by a plugin instead of by hand in three hundred
 * files.
 *
 * Anything that is not an icon — a type, `createLucideIcon` — is left on
 * the original import. A type-only import is erased by the TypeScript
 * transform as it always was; a value left behind would bring the whole
 * index back, which is the one thing to look for if the bundle grows again.
 *
 * Done on `Program.enter`, and the scope re-crawled afterwards, so the
 * TypeScript transform that runs next sees the new imports as referenced.
 * It decides which imports are types by their references, and one it had
 * no bindings for would be erased as unused.
 */
module.exports = function lucideDirectImports({ types: t }) {
  const files = readIconFiles();

  const importedName = specifier =>
    t.isIdentifier(specifier.imported)
      ? specifier.imported.name
      : specifier.imported.value;

  return {
    name: 'lucide-direct-imports',
    visitor: {
      Program: {
        enter(program) {
          let changed = false;

          for (const statement of program.get('body')) {
            if (!statement.isImportDeclaration()) continue;
            const { node } = statement;
            if (node.source.value !== PACKAGE || node.importKind === 'type') {
              continue;
            }

            const direct = [];
            const rest = [];
            for (const specifier of node.specifiers) {
              const file =
                t.isImportSpecifier(specifier) && specifier.importKind !== 'type'
                  ? files.get(importedName(specifier))
                  : undefined;
              if (file) {
                direct.push(
                  t.importDeclaration(
                    [t.importDefaultSpecifier(t.identifier(specifier.local.name))],
                    t.stringLiteral(`${PACKAGE}/icons/${file}`),
                  ),
                );
              } else {
                rest.push(specifier);
              }
            }

            if (direct.length === 0) continue;
            if (rest.length > 0) {
              direct.push(t.importDeclaration(rest, t.stringLiteral(PACKAGE)));
            }
            statement.replaceWithMultiple(direct);
            changed = true;
          }

          if (changed) program.scope.crawl();
        },
      },
    },
  };
};
