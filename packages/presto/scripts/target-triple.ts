/** The Tauri target triple of the host. Runtime-neutral: imported from both Bun scripts and the Node-run WebDriver suite. */
export function getTargetTriple(): string {
  const platform = process.platform;
  const nodeArch = process.arch;

  if (platform === "darwin") {
    return nodeArch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (platform === "linux") {
    return nodeArch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (platform === "win32") {
    // x64 only (locked scope). bb.exe is x86_64; arm64-windows is not shipped.
    return "x86_64-pc-windows-msvc";
  }
  throw new Error(`Unsupported platform: ${platform}`);
}
