final: prev: {
  zerostack-ts-dev-shell = final.callPackage ../package/dev-shell.nix {
    zerostackTs = final.zerostack-ts;
  };
}
