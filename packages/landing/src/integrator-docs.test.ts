import { expect, test } from "bun:test";

const read = (rel: string) => Bun.file(new URL(rel, import.meta.url)).text();
const VERSIONS = "github.com/alejoamiras/presto#presto-and-aztec-versions";
const BANNERS = "@alejoamiras/presto-banners";

test("the developer callout explains the version model and points at presto-banners", async () => {
  const callout = (await read("../index.html")).split('id="dev"')[1]?.split("</div>\n\n")[0] ?? "";
  expect(callout).toContain(VERSIONS);
  expect(callout).toContain(BANNERS);
});

test("llms.txt names every package, the version model and the ask-first rule", async () => {
  const llms = await read("../public/llms.txt");
  for (const pkg of ["presto", "presto-noir", "presto-banners", "presto-core"]) {
    expect(llms).toContain(`[@alejoamiras/${pkg}]`);
  }
  expect(llms).toContain(VERSIONS);
  expect(llms).toContain("Never contact Presto on page load");
  expect(llms).toContain("loopbackPermission()");
});
