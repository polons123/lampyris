package io.github.polons123.lampyris;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Логика обновления без Android и сети: версии, имя APK, список сумм и проверка его подписи. Та же цепочка доверия, что в
 * LampyrisCore/Update.swift и windows/src/update.rs: подпись Ed25519 файла SHA256SUMS.txt (открытый ключ вшит в приложение),
 * затем SHA-256 нужного APK из этого списка. Открытый ключ менять только вместе с Swift и Rust и секретом GitHub UPDATE_SIGNING_KEY.
 */
final class UpdateLogic {
    static final String PUBLIC_KEY_HEX = "6ec850da7be700aed5b6a5650da56f2731d21f92aaa440a39129ba4f71fbc54e";
    static final String REPO = "polons123/lampyris";
    static final String LATEST_URL = "https://api.github.com/repos/" + REPO + "/releases/latest";
    static final String DOWNLOAD_BASE = "https://github.com/" + REPO + "/releases/download";
    /** Предел размера APK и служебных ответов. */
    static final int MAX_APK_BYTES = 120_000_000;
    static final int MAX_META_BYTES = 1_000_000;

    private UpdateLogic() {}

    /** Версия вида 1.2.3 (допускается префикс v); null, если не похоже. */
    static int[] parseVersion(String s) {
        if (s == null) return null;
        String t = s.startsWith("v") ? s.substring(1) : s;
        String[] parts = t.split("\\.", -1);
        if (parts.length != 3) return null;
        int[] out = new int[3];
        for (int i = 0; i < 3; i++) {
            if (!parts[i].matches("[0-9]{1,5}")) return null;
            out[i] = Integer.parseInt(parts[i]);
        }
        return out;
    }

    static boolean isNewer(String candidate, String current) {
        int[] a = parseVersion(candidate), b = parseVersion(current);
        if (a == null || b == null) return false;
        for (int i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] > b[i];
        return false;
    }

    /** versionCode приложения: X*10000 + Y*100 + Z (как в app/build.gradle). 0, если версия неверна. */
    static int versionCode(String version) {
        int[] v = parseVersion(version);
        return v == null ? 0 : v[0] * 10000 + v[1] * 100 + v[2];
    }

    /** Версия без префикса v для опубликованного (не черновик, не пре-релиз) релиза с верным тегом; иначе null. */
    static String releaseVersion(String tag, boolean draft, boolean prerelease) {
        if (draft || prerelease || parseVersion(tag) == null) return null;
        return tag.startsWith("v") ? tag.substring(1) : tag;
    }

    /** Имя APK для устройства: по основной архитектуре установленных библиотек приложения (primaryCpuAbi). */
    static String assetName(String version, String primaryAbi) {
        String abi = primaryAbi == null ? "" : primaryAbi.toLowerCase(Locale.ROOT);
        String kind = abi.equals("arm64-v8a") ? "arm64" : abi.equals("armeabi-v7a") ? "arm32" : "universal";
        return "Lampyris-" + version + "-android-" + kind + ".apk";
    }

    /** Строки вида «<sha256>  <имя>» (формат shasum); имя может начинаться с «*». */
    static Map<String, String> parseSums(String text) {
        Map<String, String> result = new HashMap<>();
        for (String line : text.split("\\r?\\n")) {
            String trimmed = line.trim();
            int space = trimmed.indexOf(' ');
            if (space != 64 || !trimmed.substring(0, 64).matches("[0-9a-fA-F]{64}")) continue;
            String name = trimmed.substring(65).trim();
            if (name.startsWith("*")) name = name.substring(1);
            if (!name.isEmpty()) result.put(name, trimmed.substring(0, 64).toLowerCase(Locale.ROOT));
        }
        return result;
    }

    static byte[] hex(String s) {
        if (s.length() % 2 != 0) return null;
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(s.charAt(2 * i), 16), lo = Character.digit(s.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0) return null;
            out[i] = (byte) (hi * 16 + lo);
        }
        return out;
    }

    static boolean verifySums(byte[] sums, byte[] signature) {
        return verifySums(sums, signature, PUBLIC_KEY_HEX);
    }

    static boolean verifySums(byte[] sums, byte[] signature, String publicKeyHex) {
        byte[] key = hex(publicKeyHex);
        return key != null && Ed25519.verify(sums, signature, key);
    }

    static String sumsText(byte[] sums) {
        return new String(sums, StandardCharsets.UTF_8);
    }
}
