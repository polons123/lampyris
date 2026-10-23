package io.github.polons123.lampyris;

import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import javax.net.ssl.HttpsURLConnection;

/**
 * Сеть обновления без Android: только HTTPS на хостах GitHub (API, страница релиза и хранилище файлов релиза),
 * ручные перенаправления с повторной проверкой хоста и запретом частных адресов, жёсткий предел размера во время чтения.
 */
final class UpdateNet {
    interface Progress {
        void update(long done, long total);
        boolean cancelled();
    }

    private UpdateNet() {}

    static boolean allowed(URI u) {
        String h = u.getHost();
        return "https".equals(u.getScheme()) && h != null && u.getUserInfo() == null && (u.getPort() == -1 || u.getPort() == 443)
            && (h.equals("api.github.com") || h.equals("github.com") || h.endsWith(".githubusercontent.com"));
    }

    private static HttpsURLConnection open(String url, String accept) throws IOException {
        try {
            URI uri = new URI(url);
            for (int redirect = 0; redirect < 5; redirect++) {
                if (!allowed(uri)) throw new IOException("Address not allowed");
                for (InetAddress a : InetAddress.getAllByName(uri.getHost())) if (NetworkAddressPolicy.blocked(a)) throw new IOException("Address not allowed");
                HttpsURLConnection c = (HttpsURLConnection) uri.toURL().openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(8000);
                c.setReadTimeout(15000);
                c.setRequestProperty("User-Agent", "Lampyris-Android");
                if (accept != null) c.setRequestProperty("Accept", accept);
                int status = c.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = c.getHeaderField("Location");
                    c.disconnect();
                    if (location == null) throw new IOException("Redirect");
                    uri = uri.resolve(location);
                    continue;
                }
                if (status != 200) {
                    c.disconnect();
                    throw new IOException("HTTP " + status);
                }
                return c;
            }
        } catch (URISyntaxException e) {
            throw new IOException("Bad address");
        }
        throw new IOException("Too many redirects");
    }

    /** Ответ целиком в памяти, но не больше limit байт (превышение прерывает чтение). */
    static byte[] getBytes(String url, int limit, String accept) throws IOException {
        HttpsURLConnection c = open(url, accept);
        try {
            if (c.getContentLengthLong() > limit) throw new IOException("Response too large");
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (out.size() + n > limit) throw new IOException("Response too large");
                    out.write(buffer, 0, n);
                }
                return out.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    /** Скачивает файл (до limit байт) и возвращает его SHA-256 (hex); при ошибке и отмене частичный файл удаляется. */
    static String downloadFile(String url, File target, long limit, Progress progress) throws IOException {
        HttpsURLConnection c = open(url, null);
        try {
            long total = c.getContentLengthLong();
            if (total > limit) throw new IOException("File too large");
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            long done = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[65536];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (progress != null && progress.cancelled()) throw new IOException("Cancelled");
                    done += n;
                    if (done > limit) throw new IOException("File too large");
                    sha.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    if (progress != null) progress.update(done, total);
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : sha.digest()) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        } catch (IOException | RuntimeException e) {
            target.delete();
            throw e;
        } finally {
            c.disconnect();
        }
    }
}
