package io.github.polons123.lampyris;

import java.util.ArrayList;
import java.util.List;

/** Звуковые эффекты: эквалайзер, усиление речи, ночной режим. Та же логика, что в LampyrisCore/AudioFx.swift и windows/src/audio_fx.rs: менять все сразу. */
final class AudioFx {
    static final String LABEL = "lyfx";
    static final int[] BAND_FREQUENCIES = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
    private static final int MAX_GAIN = 12, MAX_DIALOGUE = 3;
    private static final String NIGHT_CHAIN = "acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11";

    private AudioFx() {}

    /** Строка для lavfi=[…] либо null, когда эффекты не нужны. */
    static String graph(int[] bands, int dialogue, boolean night) {
        List<String> parts = new ArrayList<>();
        boolean boosted = false;
        for (int i = 0; i < BAND_FREQUENCIES.length && i < bands.length; i++) {
            int g = Math.max(-MAX_GAIN, Math.min(MAX_GAIN, bands[i]));
            if (g == 0) continue;
            if (g > 0) boosted = true;
            parts.add("equalizer=f=" + BAND_FREQUENCIES[i] + ":t=q:w=1.4:g=" + g);
        }
        int d = Math.max(0, Math.min(MAX_DIALOGUE, dialogue));
        if (d > 0) {
            boosted = true;
            parts.add("equalizer=f=1000:t=q:w=1:g=" + d);
            parts.add("equalizer=f=2500:t=q:w=0.8:g=" + d * 2);
        }
        if (night) parts.add(NIGHT_CHAIN);
        if (parts.isEmpty()) return null;
        // Подъём полос может дать перегрузку: ограничитель держит пик ниже предела.
        if (boosted) parts.add("alimiter=limit=0.95");
        return String.join(",", parts);
    }

    /** Команды mpv: сначала af remove @lyfx, затем (если нужно) af add @lyfx:lavfi=[…]. */
    static List<String[]> commands(String graph) {
        List<String[]> out = new ArrayList<>();
        out.add(new String[]{"af", "remove", "@" + LABEL});
        if (graph != null) out.add(new String[]{"af", "add", "@" + LABEL + ":lavfi=[" + graph + "]"});
        return out;
    }
}
