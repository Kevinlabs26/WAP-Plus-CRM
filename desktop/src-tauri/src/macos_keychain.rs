use ring::{
    aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM},
    rand::{SecureRandom, SystemRandom},
};
use security_framework::{
    os::macos::keychain::SecKeychain,
    passwords::{generic_password, PasswordOptions},
};
use std::sync::Mutex;

const SERVICE: &str = "com.wapplus.crm";
const ACCOUNT: &str = "local-encryption-v1";
const ITEM_NOT_FOUND: i32 = -25300;
const DUPLICATE_ITEM: i32 = -25299;
const HEADER: &[u8] = b"WAP-MAC-KEYCHAIN-V1";
static KEYCHAIN: Mutex<()> = Mutex::new(());

fn wrapping_key(create: bool) -> Result<LessSafeKey, String> {
    let _guard = KEYCHAIN
        .lock()
        .map_err(|_| "Keychain storage unavailable")?;
    let read = || generic_password(PasswordOptions::new_generic_password(SERVICE, ACCOUNT));
    let bytes = match read() {
        Ok(bytes) => bytes,
        Err(error) if create && error.code() == ITEM_NOT_FOUND => {
            let mut bytes = vec![0; 32];
            SystemRandom::new()
                .fill(&mut bytes)
                .map_err(|_| "Key generation failed")?;
            let keychain = SecKeychain::default()
                .map_err(|error| format!("Cannot open default Keychain ({})", error.code()))?;
            match keychain.add_generic_password(SERVICE, ACCOUNT, &bytes) {
                Ok(()) => bytes,
                Err(error) if error.code() == DUPLICATE_ITEM => read().map_err(|error| {
                    format!("Cannot read existing Keychain key ({})", error.code())
                })?,
                Err(error) => return Err(format!("Cannot save Keychain key ({})", error.code())),
            }
        }
        Err(error) => return Err(format!("Cannot read Keychain key ({})", error.code())),
    };
    UnboundKey::new(&AES_256_GCM, &bytes)
        .map(LessSafeKey::new)
        .map_err(|_| "Invalid Keychain encryption key".into())
}

pub(crate) fn protect_secrets(value: &[u8]) -> Result<Vec<u8>, String> {
    let key = wrapping_key(true)?;
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "Nonce generation failed")?;
    let mut encrypted = value.to_vec();
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::from(HEADER),
        &mut encrypted,
    )
    .map_err(|_| "Cannot encrypt local data")?;
    Ok([HEADER, &nonce, &encrypted].concat())
}

pub(crate) fn unprotect_secrets(value: &[u8]) -> Result<Vec<u8>, String> {
    let data = value
        .strip_prefix(HEADER)
        .ok_or("Invalid macOS encrypted record")?;
    let (nonce, encrypted) = data
        .split_at_checked(12)
        .ok_or("Invalid macOS encrypted record")?;
    let mut encrypted = encrypted.to_vec();
    let nonce =
        Nonce::try_assume_unique_for_key(nonce).map_err(|_| "Invalid macOS encrypted record")?;
    let plaintext = wrapping_key(false)?
        .open_in_place(nonce, Aad::from(HEADER), &mut encrypted)
        .map_err(|_| "Cannot authenticate local encrypted data")?;
    Ok(plaintext.to_vec())
}
