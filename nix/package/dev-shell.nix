{ mkShell
, nodejs_24
, zerostackTs
}:

mkShell {
  inputsFrom = [ zerostackTs ];

  buildInputs = [
    nodejs_24
  ];
}
