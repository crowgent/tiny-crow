final: prev: {
  tiny-crow-dev-shell = final.callPackage ../package/dev-shell.nix {
    tinyCrowTs = final.tiny-crow;
  };
}
