export const USER_KEY_PREFIX = "kfl_user_";
export const SYSTEM_KEY_PREFIX = "kfl_sys_";

/** Number of hex chars of randomness in an API key */
export const KEY_RANDOM_HEX_LENGTH = 32;

/** Length of the visible prefix stored for identification (e.g. "kfl_user_a1b2") */
export const KEY_PREFIX_LENGTH = 12;

/** Version embedded in health check */
export const VERSION = "0.1.0";

/** HKDF info strings for key derivation */
export const HKDF_INFO_ENCRYPT = "encrypt";
export const HKDF_INFO_HMAC = "hmac";
