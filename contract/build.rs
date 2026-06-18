//! Odra's contracts build script. Uses the ENV variable `ODRA_MODULE` to set the
//! `odra_module` cfg flag and generate the per-contract wasm.
pub fn main() {
    odra_build::build();
}
