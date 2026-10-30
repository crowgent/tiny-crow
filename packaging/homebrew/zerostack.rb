# Formula for zerostack-ts, the Node.js / TypeScript application.
# Runtime: Node.js 24, entry point node src/main.ts. The application
# tree is platform-independent, so there is no per-platform archive.
# NOTE: the 1.8.5 source archive location and checksum are publish-time
# distribution metadata and are not invented here; the install, wrapper,
# dependency, and test steps below are complete as written.
class ZerostackTs < Formula
  desc "Minimal coding agent TUI, ported to TypeScript"
  version "1.8.5"
  license "GPL-3.0-only"

  depends_on "node@24"

  def install
    system "npm", "install"
    system "npm", "run", "typecheck"
    (share/"zerostack-ts").install "src", "data", "package.json", "package-lock.json", "node_modules", "README.md", "LICENSE"
    (bin/"zerostack-ts").write <<~EOS
      #!/bin/sh
      exec node #{share}/zerostack-ts/src/main.ts "$@"
    EOS
    (bin/"zerostack-ts").chmod 0o755
  end

  test do
    assert_match(/^zerostack-ts /, shell_output("#{bin}/zerostack-ts --version"))
  end
end
