package io.github.polons123.lampyris;

import java.util.List;

/** Проверки AudioFx без Android: значения совпадают с тестами Swift и Rust. */
public class AudioFxTest {
    static void eq(Object actual, Object expected, String name) {
        if (!java.util.Objects.equals(actual, expected)) throw new AssertionError(name + ": " + actual + " != " + expected);
    }

    public static void main(String[] args) {
        eq(AudioFx.graph(new int[10], 0, false), null, "пусто");
        eq(AudioFx.graph(new int[0], 0, false), null, "нет полос");
        eq(AudioFx.graph(new int[]{20, 0, -30, 0, 0, 0, 0, 0, 0, 0}, 0, false),
            "equalizer=f=31:t=q:w=1.4:g=12,equalizer=f=125:t=q:w=1.4:g=-12,alimiter=limit=0.95", "ограничение и ограничитель");
        eq(AudioFx.graph(new int[]{0, 0, 0, 0, 0, 0, 0, 0, 0, -6}, 0, false), "equalizer=f=16000:t=q:w=1.4:g=-6", "только ослабление");
        eq(AudioFx.graph(new int[0], 9, true),
            "equalizer=f=1000:t=q:w=1:g=3,equalizer=f=2500:t=q:w=0.8:g=6,acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95", "речь и ночь");
        List<String[]> c = AudioFx.commands("x");
        eq(c.size(), 2, "две команды");
        eq(String.join(" ", c.get(1)), "af add @lyfx:lavfi=[x]", "добавление");
        eq(DisplayRate.pick(23.976, new float[]{24, 30, 50, 60}), 24f, "23.976→24");
        eq(DisplayRate.pick(23.976, new float[]{48, 60}), 48f, "×2");
        eq(DisplayRate.pick(25, new float[]{24, 50, 60}), 50f, "25→50");
        eq(Float.isNaN(DisplayRate.pick(23.976, new float[]{30, 50, 60})), true, "нет кратного");
        eq(Float.isNaN(DisplayRate.pick(5, new float[]{60})), true, "неправдоподобная частота");
        System.out.println("AudioFxTest ok");
    }
}
