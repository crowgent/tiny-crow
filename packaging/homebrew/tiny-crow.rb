class TinyCrow < Formula
  desc "Minimal coding agent TUI, ported to TypeScript"
  version "1.8.5"
  license "GPL-3.0-only"

  depends_on "node@24"

  def install
    system "npm", "install"
    system "npm", "run", "typecheck"
    (share/"tiny-crow").install "src", "data", "package.json", "package-lock.json", "node_modules", "README.md", "LICENSE"
    (bin/"tiny-crow").write <<~EOS
      #!/bin/sh
      exec node #{share}/tiny-crow/src/main.ts "$@"
    EOS
    (bin/"tiny-crow").chmod 0o755
  end

  test do
    assert_match(/^tiny-crow /, shell_output("#{bin}/tiny-crow --version"))
  end
end
