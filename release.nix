{
  system ? builtins.currentSystem,
  nixpkgs ? <nixpkgs>,
}:

let
  # Note: use an ‘input pinner’ to lock in a stable Nixpkgs version
  # <nixpkgs> uses the system’s Nixpkgs version which is impure.
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
