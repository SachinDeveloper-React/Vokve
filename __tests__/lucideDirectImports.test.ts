/**
 * The Babel plugin that turns `import { Flame } from 'lucide-react-native'`
 * into the package's per-icon path, so a release bundle carries the icons
 * the app draws rather than all 1,820.
 *
 * Jest itself runs without it (see babel.config.js), so this drives Babel
 * directly — with the TypeScript transform after it, as in the real
 * pipeline, because the way this would go wrong is that transform erasing
 * an import it had no bindings for.
 *
 * @format
 */

import { transformSync } from '@babel/core';

/** Jest runs on Node; the app's own tsconfig does not know that. */
declare const __dirname: string;

const plugin = require('../babel-plugins/lucide-direct-imports');
const typescript = require('@babel/preset-typescript');

function compile(source: string): string {
  const result = transformSync(source, {
    filename: 'Example.tsx',
    babelrc: false,
    configFile: false,
    plugins: [plugin],
    presets: [
      [typescript, { allExtensions: true, isTSX: true }],
    ],
  });
  return result?.code ?? '';
}

it('imports each icon from its own file', () => {
  const out = compile(`
    import { Flame, ChevronRight } from 'lucide-react-native';
    export const icons = [Flame, ChevronRight];
  `);

  expect(out).toContain(`import Flame from "lucide-react-native/icons/flame"`);
  expect(out).toContain(
    `import ChevronRight from "lucide-react-native/icons/chevron-right"`,
  );
  expect(out).not.toMatch(/from ["']lucide-react-native["']/);
});

it('keeps the local name of a renamed import', () => {
  const out = compile(`
    import { User as UserIcon } from 'lucide-react-native';
    export const icon = UserIcon;
  `);

  expect(out).toContain(`import UserIcon from "lucide-react-native/icons/user"`);
});

it('follows the names lucide keeps as aliases', () => {
  // Old names the app still uses: each is another file's export, which is
  // why the map is read from the package rather than guessed from the name.
  const out = compile(`
    import { AlertTriangle, CheckCircle2, HelpCircle, BarChart3 } from 'lucide-react-native';
    export const icons = [AlertTriangle, CheckCircle2, HelpCircle, BarChart3];
  `);

  expect(out).toContain(
    `import AlertTriangle from "lucide-react-native/icons/triangle-alert"`,
  );
  expect(out).toContain(
    `import CheckCircle2 from "lucide-react-native/icons/circle-check"`,
  );
  expect(out).toContain(
    `import HelpCircle from "lucide-react-native/icons/circle-question-mark"`,
  );
  expect(out).toContain(
    `import BarChart3 from "lucide-react-native/icons/chart-column"`,
  );
});

it('leaves no import of the whole package behind for a type', () => {
  const inline = compile(`
    import { Gift, type LucideIcon } from 'lucide-react-native';
    export const icon: LucideIcon = Gift;
  `);
  const separate = compile(`
    import type { LucideIcon } from 'lucide-react-native';
    import { Gift } from 'lucide-react-native';
    export const icon: LucideIcon = Gift;
  `);
  // No `type` keyword at all: still only ever a type, still erased.
  const bare = compile(`
    import { Gift, LucideIcon } from 'lucide-react-native';
    export const icon: LucideIcon = Gift;
  `);

  for (const out of [inline, separate, bare]) {
    expect(out).toContain(`import Gift from "lucide-react-native/icons/gift"`);
    expect(out).not.toMatch(/from ["']lucide-react-native["']/);
  }
});

it('does not erase an icon that is only used in JSX', () => {
  const out = compile(`
    import { Check } from 'lucide-react-native';
    export const Tick = () => <Check size={16} />;
  `);

  expect(out).toContain(`import Check from "lucide-react-native/icons/check"`);
});

it('leaves a value that is not an icon on the package import', () => {
  const out = compile(`
    import { createLucideIcon, Flame } from 'lucide-react-native';
    export const made = [createLucideIcon, Flame];
  `);

  expect(out).toContain(`import Flame from "lucide-react-native/icons/flame"`);
  expect(out).toMatch(/import \{ createLucideIcon \} from ["']lucide-react-native["']/);
});

it('leaves other packages alone', () => {
  const out = compile(`
    import { View } from 'react-native';
    export const V = View;
  `);

  expect(out).toContain(`import { View } from 'react-native'`);
});

it('maps every icon the app imports to a file the package ships', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const iconDir = path.join(root, 'node_modules/lucide-react-native/dist/esm/icons');

  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) sources.push(full);
    }
  };
  walk(path.join(root, 'src'));

  let checked = 0;
  for (const file of sources) {
    const source: string = fs.readFileSync(file, 'utf8');
    if (!source.includes("'lucide-react-native'")) continue;
    const out = compile(source);
    // Whatever is left on the package import must have been a type.
    expect({ file, whole: /from ["']lucide-react-native["']/.test(out) }).toEqual({
      file,
      whole: false,
    });
    for (const [, icon] of out.matchAll(/from "lucide-react-native\/icons\/([^"]+)"/g)) {
      expect({ file, icon, exists: fs.existsSync(path.join(iconDir, `${icon}.mjs`)) }).toEqual({
        file,
        icon,
        exists: true,
      });
      checked += 1;
    }
  }
  // The app draws icons in a few hundred places; none found means the scan
  // is broken, not that the app has none.
  expect(checked).toBeGreaterThan(200);
});
