package io.github.polons123.lampyris;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Проверки логики обновления без Android: версии, имена, список сумм, подпись Ed25519 (RFC 8032 и настоящий релиз v1.2.0). */
public class UpdateLogicTest {
    // Настоящий SHA256SUMS.txt релиза v1.2.0 и его подпись (публичные данные релиза): подпись должна сходиться с вшитым ключом.
    private static final String SUMS_V120 =
        "240beaa44cb43dc46792a5b4fbca6568486712c7fd519977f65c8208d853cf6c  Lampyris-1.2.0-arm64.dmg\n" +
        "ab2ae67982efb3508201ab368fd2473a285a2431c40a00769adb045f37067771  Lampyris-1.2.0-intel.dmg\n" +
        "8ca83126535f7ace4acf40994e87ff715ec45b5ac68b93a9e0be012431d856b6  Lampyris-1.2.0-arm64.zip\n" +
        "2f0078e0ddcde2e0fb39bba342080d9fc1e9ea8d299533bb071dfe452f67c00a  Lampyris-1.2.0-intel.zip\n" +
        "2431aeca5bc0d5bf3484dab6f514a0ba8b0f6e66d3cc8de57a39752f4935f069  Lampyris-1.2.0-windows-arm64-portable.zip\n" +
        "6b5fd107ebc80bd229dbb11121c3ce064b2bb6f1740a6901b657f89bd339f5aa  Lampyris-1.2.0-windows-arm64.zip\n" +
        "bae876bedbbc2b8d2f1473952b5190a3e70928da9ea37f0b5d9b99d6ef712f99  Lampyris-1.2.0-windows-x64-portable.zip\n" +
        "c272944469e37de7a3c6e0bd14a39420d063e0080a37c053d94ac53b3eddff6e  Lampyris-1.2.0-windows-x64.zip\n" +
        "6eab6b2f102f10bbe283039e6a2b7113095989197e096eb502d469b5c6ce4e24  Lampyris-1.2.0-windows-arm64-setup.exe\n" +
        "2efe77529fdd750e7c3ea53df5cac11a0e3cc0d9bde72ef0f658660dd992ca99  Lampyris-1.2.0-windows-x64-setup.exe\n" +
        "b6f4dd813336e71b50205e5a8524524a8179e19c0863614da2a29e7928af3bff  Lampyris-1.2.0-android-arm32.apk\n" +
        "e22ce5b1c4b8a188d87ca7e0645e594127935a740a84d5facebd18a1ed290a5b  Lampyris-1.2.0-android-arm64.apk\n" +
        "944f3f0f4ba2ce26eb8ec57a99d282c1bbe8c21d2f9309a12cacaf77217afa18  Lampyris-1.2.0-android-universal.apk\n";
    private static final String SIG_V120 = "9cee9182eb1c58732adb13432167e228b80cbab4215cb835a03eea7b12ae4f6a09d70e5699ff0adbed385f09a53d65f30640e0a4abd875bf709f668ba153a708";

    static void eq(Object actual, Object expected, String name) {
        if (!java.util.Objects.equals(actual, expected)) throw new AssertionError(name + ": " + actual + " != " + expected);
    }

    public static void main(String[] args) {
        // Версии
        eq(UpdateLogic.isNewer("1.2.1", "1.2.0"), true, "новее");
        eq(UpdateLogic.isNewer("v1.10.0", "1.9.9"), true, "10 > 9 по числам");
        eq(UpdateLogic.isNewer("1.2.0", "1.2.0"), false, "равны");
        eq(UpdateLogic.isNewer("1.1.9", "1.2.0"), false, "старее");
        eq(UpdateLogic.isNewer("1.2", "1.1.0"), false, "неверная версия");
        eq(UpdateLogic.isNewer("1.2.x", "1.1.0"), false, "неверная версия 2");
        eq(UpdateLogic.versionCode("1.2.1"), 10201, "versionCode");
        eq(UpdateLogic.versionCode("мусор"), 0, "versionCode мусор");
        eq(UpdateLogic.releaseVersion("v1.2.1", false, false), "1.2.1", "релиз");
        eq(UpdateLogic.releaseVersion("v1.2.1", true, false), null, "черновик");
        eq(UpdateLogic.releaseVersion("v1.2.1", false, true), null, "пре-релиз");
        eq(UpdateLogic.releaseVersion("latest", false, false), null, "не тег версии");
        // Имя APK по архитектуре установленных библиотек
        eq(UpdateLogic.assetName("1.2.1", "arm64-v8a"), "Lampyris-1.2.1-android-arm64.apk", "arm64");
        eq(UpdateLogic.assetName("1.2.1", "armeabi-v7a"), "Lampyris-1.2.1-android-arm32.apk", "arm32");
        eq(UpdateLogic.assetName("1.2.1", "x86_64"), "Lampyris-1.2.1-android-universal.apk", "прочее — universal");
        eq(UpdateLogic.assetName("1.2.1", null), "Lampyris-1.2.1-android-universal.apk", "null — universal");
        // Список сумм
        Map<String, String> sums = UpdateLogic.parseSums(SUMS_V120);
        eq(sums.get("Lampyris-1.2.0-android-arm64.apk"), "e22ce5b1c4b8a188d87ca7e0645e594127935a740a84d5facebd18a1ed290a5b", "сумма arm64");
        eq(sums.size(), 13, "число строк");
        eq(UpdateLogic.parseSums("zz  file\n" + "a".repeat(64) + " *bin.apk\n").get("bin.apk"), "a".repeat(64), "звёздочка");
        eq(UpdateLogic.parseSums("zz  file").size(), 0, "мусор");
        // Подпись Ed25519
        byte[] pub1 = UpdateLogic.hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        byte[] sig1 = UpdateLogic.hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
        eq(Ed25519.verify(new byte[0], sig1, pub1), true, "RFC 8032, тест 1");
        eq(Ed25519.verify(new byte[]{1}, sig1, pub1), false, "RFC 8032, другое сообщение");
        byte[] signed = SUMS_V120.getBytes(StandardCharsets.UTF_8), sig = UpdateLogic.hex(SIG_V120);
        eq(UpdateLogic.verifySums(signed, sig), true, "подпись настоящего релиза");
        byte[] tampered = signed.clone();
        tampered[10] ^= 1;
        eq(UpdateLogic.verifySums(tampered, sig), false, "изменённый список");
        byte[] badSig = sig.clone();
        badSig[0] ^= 1;
        eq(UpdateLogic.verifySums(signed, badSig), false, "изменённая подпись");
        eq(UpdateLogic.verifySums(signed, new byte[10]), false, "короткая подпись");
        eq(UpdateLogic.verifySums(signed, sig, "00"), false, "неверный ключ");
        System.out.println("UpdateLogicTest ok");
    }
}
