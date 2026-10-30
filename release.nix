{
  system ? builtins.currentSystem,
  nixpkgs ? <nixpkgs>,
}:

let
  pkgs = import nixpkgs {
    inherit system;
    overlays = [
      (import ./nix/overlay)
      (import ./nix/overlay/development.nix)
    ];
  };
in
{
  inherit (pkgs) tiny-crow;
  default = pkgs.tiny-crow;
  shell = pkgs.tiny-crow-dev-shell;
}
