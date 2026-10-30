{ lib
, stdenv
, nodejs_24
}:

stdenv.mkDerivation {
  pname = "tiny-crow";
  version = "1.8.5";

  # Note: upgrade to lib.fileset as cleanSource is including many irrelevant
  # files for the build (many *.md files, .git* files, & so on).
  src = lib.cleanSource ../..;

  nativeBuildInputs = [
    nodejs_24
  ];

  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    npm install
    runHook postBuild
  '';

  checkPhase = ''
    runHook preCheck
    npm test
    runHook postCheck
  '';

  doCheck = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/tiny-crow $out/bin
    cp -r src data package.json package-lock.json node_modules README.md LICENSE $out/share/tiny-crow/
    cat > $out/bin/tiny-crow <<EOF
    #!/bin/sh
    exec ${nodejs_24}/bin/node $out/share/tiny-crow/src/main.ts "\$@"
    EOF
    chmod +x $out/bin/tiny-crow
    runHook postInstall
  '';

  meta = {
    description = "Minimal coding agent TUI, ported to TypeScript";
    license = lib.licenses.gpl3Only;
    mainProgram = "tiny-crow";
    platforms = with lib.platforms; linux ++ darwin;
  };
}
