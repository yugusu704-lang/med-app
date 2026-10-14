fn main() {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let bank = std::path::Path::new("../../quizbank.db");
    println!("cargo:rerun-if-changed={}", bank.display());
    let mut file = std::fs::File::open(bank).expect("quizbank.db is required for packaging");
    let size = file.metadata().unwrap().len();
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).unwrap();
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    println!("cargo:rustc-env=QUIZRX_BANK_SHA256={:x}", hash.finalize());
    println!("cargo:rustc-env=QUIZRX_BANK_SIZE={size}");
    tauri_build::build()
}
