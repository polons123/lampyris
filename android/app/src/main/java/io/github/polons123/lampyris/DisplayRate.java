package io.github.polons123.lampyris;

/** Выбор частоты обновления экрана под частоту кадров. Та же логика, что в LampyrisCore/DisplayRate.swift и windows/src/display_rate.rs. */
final class DisplayRate {
    private DisplayRate() {}

    /** Из доступных частот берёт равную частоте кадров или кратную ей (1×…4×); при равных кратностях меньшую. NaN, если подходящей нет. */
    static float pick(double fps, float[] rates) {
        if (!(fps >= 10 && fps <= 120)) return Float.NaN;
        for (int m = 1; m <= 4; m++) {
            double target = fps * m;
            float best = Float.NaN;
            for (float r : rates) {
                if (r > 0 && Math.abs(r - target) / target < 0.002 && (Float.isNaN(best) || Math.abs(r - target) < Math.abs(best - target))) best = r;
            }
            if (!Float.isNaN(best)) return best;
        }
        return Float.NaN;
    }
}
