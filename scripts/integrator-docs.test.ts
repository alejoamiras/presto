import { expect, test } from "bun:test";

const read = (rel: string) => Bun.file(new URL(`../${rel}`, import.meta.url)).text();
const lead = (doc: string) => doc.split("\n## ")[0] ?? "";

test("the root README opens with the Aztec version model and presto-banners", async () => {
  const readme = await read("README.md");
  expect(lead(readme)).toContain("(#presto-and-aztec-versions)");
  expect(lead(readme)).toContain("@alejoamiras/presto-banners");
  const section = readme.split("\n## Presto and Aztec versions\n")[1]?.split("\n## ")[0] ?? "";
  for (const fact of ["x-aztec-version", "bbVersion", "BB_BINARY_PATH", "GITHUB_TOKEN"]) {
    expect(section).toContain(fact);
  }
});

test("the app README opens with the same two pointers", async () => {
  const opening = lead(await read("packages/presto/README.md"));
  expect(opening).toContain("README.md#presto-and-aztec-versions");
  expect(opening).toContain("@alejoamiras/presto-banners");
});
