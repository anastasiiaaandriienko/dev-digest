import { describe, it, expect } from "vitest";
import {
  SMART_GROUP_ORDER,
  buildSmartGroups,
  classifyFile,
  defaultGroupOpen,
  type SmartGroupKey,
} from "./smart-diff";

const CASES: [SmartGroupKey, string][] = [
  ["boilerplate", "pnpm-lock.yaml"],
  ["boilerplate", "client/package-lock.json"],
  ["boilerplate", "yarn.lock"],
  ["boilerplate", "server/src/db/migrations/meta/x.json"],
  ["boilerplate", "src/__snapshots__/a.test.ts.snap"],
  ["boilerplate", "dist/index.js"],
  ["boilerplate", "build/out.js"],
  ["boilerplate", "dist/x.js"],
  ["boilerplate", "vendor/lib.js"],
  ["core", "app/build/out.js"],
  ["core", "server/src/vendor/shared/contracts/x.ts"],
  ["core", "client/src/vendor/shared/contracts/brief.ts"],
  ["core", "src/build/x.ts"],
  ["core", "src/lib/changelog.ts"],
  ["core", "license.tsx"],
  ["core", "readme.ts"],
  ["docs", "README"],
  ["docs", "LICENSE"],
  ["docs", "CHANGELOG.md"],
  ["docs", "docs/README.md"],
  ["wiring", "requirements.txt"],
  ["wiring", "a/b/requirements-dev.txt"],
  ["boilerplate", "public/app.min.js"],
  ["boilerplate", "vendor/lib/x.ts"],
  ["boilerplate", "public/logo.png"],
  ["boilerplate", "public/font.woff2"],
  ["tests", "test/x.ts"],
  ["tests", "server/test/x.ts"],
  ["tests", "src/__tests__/x.tsx"],
  ["tests", "e2e/specs/05-pr-diff.flow.json"],
  ["tests", "src/a.test.ts"],
  ["tests", "src/a.spec.tsx"],
  ["tests", "pkg/test_x.py"],
  ["tests", "pkg/x_test.go"],
  ["docs", "README.md"],
  ["docs", "server/README.md"],
  ["docs", "CHANGELOG"],
  ["docs", "LICENSE"],
  ["docs", "docs/a.md"],
  ["docs", "guide/a.mdx"],
  ["docs", "guide/a.rst"],
  ["wiring", "package.json"],
  ["wiring", "client/tsconfig.json"],
  ["wiring", "client/next.config.ts"],
  ["wiring", ".github/workflows/ci.yml"],
  ["wiring", "docker-compose.yml"],
  ["wiring", "Dockerfile"],
  ["wiring", ".env.example"],
  ["wiring", "src/modules/index.ts"],
  ["wiring", "client/messages/en/prReview.json"],
  ["core", "src/config.ts"],
  ["core", "server/src/modules/pulls/service.ts"],
  ["core", "client/src/components/X/X.tsx"],
  // priority conflicts
  ["tests", "docs/foo.test.ts"],
  // case / separators
  ["boilerplate", "PNPM-LOCK.YAML"],
  ["tests", "SERVER\\TEST\\X.TS"],
  ["tests", "server\\test\\x.ts"],
  ["docs", "Docs\\A.MD"],
  ["wiring", "client\\next.config.ts"],
  ["core", "server\\src\\modules\\pulls\\service.ts"],
  ["boilerplate", "server\\src\\db\\migrations\\meta\\x.json"],
];

describe("classifyFile", () => {
  it.each(CASES)("%s <- %s", (group, path) => {
    expect(classifyFile(path)).toBe(group);
  });
});

describe("buildSmartGroups", () => {
  const file = (path: string) => ({ path, id: path });

  it("returns five empty groups in order for empty input", () => {
    const groups = buildSmartGroups([], []);
    expect(groups.map((g) => g.key)).toEqual([...SMART_GROUP_ORDER]);
    expect(groups).toHaveLength(5);
    for (const g of groups) {
      expect(g.files).toEqual([]);
      expect(g.filesWithFindings).toBe(0);
    }
  });

  it("includes empty groups and keeps original order inside each group", () => {
    const files = [file("src/b.ts"), file("src/a.test.ts"), file("src/a.ts"), file("src/c.test.ts")];
    const groups = buildSmartGroups(files, []);
    expect(groups.map((g) => g.key)).toEqual([...SMART_GROUP_ORDER]);
    const by = Object.fromEntries(groups.map((g) => [g.key, g.files.map((f) => f.path)]));
    expect(by.core).toEqual(["src/b.ts", "src/a.ts"]);
    expect(by.tests).toEqual(["src/a.test.ts", "src/c.test.ts"]);
    expect(by.wiring).toEqual([]);
    expect(by.docs).toEqual([]);
    expect(by.boilerplate).toEqual([]);
  });

  it("counts files (not findings) with findings; ignores files outside the PR", () => {
    const files = [file("src/a.ts"), file("src/b.ts"), file("README.md")];
    const groups = buildSmartGroups(files, [
      { file: "src/a.ts" },
      { file: "src/a.ts" },
      { file: "not/in/pr.ts" },
    ]);
    const get = (k: SmartGroupKey) => groups.find((g) => g.key === k)!;
    expect(get("core").filesWithFindings).toBe(1);
    expect(get("docs").filesWithFindings).toBe(0);
    expect(get("tests").filesWithFindings).toBe(0);
  });

  it("is deterministic and does not mutate inputs", () => {
    const files = [file("src/a.ts"), file("pnpm-lock.yaml"), file("docs/x.md")];
    const findings = [{ file: "docs/x.md" }];
    const filesCopy = structuredClone(files);
    const findingsCopy = structuredClone(findings);
    const first = buildSmartGroups(files, findings);
    const second = buildSmartGroups(files, findings);
    expect(second).toEqual(first);
    expect(files).toEqual(filesCopy);
    expect(findings).toEqual(findingsCopy);
  });
});

describe("defaultGroupOpen", () => {
  it.each(["core", "tests", "wiring"] as const)("%s is open regardless of count", (key) => {
    expect(defaultGroupOpen(key, 0)).toBe(true);
    expect(defaultGroupOpen(key, 3)).toBe(true);
  });

  it.each(["docs", "boilerplate"] as const)("%s opens only when it has findings", (key) => {
    expect(defaultGroupOpen(key, 0)).toBe(false);
    expect(defaultGroupOpen(key, 1)).toBe(true);
  });
});
