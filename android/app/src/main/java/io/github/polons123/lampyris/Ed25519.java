package io.github.polons123.lampyris;

import java.math.BigInteger;
import java.security.MessageDigest;
import java.util.Arrays;

/**
 * Проверка подписи Ed25519 (RFC 8032) на BigInteger. Нужна только для SHA256SUMS.txt релиза: на Android 8–12 нет
 * системной реализации Ed25519, а подпись проверяется один раз за проверку обновления, поэтому скорость не важна.
 * Проверка без «кофакторного» умножения: сравнивается кодировка точки [S]B − [h]A с R, как в ed25519-dalek.
 */
final class Ed25519 {
    private static final BigInteger P = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19));
    private static final BigInteger L = BigInteger.ONE.shiftLeft(252).add(new BigInteger("27742317777372353535851937790883648493"));
    private static final BigInteger D = BigInteger.valueOf(-121665).multiply(BigInteger.valueOf(121666).modInverse(P)).mod(P);
    private static final BigInteger SQRT_M1 = BigInteger.valueOf(2).modPow(P.subtract(BigInteger.ONE).shiftRight(2), P);
    private static final BigInteger[] BASE = {
        new BigInteger("15112221349535400772501151409588531511454012693041857206046113283949847762202"),
        new BigInteger("46316835694926478169428394003475163141307993866256225615783033603165251855960")};

    private Ed25519() {}

    /** Подпись сообщения: 64 байта R‖S; ключ — 32 байта. Любая ошибка разбора означает «неверно». */
    static boolean verify(byte[] message, byte[] signature, byte[] publicKey) {
        try {
            if (signature == null || signature.length != 64 || publicKey == null || publicKey.length != 32) return false;
            byte[] rBytes = Arrays.copyOfRange(signature, 0, 32);
            BigInteger s = fromLittleEndian(Arrays.copyOfRange(signature, 32, 64));
            if (s.compareTo(L) >= 0) return false;
            BigInteger[] a = decode(publicKey);
            if (a == null) return false;
            MessageDigest sha = MessageDigest.getInstance("SHA-512");
            sha.update(rBytes);
            sha.update(publicKey);
            sha.update(message);
            BigInteger h = fromLittleEndian(sha.digest()).mod(L);
            // [S]B + [h](−A): отрицание точки — смена знака x.
            BigInteger[] negA = {P.subtract(a[0]).mod(P), a[1]};
            BigInteger[] point = add(multiply(BASE, s), multiply(negA, h));
            return Arrays.equals(encode(point), rBytes);
        } catch (Exception e) {
            return false;
        }
    }

    private static BigInteger fromLittleEndian(byte[] b) {
        byte[] big = new byte[b.length + 1];
        for (int i = 0; i < b.length; i++) big[b.length - i] = b[i];
        return new BigInteger(big);
    }

    private static byte[] encode(BigInteger[] point) {
        byte[] out = new byte[32];
        byte[] y = point[1].toByteArray();
        for (int i = 0; i < y.length && i < 32; i++) out[i] = y[y.length - 1 - i];
        if (point[0].testBit(0)) out[31] |= (byte) 0x80;
        return out;
    }

    /** Точка из 32 байт (y и знак x); null, если это не точка кривой. */
    private static BigInteger[] decode(byte[] bytes) {
        byte[] copy = bytes.clone();
        boolean sign = (copy[31] & 0x80) != 0;
        copy[31] &= 0x7f;
        BigInteger y = fromLittleEndian(copy);
        if (y.compareTo(P) >= 0) return null;
        BigInteger y2 = y.multiply(y).mod(P);
        BigInteger u = y2.subtract(BigInteger.ONE).mod(P);
        BigInteger v = D.multiply(y2).add(BigInteger.ONE).mod(P);
        BigInteger x2 = u.multiply(v.modInverse(P)).mod(P);
        BigInteger x = x2.modPow(P.add(BigInteger.valueOf(3)).shiftRight(3), P);
        if (!x.multiply(x).mod(P).equals(x2)) x = x.multiply(SQRT_M1).mod(P);
        if (!x.multiply(x).mod(P).equals(x2)) return null;
        if (x.signum() == 0 && sign) return null;
        if (x.testBit(0) != sign) x = P.subtract(x).mod(P);
        return new BigInteger[]{x, y};
    }

    /** Сложение точек (полная формула для a = −1; подходит и для удвоения). */
    private static BigInteger[] add(BigInteger[] p, BigInteger[] q) {
        BigInteger x1y2 = p[0].multiply(q[1]), x2y1 = q[0].multiply(p[1]);
        BigInteger y1y2 = p[1].multiply(q[1]), x1x2 = p[0].multiply(q[0]);
        BigInteger dxy = D.multiply(x1x2).mod(P).multiply(p[1].multiply(q[1]).mod(P)).mod(P);
        BigInteger x = x1y2.add(x2y1).mod(P).multiply(BigInteger.ONE.add(dxy).modInverse(P)).mod(P);
        BigInteger y = y1y2.add(x1x2).mod(P).multiply(BigInteger.ONE.subtract(dxy).mod(P).modInverse(P)).mod(P);
        return new BigInteger[]{x, y};
    }

    private static BigInteger[] multiply(BigInteger[] point, BigInteger k) {
        BigInteger[] result = {BigInteger.ZERO, BigInteger.ONE};
        BigInteger[] addend = point;
        for (int i = 0; i < k.bitLength(); i++) {
            if (k.testBit(i)) result = add(result, addend);
            addend = add(addend, addend);
        }
        return result;
    }
}
