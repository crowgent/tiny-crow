{ mkShell
, nodejs_24
, tinyCrowTs
}:

mkShell {
  inputsFrom = [ tinyCrowTs ];

  buildInputs = [
    nodejs_24
  ];
}
